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

/// Prompt now encourages lists/bold for structured content (workout plans, multi-step advice -
/// see coach-chat.ts's <instructions> block), and web already renders them via react-markdown.
/// `AttributedString(markdown:)` can't lay out block-level bullet lists in SwiftUI `Text` -
/// `.inlineOnlyPreservingWhitespace` explicitly excludes them - so this does its own minimal
/// line-based split: `- `/`* `/`1. `-prefixed lines render as indented bullet/numbered rows (each
/// line's own text still runs through CoachChatMarkdown.attributed for bold/italic), everything
/// else renders exactly as before.
struct CoachChatMarkdownBlock: View {
    let text: String
    var font: Font
    var lineSpacing: CGFloat = 3

    private struct Line: Identifiable {
        let id = UUID()
        let content: String
        let marker: String?
    }

    private static let orderedPrefix = try? NSRegularExpression(pattern: #"^(\d+)\.\s+"#)

    private var lines: [Line] {
        text.components(separatedBy: "\n").map { raw in
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
                return Line(content: String(trimmed.dropFirst(2)), marker: "•")
            }
            if let regex = Self.orderedPrefix,
               let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
               let fullRange = Range(match.range, in: trimmed),
               let numberRange = Range(match.range(at: 1), in: trimmed) {
                return Line(content: String(trimmed[fullRange.upperBound...]), marker: "\(trimmed[numberRange]).")
            }
            return Line(content: raw, marker: nil)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(lines) { line in
                if let marker = line.marker {
                    HStack(alignment: .top, spacing: 6) {
                        Text(marker)
                            .font(font)
                        Text(CoachChatMarkdown.attributed(line.content))
                            .font(font)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineSpacing(lineSpacing)
                    }
                    .padding(.leading, 4)
                } else if !line.content.isEmpty {
                    Text(CoachChatMarkdown.attributed(line.content))
                        .font(font)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(lineSpacing)
                }
            }
        }
    }
}
