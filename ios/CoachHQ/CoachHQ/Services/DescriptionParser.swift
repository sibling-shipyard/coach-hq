import Foundation

/// Canonical badminton match parser (ADR 0013). Parses raw scores pasted on-device
///
/// Parses raw badminton match descriptions (pasted into the description field on-device)
/// and produces:
///   1. A formatted description string (same shape the old Strava pipeline used to write)
///   2. A structured `MatchSession` for `user_data/activities/match_history.json`
///
/// Supports input format for ranked/friendly games:
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

    // eBadders table header: "Winners\tScore\tOpponents" (tabs collapse to whitespace here
    // since we only need to *detect* the header, not split it).
    private static let ebaddersHeaderRegex = try! NSRegularExpression(
        pattern: #"^winners\s+score\s+opponents"#,
        options: [.caseInsensitive]
    )

    // eBadders table row: `{team1}\t+{score}\t+{team2}\t*`
    private static let ebaddersLineRegex = try! NSRegularExpression(
        pattern: #"^(.+?)\t+(\d+-\d+)\t+(.+?)(?:\t*)$"#
    )

    private static let rankRegex = try! NSRegularExpression(
        pattern: #"^#rank\s+(\d+)$"#,
        options: [.caseInsensitive]
    )

    private static let preRegex = try! NSRegularExpression(
        pattern: #"^PRE:\s*(\d+),\s*(.+)$"#,
        options: [.caseInsensitive]
    )

    private static let crownCharacters: Set<Character> = ["♕", "♔", "♛", "♚"]

    // MARK: Public API

    /// Returns true if the description already contains the formatted marker (idempotency check).
    static func isAlreadyFormatted(_ description: String) -> Bool {
        description.contains(formattedMarker)
    }

    /// Parses a raw match description string.
    ///
    /// Returns nil if the input is empty, already formatted, or has no parseable games.
    static func parseRawDescription(_ raw: String, athleteName: String = "me") -> ParsedDescription? {
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
        var inEbaddersTable = false
        var hadEbaddersTable = false

        let normalized = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.components(separatedBy: "\n")

        for (idx, line) in lines.enumerated() {
            let i = idx + 1
            let lineStripped = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if lineStripped.isEmpty { continue }

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
                inEbaddersTable = false
                continue
            }

            // eBadders table header detection
            if firstMatch(ebaddersHeaderRegex, in: lineStripped) != nil {
                inEbaddersTable = true
                hadEbaddersTable = true
                continue
            }

            // Try eBadders table format first (if we're in a table)
            if inEbaddersTable && line.contains("\t") {
                if let game = parseEbaddersLine(line, athleteName: athleteName) {
                    if inFriendlies { friendlyGames.append(game) } else { rankedGames.append(game) }
                } else {
                    // Tab-separated line but couldn't parse
                    let withoutTabs = lineStripped.replacingOccurrences(of: "\t", with: "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if withoutTabs.isEmpty { continue }
                    warnings.append("Line \(i) skipped: malformed eBadders row '\(lineStripped)'")
                }
                continue
            }

            // Even without header, try eBadders format if line has tabs and "+"
            if !inEbaddersTable && line.contains("\t") && line.contains("+") {
                if let game = parseEbaddersLine(line, athleteName: athleteName) {
                    if inFriendlies { friendlyGames.append(game) } else { rankedGames.append(game) }
                    continue
                }
            }

            // Try Format A (manual entry)
            if matches(rawMarkerRegex, lineStripped) {
                if let game = parseGameLine(lineStripped) {
                    if inFriendlies { friendlyGames.append(game) } else { rankedGames.append(game) }
                } else {
                    warnings.append("Line \(i) skipped: malformed input '\(lineStripped)'")
                }
                continue
            }
        }

        // eBadders table rows are in reverse chronological order. Reverse them.
        if hadEbaddersTable && !rankedGames.isEmpty {
            rankedGames.reverse()
        }

        let allGames = rankedGames + friendlyGames
        if allGames.isEmpty {
            return nil
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

    /// Parses a single eBadders table row (tab-separated).
    /// Determines W/L based on which side contains athleteName. Returns nil if unparseable.
    private static func parseEbaddersLine(_ line: String, athleteName: String) -> ParsedGame? {
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

        guard let m = firstMatch(ebaddersLineRegex, in: lineClean),
              let winnersRaw = group(m, 1, in: lineClean),
              let scoreRawG = group(m, 2, in: lineClean),
              let losersRaw = group(m, 3, in: lineClean) else {
            return nil
        }

        var scoreRaw = scoreRawG.trimmingCharacters(in: .whitespacesAndNewlines)
        let winnersClean = stripCrownCharacters(winnersRaw.trimmingCharacters(in: .whitespacesAndNewlines))
        let losersClean = stripCrownCharacters(losersRaw.trimmingCharacters(in: .whitespacesAndNewlines))

        let winners = winnersClean.components(separatedBy: "+").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let losers = losersClean.components(separatedBy: "+").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

        let playerRegex = try! NSRegularExpression(
            pattern: #"\b\#(NSRegularExpression.escapedPattern(for: athleteName))\b"#,
            options: [.caseInsensitive]
        )

        let playerInWinners = winners.contains { matches(playerRegex, $0) }
        let playerInLosers = losers.contains { matches(playerRegex, $0) }

        if !playerInWinners && !playerInLosers {
            // Player not in this game — skip
            return nil
        }

        let won: Bool
        let partnerList: [String]
        let opponents: [String]

        if playerInWinners {
            won = true
            partnerList = winners.filter { !matches(playerRegex, $0) }
            opponents = losers
        } else {
            won = false
            partnerList = losers.filter { !matches(playerRegex, $0) }
            opponents = winners
            // Flip the score so it's always athlete's score first
            let parts = scoreRaw.components(separatedBy: "-")
            if parts.count == 2 {
                scoreRaw = "\(parts[1])-\(parts[0])"
            }
        }

        let rawPartner = partnerList.first ?? "Solo"
        let isSingles = rawPartner == "Solo"
        let partner = isSingles ? nil : rawPartner

        return ParsedGame(partner: partner, vs: opponents, score: scoreRaw, won: won, preNote: preNote, postNote: postNote, isSingles: isSingles)
    }

    private static func stripCrownCharacters(_ s: String) -> String {
        String(s.filter { !crownCharacters.contains($0) }).trimmingCharacters(in: .whitespacesAndNewlines)
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
