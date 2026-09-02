import Foundation

/// Source-qualified HealthKit activity id the activity_sync contract accepts (`hk:<uuid>`).
enum ActivitySyncIDs {
    static let prefix = "hk:"

    static func qualified(_ uuid: String) -> String {
        uuid.hasPrefix(prefix) ? uuid : prefix + uuid
    }
}

/// One row in a `synced_activity_list` attachment. Server reread values win once they arrive;
/// local titles/sport/start/duration are only provisional until then.
struct SyncedActivityRow: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let sport: String
    let start: String
    let durationSeconds: Int
    let load: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, sport, start, load
        case durationSeconds = "duration_s"
    }
}

struct SyncedActivityListAttachment: Codable, Equatable {
    let version: Int
    let kind: String
    let batchId: String
    let activities: [SyncedActivityRow]

    enum CodingKeys: String, CodingKey {
        case version, kind, activities
        case batchId = "batch_id"
    }

    static func provisional(activities: [SyncedActivityRow]) -> SyncedActivityListAttachment {
        SyncedActivityListAttachment(
            version: 1,
            kind: "synced_activity_list",
            batchId: "local",
            activities: activities
        )
    }
}

/// Unknown kinds/versions decode as `.unknown` and are never shown. Encoding drops them.
enum ChatAttachment: Equatable {
    case syncedActivityList(SyncedActivityListAttachment)
    case unknown
}

extension ChatAttachment: Codable {
    private enum KindKey: String, CodingKey { case kind }

    init(from decoder: Decoder) throws {
        let keyed = try decoder.container(keyedBy: KindKey.self)
        let kind = try keyed.decodeIfPresent(String.self, forKey: .kind)
        if kind == "synced_activity_list",
           let list = try? SyncedActivityListAttachment(from: decoder),
           list.version == 1 {
            self = .syncedActivityList(list)
        } else {
            self = .unknown
        }
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .syncedActivityList(let list):
            try list.encode(to: encoder)
        case .unknown:
            var container = encoder.container(keyedBy: KindKey.self)
            try container.encode("unknown", forKey: .kind)
        }
    }
}

/// Copy helpers for the post-sync Coach turn — kept free of UIKit so XCTest can cover them.
enum ActivitySyncCopy {
    static func firstSentence(of text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        if let line = trimmed.split(whereSeparator: \.isNewline).first {
            let sentence = String(line).trimmingCharacters(in: .whitespaces)
            if let end = sentence.rangeOfCharacter(from: CharacterSet(charactersIn: ".!?")) {
                return String(sentence[..<end.upperBound]).trimmingCharacters(in: .whitespaces)
            }
            return sentence
        }
        return trimmed
    }

    /// Duplicate batches reuse the stored turn — no second notification, no second Home rewrite.
    static func shouldAnnounceReply(duplicate: Bool, chatVisible: Bool) -> Bool {
        !duplicate && !chatVisible
    }
}

/// Local draft of one just-committed HealthKit activity (id + filename for Chat + cache lookup).
struct SyncedActivityDraft: Equatable, Identifiable {
    let activityId: String
    let fileName: String
    let title: String
    let sport: String
    let start: String
    let durationSeconds: Int
    let load: Int?

    var id: String { activityId }
    var qualifiedId: String { ActivitySyncIDs.qualified(activityId) }

    var asRow: SyncedActivityRow {
        SyncedActivityRow(
            id: activityId,
            title: title,
            sport: sport,
            start: start,
            durationSeconds: durationSeconds,
            load: load
        )
    }
}

/// In-flight activity-sync Coach turn. Chat renders this; Gemini is never called until snapshots
/// are fresh. A failed turn cannot fail HealthKit sync.
struct ActivitySyncTurn: Equatable {
    enum Phase: Equatable {
        case waitingForSnapshots
        case requestingCoach
        case retryWait
        case retryPost
        case complete
    }

    let activities: [SyncedActivityDraft]
    let freshnessSince: Date
    /// Generation of this batch. Bumped when a newer sync publishes; stale POSTs must not apply.
    var epoch: Int
    var phase: Phase
    var completedThreads: [ChatThread] = []
    var completedThreadId: String?
    var reply: String?
    var duplicate = false

    var needsRetry: Bool {
        phase == .retryWait || phase == .retryPost
    }

    var isThinking: Bool {
        phase == .requestingCoach
    }
}

