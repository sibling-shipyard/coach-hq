import Foundation

// MARK: - Preview / wireup shell
//
// Placeholder content for the Coach Chat Warm Instrument UI (`Coach Chat Mobile.dc.html`).
// Skanda: replace preview fallbacks in `CoachChatView` once `/api/coach-chat` returns:
//   1. Seeded today thread on new-day open (continuous landing)
//   2. Header context (`D-143 · WK 4/4 · …`) from challenge_v2 / snapshots
//   3. Inline chips on coach morning-read messages (engine + commitments)
//   4. 7-day thread window (no search)

/// Header mono line — no "Coach" title per mock Turn 1.
struct CoachChatHeaderContext: Equatable {
    var dayLabel: String
    var weekLabel: String
    var statusSuffix: String?

    var formatted: String {
        if let statusSuffix, !statusSuffix.isEmpty {
            return "\(dayLabel) · \(weekLabel) · \(statusSuffix)"
        }
        return "\(dayLabel) · \(weekLabel)"
    }

    static let preview = CoachChatHeaderContext(
        dayLabel: "D-143",
        weekLabel: "WK 4/4",
        statusSuffix: "4TH DAY LOGGED"
    )
}

/// Inline widget chip rendered inside a coach bubble (engine load, commitment row, etc.).
struct CoachChatInlineChip: Identifiable, Equatable {
    enum Style: Equatable {
        case engine(value: String, band: String)
        case commitment(sportHex: String, label: String)
    }

    let id: String
    let style: Style
}

enum CoachChatPreviewData {
    static let previewTodayThreadId = "preview-today"
    static let previewYesterdayThreadId = "preview-yesterday"

    static let starterPrompts = [
        "Warm the bar tonight",
        "Review my week",
        "Plan Thursday's match",
    ]

    static let morningReadSignature = "— PHELPS"

    static let seededTodayThread = ChatThread(
        id: previewTodayThreadId,
        dayOffset: 0,
        title: "Today's thread",
        preview: "Load's dead center — the bar's the only cold thing…",
        ageLabel: "6:58",
        status: .active,
        archivedAt: nil,
        deletedAt: nil,
        messages: [
            .divider(id: "preview-divider-today", label: "TODAY · D-143 · 6:58"),
            .coach(id: "preview-coach-read", paragraphs: [
                "Morning. I opened your week before you did — load's dead center, but the bar's been cold since Tuesday.",
            ]),
        ]
    )

    static let morningReadChips: [CoachChatInlineChip] = [
        CoachChatInlineChip(id: "engine", style: .engine(value: "549", band: "IN BAND")),
        CoachChatInlineChip(id: "cal", style: .commitment(sportHex: "#4f587a", label: "CAL 0/2")),
    ]

    static let historyThreads: [ChatThread] = [
        seededTodayThread,
        ChatThread(
            id: previewYesterdayThreadId,
            dayOffset: 1,
            title: "Bar felt cold",
            preview: "Two missed bar days doesn't undo a block…",
            ageLabel: "1D",
            status: .archived,
            archivedAt: nil,
            deletedAt: nil,
            messages: [
                .divider(id: "preview-divider-yesterday", label: "YESTERDAY · D-142"),
                .coach(id: "preview-coach-y", paragraphs: [
                    "Two missed bar days doesn't undo a block — it just means tonight is the night you stop avoiding it.",
                ]),
                .user(id: "preview-user-y", text: "Two easy sets tonight then."),
            ]
        ),
        ChatThread(
            id: "preview-d141",
            dayOffset: 2,
            title: "Marcus rematch",
            preview: "Your net game is what turned it…",
            ageLabel: "2D",
            status: .archived,
            archivedAt: nil,
            deletedAt: nil,
            messages: []
        ),
        ChatThread(
            id: "preview-d139",
            dayOffset: 4,
            title: "Sleep & easy days",
            preview: "Easy volume is doing the work you…",
            ageLabel: "4D",
            status: .archived,
            archivedAt: nil,
            deletedAt: nil,
            messages: []
        ),
    ]

    /// Message ids that should show the `— PHELPS` signature (unprompted read only).
    static let signatureMessageIds: Set<String> = ["preview-coach-read"]

    /// Message ids that render inline chips until API carries chip payloads.
    static let chipsByMessageId: [String: [CoachChatInlineChip]] = [
        "preview-coach-read": morningReadChips,
    ]
}
