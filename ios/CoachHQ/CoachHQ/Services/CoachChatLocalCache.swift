import Foundation

/// Bridges the gap between mid-conversation turns and the server's close-only commit.
/// `ui/api/coach-chat.ts` only writes `chat_history.json` when a thread closes (see
/// `docs/eng-docs/coach-chat-flow.md` §4) - ordinary POST turns never persist server-side, so a
/// force-quit mid-conversation loses everything past the opener once the app relaunches and
/// re-fetches from the server. This cache keeps a local copy of the in-progress thread's
/// messages so a relaunch can restore them.
///
/// Single-device only, by design (issue #244) - this does not attempt to sync the in-progress
/// window across devices, it only survives a force-quit/relaunch on the same device before the
/// thread closes. Keyed by repo + thread id so switching accounts on one device never leaks a
/// stale conversation into the wrong athlete's chat.
enum CoachChatLocalCache {
    private static func key(repoFullName: String, threadId: String) -> String {
        "coachChatLocalCache.\(repoFullName).\(threadId)"
    }

    /// Persists the given thread's current messages locally. Call this after every append
    /// (user send, coach reply) so a force-quit never loses more than the in-flight request.
    static func save(messages: [ChatMessage], repoFullName: String, threadId: String) {
        guard let data = try? JSONEncoder().encode(messages) else { return }
        UserDefaults.standard.set(data, forKey: key(repoFullName: repoFullName, threadId: threadId))
    }

