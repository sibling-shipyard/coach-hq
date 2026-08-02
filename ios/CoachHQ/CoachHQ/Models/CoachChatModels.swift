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
    var title: String
    var preview: String
    var ageLabel: String
    var status: ChatThreadStatus
    var messages: [ChatMessage]
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

/// POST {action: "greet"} response (A4) - always creates or reuses a real thread, unlike
/// ChatSendResponse's ordinary-turn case, so threadId/threads are never optional here.
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
