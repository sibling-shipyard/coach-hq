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

    /// Restores any thread in `serverThreads` whose local cache has strictly more messages than
    /// the server-committed copy - i.e. a mid-conversation window the server hasn't committed
    /// yet. Threads that come back `.deleted` have their cache dropped defensively so a stale
    /// local copy can't resurrect a thread the athlete removed on another device.
    static func restoring(_ serverThreads: [ChatThread], repoFullName: String) -> [ChatThread] {
        serverThreads.map { thread in
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
    }
}