    /// Returns the locally cached messages for a thread, if any.
    static func load(repoFullName: String, threadId: String) -> [ChatMessage]? {
        guard let data = UserDefaults.standard.data(forKey: key(repoFullName: repoFullName, threadId: threadId)),
              let messages = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return nil
        }
        return messages
    }

    /// Drops the cache for a thread - call once the server confirms the thread's close-commit
    /// landed (the server copy is now the truth) or the thread is gone (deleted).
    static func clear(repoFullName: String, threadId: String) {
        UserDefaults.standard.removeObject(forKey: key(repoFullName: repoFullName, threadId: threadId))
    }

    /// Parses the epoch-ms timestamp embedded in a message id (e.g. "d-1738798412345"). An
    /// orphaned local thread (orphanedThreadIds below) never gets a server-computed `createdAt` -
    /// the cache only ever stored `messages`, not thread metadata - so this recovers a real
    /// creation time from the divider message's own id instead of the caller hardcoding "today."
    /// Missing this was a real bug (found via code review): a stale unreplied greeting from days
    /// ago would get restored as dayOffset 0, get picked up by `todayThread` as "today's" thread,
    /// and permanently block the fresh greeting every open is supposed to get.
    private static func epochMs(fromMessageId id: String) -> Double? {
        guard let dashIndex = id.firstIndex(of: "-") else { return nil }
        return Double(id[id.index(after: dashIndex)...])
    }

    /// Calendar-day difference (device's local timezone) between an epoch-ms timestamp and now -
    /// mirrors coach-chat.ts's server-side computeDayOffset, but purely client-side since an
    /// orphaned thread never had a server-computed dayOffset to begin with.
    private static func dayOffset(fromCreatedAt createdAt: Double) -> Int {
        let created = Date(timeIntervalSince1970: createdAt / 1000)
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: created), to: calendar.startOfDay(for: Date())).day ?? 0
        return max(0, days)
    }

    private static func epochMs(fromISO8601 raw: String?) -> Double? {
        guard let raw else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? {
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: raw)
        }()
        return date.map { $0.timeIntervalSince1970 * 1000 }
    }

    /// Returns the exact cached proactive seed, or materializes its divider and Coach opener.
    /// The route body is never shortened or regenerated.
    static func proactiveThread(for route: CoachMessageRoute) -> ChatThread {
        let createdAt = epochMs(fromISO8601: route.createdAt)
            ?? Date().timeIntervalSince1970 * 1000
        let cachedMessages = load(
            repoFullName: route.repoFullName,
            threadId: route.conversationSeedId
        )
        let messages: [ChatMessage]
        if let cachedMessages, !cachedMessages.isEmpty {
            messages = cachedMessages
        } else {
            messages = [
                ChatMessage.divider(id: "d-\(Int(createdAt))", label: "TODAY"),
                ChatMessage.coach(id: "c-\(Int(createdAt))", paragraphs: [route.body]),
            ]
        }
        let firstUserText = messages.first(where: { $0.role == .user })?.text
        let title: String
        if let firstUserText {
            title = firstUserText.count > 28
                ? String(firstUserText.prefix(28)) + "…"
                : firstUserText
        } else {
            title = "Post-workout check-in"
        }
        let lastCoachText = messages.last(where: { $0.role == .coach })?
            .paragraphs?.joined(separator: " ") ?? route.body
        let offset = dayOffset(fromCreatedAt: createdAt)

        return ChatThread(
            id: route.conversationSeedId,
            dayOffset: offset,
            createdAt: createdAt,
            title: title,
            preview: String(lastCoachText.prefix(80)),
            ageLabel: offset == 0 ? "NOW" : "D-\(offset)",
            status: .active,
            messages: messages
        )
    }

    /// Thread ids cached locally that never made it into `serverThreads` at all - a genuinely
    /// uncommitted conversation (a materializeThreadIfNeeded "local-<ts>" thread, or a
    /// greetNow() greeting - neither commits server-side until a real close), not just a stale
    /// cache entry for something that already closed elsewhere. Scans UserDefaults for this
    /// repo's cache keys directly since there's no server-side list to check these ids against.
    private static func orphanedThreadIds(repoFullName: String, knownThreadIds: Set<String>) -> [String] {
        let prefix = "coachChatLocalCache.\(repoFullName)."
        return UserDefaults.standard.dictionaryRepresentation().keys.compactMap { key -> String? in
            guard key.hasPrefix(prefix) else { return nil }
            let threadId = String(key.dropFirst(prefix.count))
            return knownThreadIds.contains(threadId) ? nil : threadId
        }
    }

    /// Restores any thread in `serverThreads` whose local cache has strictly more messages than
    /// the server-committed copy - i.e. a mid-conversation window the server hasn't committed
    /// yet. Threads that come back `.deleted` have their cache dropped defensively so a stale
    /// local copy can't resurrect a thread the athlete removed on another device.
    ///
    /// Also materializes any orphaned local-only thread (see orphanedThreadIds above) that has
    /// no server counterpart at all - previously invisible to restore entirely, since overlaying
    /// only ever happens onto a thread the server already knows about. This is the actual
    /// explanation for "a whole in-progress conversation vanished after force-quit/relaunch": it
    /// was cached correctly the whole time, restore just never looked for it under its local id.
    static func restoring(
        _ serverThreads: [ChatThread],
        repoFullName: String,
        preservingThreadId: String? = nil
    ) -> [ChatThread] {
        let overlaid = serverThreads.map { thread -> ChatThread in
            if thread.status == .deleted {
                clear(repoFullName: repoFullName, threadId: thread.id)
                return thread
            }
            guard let cached = load(repoFullName: repoFullName, threadId: thread.id),
                  cached.count > thread.messages.count else {
                return thread
            }
            var restored = thread
            restored.messages = cached
            return restored
        }

        let knownIds = Set(serverThreads.map(\.id))
        let orphaned = orphanedThreadIds(repoFullName: repoFullName, knownThreadIds: knownIds).compactMap { id -> ChatThread? in
            guard let messages = load(repoFullName: repoFullName, threadId: id), !messages.isEmpty else { return nil }
            let lastCoachText = messages.last(where: { $0.role == .coach })?.paragraphs?.joined(separator: " ")
            let firstUserText = messages.first(where: { $0.role == .user })?.text
            let title: String
            if let firstUserText {
                title = firstUserText.count > 28 ? String(firstUserText.prefix(28)) + "…" : firstUserText
            } else if id.hasPrefix("local-proactive-") {
                title = "Post-workout check-in"
            } else {
                title = "New conversation"
            }
            let createdAt = messages.first(where: { $0.role == .divider }).flatMap { epochMs(fromMessageId: $0.id) }
            let offset = createdAt.map { dayOffset(fromCreatedAt: $0) } ?? 0
            // An unreplied greeting from a past day has nothing worth keeping - Coach spoke, the
            // athlete never engaged, and a fresh greeting for today already supersedes it. Rather
            // than let it linger forever as a single-message "ghost" thread (correctly dated by
            // the fix above, but still shown), drop it here: clear its cache entry and don't
            // materialize it at all. A same-day unreplied greeting is untouched by this - that's
            // still "come back to what Coach just said," not clutter.
            if firstUserText == nil, offset > 0, id != preservingThreadId {
                clear(repoFullName: repoFullName, threadId: id)
                return nil
            }
            return ChatThread(
                id: id,
                dayOffset: offset,
                createdAt: createdAt,
                title: title,
                preview: lastCoachText.map { String($0.prefix(80)) } ?? "",
                ageLabel: offset == 0 ? "NOW" : "D-\(offset)",
                status: .active,
                messages: messages
            )
        }

        return orphaned + overlaid
    }
}