/// Pure gate so a POST that started on batch A cannot complete onto batch B.
enum ActivitySyncEpoch {
    static func shouldApply(turnEpoch: Int, currentEpoch: Int) -> Bool {
        turnEpoch == currentEpoch
    }

    /// Keep `current` when `incoming` is from a superseded batch.
    static func apply(incoming: ActivitySyncTurn, onto current: ActivitySyncTurn) -> ActivitySyncTurn {
        shouldApply(turnEpoch: incoming.epoch, currentEpoch: current.epoch) ? incoming : current
    }
}

/// Mirrors the JSON shapes ui/api/coach-chat.ts and coachChatModel.ts already define -
/// see docs/eng-docs/coach-chat-flow.md. A single flat struct instead of a Swift enum with
/// associated values: the three roles (divider/user/coach) only populate the fields that
/// apply to them, which Codable handles fine without a custom discriminated-union decoder.
struct ChatMessage: Codable, Identifiable, Equatable {
    enum Role: String, Codable {
        case divider, user, coach
    }

    let id: String
    let role: Role
    /// divider only
    var label: String?
    /// user only
    var text: String?
    /// coach only
    var paragraphs: [String]?
    /// coach only — unknown kinds are dropped on decode, never fatal
    var attachments: [ChatAttachment]?

    static func divider(id: String, label: String) -> ChatMessage {
        ChatMessage(id: id, role: .divider, label: label, text: nil, paragraphs: nil, attachments: nil)
    }

    static func user(id: String, text: String) -> ChatMessage {
        ChatMessage(id: id, role: .user, label: nil, text: text, paragraphs: nil, attachments: nil)
    }

    static func coach(id: String, paragraphs: [String], attachments: [ChatAttachment]? = nil) -> ChatMessage {
        ChatMessage(id: id, role: .coach, label: nil, text: nil, paragraphs: paragraphs, attachments: attachments)
    }

    var syncedActivityList: SyncedActivityListAttachment? {
        attachments?.compactMap {
            if case .syncedActivityList(let list) = $0 { return list }
            return nil
        }.first
    }

    enum CodingKeys: String, CodingKey {
        case id, role, label, text, paragraphs, attachments
    }

    init(
        id: String,
        role: Role,
        label: String? = nil,
        text: String? = nil,
        paragraphs: [String]? = nil,
        attachments: [ChatAttachment]? = nil
    ) {
        self.id = id
        self.role = role
        self.label = label
        self.text = text
        self.paragraphs = paragraphs
        self.attachments = attachments
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        role = try container.decode(Role.self, forKey: .role)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        text = try container.decodeIfPresent(String.self, forKey: .text)
        paragraphs = try container.decodeIfPresent([String].self, forKey: .paragraphs)
        let decoded = (try? container.decodeIfPresent([ChatAttachment].self, forKey: .attachments)) ?? nil
        let known = decoded?.filter {
            if case .unknown = $0 { return false }
            return true
        }
        attachments = (known?.isEmpty == false) ? known : nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(label, forKey: .label)
        try container.encodeIfPresent(text, forKey: .text)
        try container.encodeIfPresent(paragraphs, forKey: .paragraphs)
        let known = attachments?.filter {
            if case .unknown = $0 { return false }
            return true
        }
        if let known, !known.isEmpty {
            try container.encode(known, forKey: .attachments)
        }
    }
}

/// No archive tier (ADR 0012 amendment, 2026-08-02) - a thread is active until deleted, which
/// is immediate and permanent. `.deleted` never actually persists in chat_history.json; it's
/// only the PATCH request shape (send once, thread is gone).
enum ChatThreadStatus: String, Codable {
    case active, deleted
}

struct ChatThread: Codable, Identifiable, Equatable {
    let id: String
    var dayOffset: Int
    /// Raw epoch ms the thread was first created - server has always sent this, client just
    /// didn't decode it until now (needed to replace the D-N relative age badge with a real
    /// date - see formattedDate below).
    var createdAt: Double? = nil
    var title: String
    var preview: String
    var ageLabel: String
    var status: ChatThreadStatus
    var messages: [ChatMessage]
}

extension ChatThread {
    /// Mirrors coachChatModel.ts's formatThreadDate - replaces the relative "D-1"/"D-2"/"D-13"
    /// age badge (ageLabel), which resets meaning every time you look at it days later. A real
    /// date reads the same regardless of when you look at it.
    var formattedDate: String? {
        guard let createdAt else { return nil }
        let date = Date(timeIntervalSince1970: createdAt / 1000)
        let day = Calendar.current.component(.day, from: date)
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        let month = formatter.string(from: date).uppercased()
        return "\(Self.ordinal(day)) \(month)"
    }

