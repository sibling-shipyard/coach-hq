import Foundation

/// Canonical activity-description parser (ADR 0013).
///
/// Reads whatever the athlete typed into an activity's description on-device and produces:
///   1. A formatted description string
///   2. For match sports, a structured `MatchSession` for `user_data/activities/match_history.json`
///
/// Match input format for ranked/friendly games:
///     {partner} me vs {opp1}/{opp2} {our_score}-{their_score}
///     Or for singles:
///     me vs {opponent} {our_score}-{their_score}
///
/// Both formats can include:
///     #notes Free text
///     #rank N
///     PRE: score, word
///     ---           (separator: ranked above, friendlies below)
///
/// Anything with no recognizable game line is a plain free-text note: it comes back as
/// `notes` with `isPlainNote == true`, and formats back to itself unchanged. That is what
/// lets every sport — not just badminton and tennis — carry a description.
///
/// This file is Foundation-only (no UIKit/SwiftUI) so it can be unit-tested standalone
/// via `ios/scripts/verify_description_parser.swift`.

// MARK: - Intermediate parse results

struct ParsedGame: Equatable {
    var partner: String?
    var vs: [String]
    var score: String
    var won: Bool
    var preNote: String?
    var postNote: String?
    var isSingles: Bool
}

struct ParsedPreMentalState: Equatable {
    var score: Int
    var word: String
}

struct ParsedDescription: Equatable {
    var notes: String?
    var rank: Int?
    var preMentalState: ParsedPreMentalState?
    var ranked: [ParsedGame]
    var friendlies: [ParsedGame]
    var hasSeparator: Bool
    var warnings: [String]

    /// True when no game line parsed, so `notes` holds the athlete's free text and there is
    /// nothing to write to `match_history.json`.
    var isPlainNote: Bool { ranked.isEmpty && friendlies.isEmpty }
}

// MARK: - match_history.json models

struct MatchGame: Codable, Equatable {
    var format: String // "singles" | "doubles"
    var category: String // "ranked" | "friendly"
    var partner: String? // null | "Name"
    var opponents: [String] // ["Name"]
    var scoreFor: Int
    var scoreAgainst: Int
    var result: String // "W" | "L"
    var preNote: String?
    var postNote: String?
}

struct MatchPreMentalState: Codable, Equatable {
    var score: Int
    var word: String
}

struct MatchSummary: Codable, Equatable {
    var wins: Int
    var losses: Int
    var winPct: Int
}

struct MatchSession: Codable, Equatable {
    var date: String
    var activityId: Int?
    var preMentalState: MatchPreMentalState?
    var rank: Int?
    var notes: String?
    var summary: MatchSummary
    var games: [MatchGame]
}

struct MatchHistory: Codable, Equatable {
    var version: Int
    var sessions: [MatchSession]
}

// MARK: - Parser

enum DescriptionParser {

    // Detection: already formatted.
    private static let formattedMarker = "Games:\n"

    // --- Regexes (mirrors parse_match_description.py) ---

    // Format A: `{partner} me vs {opponents} {score}` or `me vs {opponent} {score}`
    private static let gameRegex = try! NSRegularExpression(
        pattern: #"^(?:(.+?)\s+)?me\s+vs\s+(.+?)\s+(\d+-\d+)$"#,
        options: [.caseInsensitive]
    )

    // Raw-input detector: any "me vs" substring.
    private static let rawMarkerRegex = try! NSRegularExpression(
        pattern: #"\bme\s+vs\b"#,
        options: [.caseInsensitive]
    )

    private static let rankRegex = try! NSRegularExpression(
        pattern: #"^#rank\s+(\d+)$"#,
        options: [.caseInsensitive]
    )

    private static let preRegex = try! NSRegularExpression(
        pattern: #"^PRE:\s*(\d+),\s*(.+)$"#,
        options: [.caseInsensitive]
    )

    // MARK: Public API

    /// Returns true if the description already contains the formatted marker (idempotency check).
    static func isAlreadyFormatted(_ description: String) -> Bool {
        description.contains(formattedMarker)
    }

    /// Parses a raw activity description.
    ///
    /// Input with at least one recognizable game line comes back as a match. Anything else
    /// comes back as a plain free-text note. Returns nil only when the input is empty, or
    /// when it is already a formatted match (which must not be re-parsed).
    ///
    /// `allowMatchParsing` is the sport gate, and it is load-bearing: `match_history.json` is
    /// canonical for the win rate every consumer reads (ADR 0013), so only a score-entry sport
    /// may produce a match. Pass `false` and every input is a note, including text that would
    /// otherwise parse as games — a run is not a badminton session because someone typed a score
    /// into it. Callers pass `Theme.sportSupportsScoreEntry(for:)`.
    static func parseRawDescription(
        _ raw: String,
        allowMatchParsing: Bool = true
    ) -> ParsedDescription? {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return nil
        }
        if isAlreadyFormatted(raw) {
            return nil
        }

