import SwiftUI

/// Coach messages come back from Gemini with basic markdown (`**bold**`, `_italic_`) that used
/// to render as literal asterisks in `CoachChatCoachBubble`. No markdown utility existed
/// anywhere in `ios/` before this (issue #244) - this is a thin wrapper around
/// `AttributedString(markdown:)` rather than a full parser, since coach replies only ever use
/// simple inline emphasis, never headings/lists/links.
enum CoachChatMarkdown {
    static func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(text)
    }
}
