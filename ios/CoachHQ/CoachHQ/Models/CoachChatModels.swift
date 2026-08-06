import Foundation

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

    static func divider(id: String, label: String) -> ChatMessage {
        ChatMessage(id: id, role: .divider, label: label, text: nil, paragraphs: nil)
    }

    static func user(id: String, text: String) -> ChatMessage {
        ChatMessage(id: id, role: .user, label: nil, text: text, paragraphs: nil)
    }

    static func coach(id: String, paragraphs: [String]) -> ChatMessage {
        ChatMessage(id: id, role: .coach, label: nil, text: nil, paragraphs: paragraphs)
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

/// POST /api/coach-chat response - `closed: false` means nothing was written server-side
/// (see coach-chat-flow.md "ordinary turn"), so `threadId`/`threads` are absent that turn.
/// `repoSha`/`stale` are A5 (cross-device staleness detection). `profileComplete` is B2 - only
/// meaningful when `closed` is true, computed from whatever state.md content this close-turn
/// actually just committed.
struct ChatSendResponse: Decodable {
    let reply: String
    let closed: Bool
    let threadId: String?
    let threads: [ChatThread]?
    let repoSha: String?
    let stale: Bool?
    let profileComplete: Bool?
}

struct ChatAPIErrorBody: Decodable {
    let error: String?
}

/// POST {action: "greet"} response (A4). `threadId` is a fresh, never-committed id and `threads`
/// is just the existing committed list unchanged - the server no longer commits anything on
/// greet (see coach-chat.ts's handleGreet), so CoachChatView materializes the actual greeting as
/// a local-only thread instead of trusting these fields to already represent it.
struct ChatGreetResponse: Decodable {
    let reply: String
    let threadId: String
    let threads: [ChatThread]
    let repoSha: String?
}

/// GET /api/coach-chat-profile-status response (B2).
struct ChatProfileStatusResponse: Decodable {
    let profileComplete: Bool
}