        var notes: String?
        var rank: Int?
        var preMentalState: ParsedPreMentalState?
        var rankedGames: [ParsedGame] = []
        var friendlyGames: [ParsedGame] = []
        var warnings: [String] = []
        var inFriendlies = false
        var hasSeparator = false
        // Every line no rule claimed, kept verbatim (blank lines included) so a free-text
        // note round-trips with its paragraph breaks intact.
        var freeTextLines: [String] = []

        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")

        for (idx, line) in lines.enumerated() {
            let i = idx + 1
            let lineStripped = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if lineStripped.isEmpty {
                freeTextLines.append("")
                continue
            }

            // Metadata: #notes
            if lineStripped.lowercased().hasPrefix("#notes ") {
                notes = String(lineStripped.dropFirst(7)).trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            }

            // Metadata: #rank
            if let m = firstMatch(rankRegex, in: lineStripped),
               let rankStr = group(m, 1, in: lineStripped),
               let r = Int(rankStr) {
                rank = r
                continue
            }

            // Metadata: PRE: score, word
            if let m = firstMatch(preRegex, in: lineStripped),
               let scoreStr = group(m, 1, in: lineStripped),
               let score = Int(scoreStr),
               let word = group(m, 2, in: lineStripped) {
                preMentalState = ParsedPreMentalState(score: score, word: word.trimmingCharacters(in: .whitespacesAndNewlines))
                continue
            }

            // Separator
            if lineStripped == "---" {
                hasSeparator = true
                inFriendlies = true
                continue
            }

            if allowMatchParsing, matches(rawMarkerRegex, lineStripped) {
                if let game = parseGameLine(lineStripped) {
                    if inFriendlies { friendlyGames.append(game) } else { rankedGames.append(game) }
                } else {
                    warnings.append("Line \(i) skipped: malformed input '\(lineStripped)'")
                    freeTextLines.append(lineStripped)
                }
                continue
            }

            freeTextLines.append(lineStripped)
        }

        let allGames = rankedGames + friendlyGames
        if allGames.isEmpty {
            // No game parsed, so this is free text. Warnings are dropped with the match
            // reading: a line that failed the game regex is just prose in a note.
            let leftover = freeTextLines
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let note = [notes ?? "", leftover]
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            if note.isEmpty { return nil }
            return ParsedDescription(
                notes: note,
                rank: rank,
                preMentalState: preMentalState,
                ranked: [],
                friendlies: [],
                hasSeparator: false,
                warnings: []
            )
        }

