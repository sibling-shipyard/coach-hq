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

enum ChatThreadStatus: String, Codable {
    case active, archived, deleted
}

struct ChatThread: Codable, Identifiable, Equatable {
    let id: String
    var dayOffset: Int
    var title: String
    var preview: String
    var ageLabel: String
    var status: ChatThreadStatus
    var archivedAt: Double?
    var deletedAt: Double?
    var messages: [ChatMessage]
}

struct ChatThreadsResponse: Decodable {
    let threads: [ChatThread]
}

/// POST /api/coach-chat response - `closed: false` means nothing was written server-side
/// (see coach-chat-flow.md "ordinary turn"), so `threadId`/`threads` are absent that turn.
struct ChatSendResponse: Decodable {
    let reply: String
    let closed: Bool
    let threadId: String?
    let threads: [ChatThread]?
}

struct ChatAPIErrorBody: Decodable {
    let error: String?
}