    private static func ordinal(_ day: Int) -> String {
        if (11...13).contains(day) { return "\(day)th" }
        switch day % 10 {
        case 1: return "\(day)st"
        case 2: return "\(day)nd"
        case 3: return "\(day)rd"
        default: return "\(day)th"
        }
    }

    /// Age badge for a history row: "NOW"/"OPEN" handled by the caller for today's active
    /// thread, otherwise a real date instead of the relative D-N count - falls back to
    /// ageLabel only if createdAt is somehow missing.
    var ageDisplay: String {
        formattedDate ?? ageLabel
    }

    /// Leading divider label: "TODAY" for the active same-day thread, otherwise the thread's
    /// real date, never a time-of-day - replaces trusting the server's stored divider string,
    /// which is frozen at creation time and reads e.g. "TODAY · 2:00 AM" forever, even days
    /// later.
    var dividerLabel: String {
        dayOffset == 0 ? "TODAY" : (formattedDate ?? "TODAY")
    }
}

struct ChatThreadsResponse: Decodable {
    let threads: [ChatThread]
}

/// D1 (#736): one structured-fact write layer 3's corrective retry couldn't save, dropped
/// rather than aborting the whole turn. Mirrors coachChatModel.ts's DroppedAction.
struct DroppedAction: Codable, Equatable {
    let field: String
    let reason: String
}

/// POST /api/coach-chat response. `threadId`/`threads` are absent on an ordinary turn even when
/// FSP fields were incrementally committed; `closed` only reports the conversation close.
/// `repoSha`/`stale` are A5 (cross-device staleness detection). `profileComplete` is refreshed
/// after every turn so the explicit end-conversation control can enable as soon as FSP finishes.
/// `droppedActions` is D1 (#736): non-empty whenever layer 3's corrective retry gave up on a
/// field and dropped it rather than failing the whole turn - a firm signal, not left to Coach's
/// own reply happening to mention it.
struct ChatSendResponse: Decodable {
    let reply: String
    let closed: Bool
    let threadId: String?
    let threads: [ChatThread]?
    let repoSha: String?
    let stale: Bool?
    let profileComplete: Bool?
    let droppedActions: [DroppedAction]?
}

/// D1 (#736): `reply`/`traceId` are present alongside `error` only when Gemini generated a
/// reply but the write that would have saved it failed after commitFilesAtomic's own retries -
/// see CoachChatSaveFailedError below.
struct ChatAPIErrorBody: Decodable {
    let error: String?
    let reply: String?
    let traceId: String?
}

/// D1 (#736): thrown instead of a plain GitHubAPIError when sendMessage's error response
/// carries a `reply` alongside `error` - Gemini generated a reply but the write that would have
/// saved it failed after commitFilesAtomic's own retries. Distinguished from GitHubAPIError
/// (which means Coach never got to reply at all) so CoachChatView can show Coach's actual words
/// plus a distinct "couldn't save that" indicator instead of discarding the reply along with the
/// failed write - parity with web's CoachChatSaveFailedError (coachChatModel.ts).
struct CoachChatSaveFailedError: Error, LocalizedError {
    let message: String
    let reply: String
    let traceId: String?

    var errorDescription: String? { message }
}

/// POST {action: "activity_sync"} — always includes `threads` and `duplicate`.
struct ChatActivitySyncResponse: Decodable {
    let reply: String
    let closed: Bool
    let duplicate: Bool
    let threadId: String
    let threads: [ChatThread]
    let repoSha: String?
    let profileComplete: Bool?
}

/// POST {action: "greet"} response (A4). `threadId` is a fresh, never-committed id and `threads`
/// is just the existing committed list unchanged. The server may commit native onboarding fields
/// on greet, but it does not commit the greeting thread, so CoachChatView materializes the actual
/// greeting as a local-only thread instead of trusting these fields to already represent it.
struct ChatGreetResponse: Decodable {
    let reply: String
    let threadId: String
    let threads: [ChatThread]
    let repoSha: String?
    let profileComplete: Bool?
}

/// GET /api/coach-chat-profile-status response (B2).
struct ChatProfileStatusResponse: Decodable {
    let profileComplete: Bool
}