        return ParsedDescription(
            notes: notes,
            rank: rank,
            preMentalState: preMentalState,
            ranked: rankedGames,
            friendlies: friendlyGames,
            hasSeparator: hasSeparator,
            warnings: warnings
        )
    }

    /// Turns a parsed description into the formatted description string.
    static func formatDescription(_ parsed: ParsedDescription) -> String {
        // A note has no games to summarize, so it formats to itself — a "0W-0L (0%)" header
        // over someone's training note would be nonsense, and would break the round trip.
        if parsed.isPlainNote {
            var noteLines: [String] = []
            if let notes = parsed.notes, !notes.isEmpty { noteLines.append(notes) }
            // Re-emit the metadata the parser lifted out of the text. On a match these survive
            // in match_history.json; a note writes no history, so anything not put back here is
            // deleted from what the athlete typed.
            if let rank = parsed.rank { noteLines.append("#rank \(rank)") }
            if let pre = parsed.preMentalState {
                noteLines.append("PRE: \(pre.score), \(pre.word)")
            }
            return noteLines.joined(separator: "\n")
        }

        var lines: [String] = []

        // Notes at top
        if let notes = parsed.notes, !notes.isEmpty {
            lines.append(notes)
            lines.append("")
        }

        // Summary line — W/L counts ranked games only if separator present,
        // otherwise all games count.
        let countGames = parsed.hasSeparator ? parsed.ranked : parsed.ranked + parsed.friendlies
        let wins = countGames.filter { $0.won }.count
        let losses = countGames.count - wins
        let total = countGames.count
        let pct = total > 0 ? Int((Double(wins) / Double(total) * 100).rounded()) : 0

        var summary = "\(wins)W-\(losses)L (\(pct)%)"
        if let rank = parsed.rank {
            summary += " | Rank: #\(rank)"
        }
        lines.append(summary)

        func fmtGame(_ g: ParsedGame) -> String {
            let result = g.won ? "W" : "L"
            let oppStr = g.vs.joined(separator: " + ")
            if g.isSingles {
                return "\(result) \(g.score) vs \(oppStr)"
            } else {
                let partnerName = g.partner ?? ""
                return "\(result) \(g.score) w/ \(partnerName) vs \(oppStr)"
            }
        }

        // Ranked / main games
        if !parsed.ranked.isEmpty {
            lines.append("")
            lines.append("Games:")
            for g in parsed.ranked { lines.append(fmtGame(g)) }
        }

        // Friendlies
        if !parsed.friendlies.isEmpty {
            lines.append("")
            lines.append("Friendlies:")
            for g in parsed.friendlies { lines.append(fmtGame(g)) }
        }

        return lines.joined(separator: "\n")
    }

    /// Builds a structured entry suitable for appending to match_history.json.
    static func buildStructuredEntry(_ parsed: ParsedDescription, date: String, activityId: Int?) -> MatchSession {
        let allGames = parsed.ranked + parsed.friendlies
        let wins = allGames.filter { $0.won }.count
        let losses = allGames.count - wins
        let total = allGames.count
        let pct = total > 0 ? Int((Double(wins) / Double(total) * 100).rounded()) : 0

        var games: [MatchGame] = []
        for g in parsed.ranked {
            let parts = g.score.components(separatedBy: "-")
            let scoreFor = Int(parts.first ?? "0") ?? 0
            let scoreAgainst = Int(parts.last ?? "0") ?? 0
            let result = g.won ? "W" : "L"
            let format = g.isSingles ? "singles" : "doubles"
            let partner = g.isSingles ? nil : (g.partner?.isEmpty == false ? g.partner : nil)
            games.append(MatchGame(format: format, category: "ranked", partner: partner, opponents: g.vs, scoreFor: scoreFor, scoreAgainst: scoreAgainst, result: result, preNote: g.preNote, postNote: g.postNote))
        }
        for g in parsed.friendlies {
            let parts = g.score.components(separatedBy: "-")
            let scoreFor = Int(parts.first ?? "0") ?? 0
            let scoreAgainst = Int(parts.last ?? "0") ?? 0
            let result = g.won ? "W" : "L"
            let format = g.isSingles ? "singles" : "doubles"
            let partner = g.isSingles ? nil : (g.partner?.isEmpty == false ? g.partner : nil)
            games.append(MatchGame(format: format, category: "friendly", partner: partner, opponents: g.vs, scoreFor: scoreFor, scoreAgainst: scoreAgainst, result: result, preNote: g.preNote, postNote: g.postNote))
        }

        return MatchSession(
            date: date,
            activityId: activityId,
            preMentalState: parsed.preMentalState.map { MatchPreMentalState(score: $0.score, word: $0.word) },
            rank: parsed.rank,
            notes: parsed.notes,
            summary: MatchSummary(wins: wins, losses: losses, winPct: pct),
            games: games
        )
    }

    // MARK: - Line parsers

    /// Parses a single Format A game line. Returns nil if malformed.
    private static func parseGameLine(_ line: String) -> ParsedGame? {
        var lineClean = line.trimmingCharacters(in: .whitespacesAndNewlines)

        var preNote: String?
        var postNote: String?
        if let (before, mental) = splitOnce(lineClean, " | ") {
            lineClean = before
            if let (pre, post) = splitOnce(mental, " :: ") {
                preNote = pre.trimmingCharacters(in: .whitespacesAndNewlines)
                postNote = post.trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                preNote = mental.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        guard let m = firstMatch(gameRegex, in: lineClean),
              let opponentsRaw = group(m, 2, in: lineClean),
              let scoreRaw = group(m, 3, in: lineClean) else {
            return nil
        }

        let partnerRaw = group(m, 1, in: lineClean)
        let partnerClean = partnerRaw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let isSingles = partnerClean.isEmpty
        let partner: String? = isSingles ? nil : partnerClean
        let opponentsStr = opponentsRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        let score = scoreRaw.trimmingCharacters(in: .whitespacesAndNewlines)

        let opponents = opponentsStr.components(separatedBy: "/").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let scoreParts = score.components(separatedBy: "-")
        guard scoreParts.count == 2, let our = Int(scoreParts[0]), let theirs = Int(scoreParts[1]) else {
            return nil
        }
        let won = our > theirs

        return ParsedGame(partner: partner, vs: opponents, score: score, won: won, preNote: preNote, postNote: postNote, isSingles: isSingles)
    }

    // MARK: - Regex helpers

    private static func firstMatch(_ regex: NSRegularExpression, in text: String) -> NSTextCheckingResult? {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, options: [], range: range)
    }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        firstMatch(regex, in: text) != nil
    }

    private static func group(_ match: NSTextCheckingResult, _ index: Int, in text: String) -> String? {
        guard index < match.numberOfRanges,
              let range = Range(match.range(at: index), in: text) else { return nil }
        return String(text[range])
    }

    /// Mirrors Python's `str.split(sep, 1)` — splits into (before, after) on the first
    /// occurrence of `sep`, or returns nil if `sep` isn't present.
    private static func splitOnce(_ s: String, _ sep: String) -> (String, String)? {
        guard let r = s.range(of: sep) else { return nil }
        return (String(s[s.startIndex..<r.lowerBound]), String(s[r.upperBound...]))
    }
}
