import Foundation

/// Pure Swift port of `scripts/parse_match_description.py`.
///
/// Parses raw badminton match descriptions (pasted into the description field on-device)
/// and produces:
///   1. A formatted description string (same shape the old Strava pipeline used to write)
///   2. A structured `EbaddersEntry` for `training/ebadders_history.json`
///
/// Supports two input formats for ranked games:
///
/// Format A — manual entry:
///     {partner} me vs {opp1}/{opp2} {our_score}-{their_score}
///
/// Format B — eBadders table copy-paste (tab-separated):
///     Winners	Score	Opponents
///     Mui + Akash	21-14	Frankiee + Maggie
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
    var partner: String
    var vs: [String]
    var score: String
    var akashWon: Bool
    var preNote: String?
    var postNote: String?
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

// MARK: - ebadders_history.json models

struct EbaddersMatch: Codable, Equatable {
    var partner: String
    var vs: [String]
    var score: String
    var akashWon: Bool
    var preNote: String?
    var postNote: String?

    // Set only when decoded from the legacy eBadders array shape (see
    // init(from:)). Preserved so encode(to:) round-trips these entries back
    // into that same array shape instead of silently normalizing them to a
    // plain string — the dashboard's TS fallback parser
    // (ui/client/src/lib/matchParser.ts, parseEbadders) still reads `partner`
    // as `string[]` for these entries, and 28 activities in the currently
    // shipped ui/client/src/data/activities.json still carry that shape.
    // Confirmed by inspecting both files directly before writing this.
    private var rawPartnerArray: [String]?

    // Legacy eBadders-scraper fields with no equivalent in our own model and no
    // consumer anywhere in ui/ (checked: zero references in ui/client/src or
    // ui/scripts). Nothing reads them, but they're still real historical
    // provenance data — preserve on round-trip rather than silently dropping
    // them from every legacy match every time any entry gets saved.
    private var rawWinners: [String]?
    private var rawOpponents: [String]?
    private var rawAkashTeam: String?

    enum CodingKeys: String, CodingKey {
        case partner
        case vs
        case score
        case akashWon = "akash_won"
        case preNote = "pre_note"
        case postNote = "post_note"
        case winners
        case opponents
        case akashTeam = "akash_team"
    }

    init(partner: String, vs: [String], score: String, akashWon: Bool, preNote: String? = nil, postNote: String? = nil) {
        self.partner = partner
        self.vs = vs
        self.score = score
        self.akashWon = akashWon
        self.preNote = preNote
        self.postNote = postNote
        self.rawPartnerArray = nil
        self.rawWinners = nil
        self.rawOpponents = nil
        self.rawAkashTeam = nil
    }

    // Custom decode: legacy eBadders-scraped entries (merge_ebadders.py era, no
    // "source" field) store `partner` as a single-element array (e.g. ["Dom L"])
    // instead of a plain string. Confirmed against the real ebadders_history.json —
    // accept either shape rather than failing the whole array decode.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let single = try? container.decode(String.self, forKey: .partner) {
            partner = single
            rawPartnerArray = nil
        } else {
            let arr = try container.decode([String].self, forKey: .partner)
            rawPartnerArray = arr
            partner = arr.joined(separator: " & ")
        }
        vs = try container.decode([String].self, forKey: .vs)
        score = try container.decode(String.self, forKey: .score)
        akashWon = try container.decode(Bool.self, forKey: .akashWon)
        preNote = try container.decodeIfPresent(String.self, forKey: .preNote)
        postNote = try container.decodeIfPresent(String.self, forKey: .postNote)
        rawWinners = try container.decodeIfPresent([String].self, forKey: .winners)
        rawOpponents = try container.decodeIfPresent([String].self, forKey: .opponents)
        rawAkashTeam = try container.decodeIfPresent(String.self, forKey: .akashTeam)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let rawPartnerArray {
            try container.encode(rawPartnerArray, forKey: .partner)
        } else {
            try container.encode(partner, forKey: .partner)
        }
        try container.encode(vs, forKey: .vs)
        try container.encode(score, forKey: .score)
        try container.encode(akashWon, forKey: .akashWon)
        try container.encodeIfPresent(preNote, forKey: .preNote)
        try container.encodeIfPresent(postNote, forKey: .postNote)
        try container.encodeIfPresent(rawWinners, forKey: .winners)
        try container.encodeIfPresent(rawOpponents, forKey: .opponents)
        try container.encodeIfPresent(rawAkashTeam, forKey: .akashTeam)
    }
}

struct EbaddersPreMentalState: Codable, Equatable {
    var score: Int
    var word: String
}

struct EbaddersEntry: Codable, Equatable {
    var date: String
    var activityId: Int?
    var preMentalState: EbaddersPreMentalState?
    // Optional: real ebadders_history.json has 63 of 79 entries (everything
    // predating this field) with no "source" key at all. Decoding this as a
    // non-optional String made every single read of the real file fail —
    // confirmed live: Save & Sync errored on every attempt with "the data
    // couldn't be read because it's missing" (DecodingError.keyNotFound on
    // .source, bridged to that generic Foundation message).
    var source: String?
    var wins: Int
    var losses: Int
    var total: Int
    var winPct: Int
    var matches: [EbaddersMatch]

    // Legacy eBadders-scraper fields with no equivalent in our own model and no
    // consumer anywhere in ui/ (checked: zero references in ui/client/src or
    // ui/scripts). Preserved on round-trip for the same reason as the match-level
    // raw* fields above — real historical provenance, don't silently drop it.
    private var rawSessionId: String?
    private var rawDateText: String?
    private var rawUrl: String?
    private var rawWinLoss: String?
    // One real entry (2026-06-01) also carries a redundant ranked/friendlies
    // breakdown alongside `matches` (their concatenation, already complete and
    // authoritative — confirmed by summing: 8 ranked + 2 friendlies = 10 =
    // wins+losses). Preserved verbatim like the other raw* fields; never read.
    private var rawRanked: [EbaddersMatch]?
    private var rawFriendlies: [EbaddersMatch]?

    enum CodingKeys: String, CodingKey {
        case date
        case activityId = "activity_id"
        case preMentalState = "pre_mental_state"
        case source
        case wins
        case losses
        case total
        case winPct = "win_pct"
        case matches
        case rawSessionId = "session_id"
        case rawDateText = "date_text"
        case rawUrl = "url"
        case rawWinLoss = "win_loss"
        case rawRanked = "ranked"
        case rawFriendlies = "friendlies"
    }

    init(
        date: String, activityId: Int?, preMentalState: EbaddersPreMentalState?, source: String?,
        wins: Int, losses: Int, total: Int, winPct: Int, matches: [EbaddersMatch]
    ) {
        self.date = date
        self.activityId = activityId
        self.preMentalState = preMentalState
        self.source = source
        self.wins = wins
        self.losses = losses
        self.total = total
        self.winPct = winPct
        self.matches = matches
        self.rawSessionId = nil
        self.rawDateText = nil
        self.rawUrl = nil
        self.rawWinLoss = nil
        self.rawRanked = nil
        self.rawFriendlies = nil
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        date = try container.decode(String.self, forKey: .date)
        activityId = try container.decodeIfPresent(Int.self, forKey: .activityId)
        preMentalState = try container.decodeIfPresent(EbaddersPreMentalState.self, forKey: .preMentalState)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        wins = try container.decode(Int.self, forKey: .wins)
        losses = try container.decode(Int.self, forKey: .losses)
        total = try container.decode(Int.self, forKey: .total)
        winPct = try container.decode(Int.self, forKey: .winPct)
        matches = try container.decode([EbaddersMatch].self, forKey: .matches)
        rawSessionId = try container.decodeIfPresent(String.self, forKey: .rawSessionId)
        rawDateText = try container.decodeIfPresent(String.self, forKey: .rawDateText)
        rawUrl = try container.decodeIfPresent(String.self, forKey: .rawUrl)
        rawWinLoss = try container.decodeIfPresent(String.self, forKey: .rawWinLoss)
        rawRanked = try container.decodeIfPresent([EbaddersMatch].self, forKey: .rawRanked)
        rawFriendlies = try container.decodeIfPresent([EbaddersMatch].self, forKey: .rawFriendlies)
    }

    // Custom encode so `activity_id` and `pre_mental_state` are always emitted
    // (as explicit `null` when absent) — matches the Python pipeline's
    // `json.dumps` output shape, where every entry always has both keys.
    // `source` is the opposite: real legacy entries genuinely lack the key,
    // so it's omitted (not nulled) when absent, preserving their original shape.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(date, forKey: .date)
        try container.encode(activityId, forKey: .activityId)
        try container.encode(preMentalState, forKey: .preMentalState)
        try container.encodeIfPresent(source, forKey: .source)
        try container.encode(wins, forKey: .wins)
        try container.encode(losses, forKey: .losses)
        try container.encode(total, forKey: .total)
        try container.encode(winPct, forKey: .winPct)
        try container.encode(matches, forKey: .matches)
        try container.encodeIfPresent(rawSessionId, forKey: .rawSessionId)
        try container.encodeIfPresent(rawDateText, forKey: .rawDateText)
        try container.encodeIfPresent(rawUrl, forKey: .rawUrl)
        try container.encodeIfPresent(rawWinLoss, forKey: .rawWinLoss)
        try container.encodeIfPresent(rawRanked, forKey: .rawRanked)
        try container.encodeIfPresent(rawFriendlies, forKey: .rawFriendlies)
    }
}

// MARK: - Parser

enum DescriptionParser {

    // Detection: already formatted.
    private static let formattedMarker = "Games:\n"

    // --- Regexes (mirrors parse_match_description.py) ---

    // Format A: `{partner} me vs {opponents} {score}`
    private static let gameRegex = try! NSRegularExpression(
        pattern: #"^(.+?)\s+me\s+vs\s+(.+?)\s+(\d+-\d+)$"#,
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

    private static let playerRegex = try! NSRegularExpression(
        pattern: #"\bAkash\b"#,
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
    static func parseRawDescription(_ raw: String) -> ParsedDescription? {
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
                if let game = parseEbaddersLine(line) {
                    if inFriendlies { friendlyGames.append(game) } else { rankedGames.append(game) }
                } else {
                    // Tab-separated line but couldn't parse — might be noise
                    // (trailing empty rows from copy-paste)
                    let withoutTabs = lineStripped.replacingOccurrences(of: "\t", with: "")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if withoutTabs.isEmpty { continue }
                    warnings.append("Line \(i) skipped: malformed eBadders row '\(lineStripped)'")
                }
                continue
            }

            // Even without header, try eBadders format if line has tabs and "+"
            if !inEbaddersTable && line.contains("\t") && line.contains("+") {
                if let game = parseEbaddersLine(line) {
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

            // Unknown line — skip silently (noise from copy-paste)
        }

        // eBadders table rows are in reverse chronological order (last game on top).
        // Reverse ranked games if they came from an eBadders table so game 1 is first.
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
        let wins = countGames.filter { $0.akashWon }.count
        let losses = countGames.count - wins
        let total = countGames.count
        let pct = total > 0 ? Int((Double(wins) / Double(total) * 100).rounded()) : 0

        var summary = "\(wins)W-\(losses)L (\(pct)%)"
        if let rank = parsed.rank {
            summary += " | Rank: #\(rank)"
        }
        lines.append(summary)

        func fmtGame(_ g: ParsedGame) -> String {
            let result = g.akashWon ? "W" : "L"
            let oppStr = g.vs.joined(separator: " + ")
            return "\(result) \(g.score) w/ \(g.partner) vs \(oppStr)"
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

    /// Builds a structured entry suitable for appending to ebadders_history.json.
    static func buildStructuredEntry(_ parsed: ParsedDescription, date: String, activityId: Int?) -> EbaddersEntry {
        let allGames = parsed.ranked + parsed.friendlies
        let wins = allGames.filter { $0.akashWon }.count
        let losses = allGames.count - wins
        let total = allGames.count
        let pct = total > 0 ? Int((Double(wins) / Double(total) * 100).rounded()) : 0

        let matches = allGames.map { g in
            EbaddersMatch(partner: g.partner, vs: g.vs, score: g.score, akashWon: g.akashWon, preNote: g.preNote, postNote: g.postNote)
        }

        return EbaddersEntry(
            date: date,
            activityId: activityId,
            preMentalState: parsed.preMentalState.map { EbaddersPreMentalState(score: $0.score, word: $0.word) },
            source: "manual",
            wins: wins,
            losses: losses,
            total: total,
            winPct: pct,
            matches: matches
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
              let partnerRaw = group(m, 1, in: lineClean),
              let opponentsRaw = group(m, 2, in: lineClean),
              let scoreRaw = group(m, 3, in: lineClean) else {
            return nil
        }

        let partner = partnerRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        let opponentsStr = opponentsRaw.trimmingCharacters(in: .whitespacesAndNewlines)
        let score = scoreRaw.trimmingCharacters(in: .whitespacesAndNewlines)

        let opponents = opponentsStr.components(separatedBy: "/").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        let scoreParts = score.components(separatedBy: "-")
        guard scoreParts.count == 2, let our = Int(scoreParts[0]), let theirs = Int(scoreParts[1]) else {
            return nil
        }
        let won = our > theirs

        return ParsedGame(partner: partner, vs: opponents, score: score, akashWon: won, preNote: preNote, postNote: postNote)
    }

    /// Parses a single eBadders table row (tab-separated).
    /// Determines W/L based on which side contains "Akash". Returns nil if unparseable.
    private static func parseEbaddersLine(_ line: String) -> ParsedGame? {
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

        let akashInWinners = winners.contains { matches(playerRegex, $0) }
        let akashInLosers = losers.contains { matches(playerRegex, $0) }

        if !akashInWinners && !akashInLosers {
            // Akash not in this game — skip
            return nil
        }

        let akashWon: Bool
        let partnerList: [String]
        let opponents: [String]

        if akashInWinners {
            akashWon = true
            partnerList = winners.filter { !matches(playerRegex, $0) }
            opponents = losers
            // Score is already winners-losers from eBadders
        } else {
            akashWon = false
            partnerList = losers.filter { !matches(playerRegex, $0) }
            opponents = winners
            // Flip the score so it's always Akash's team score first
            let parts = scoreRaw.components(separatedBy: "-")
            if parts.count == 2 {
                scoreRaw = "\(parts[1])-\(parts[0])"
            }
        }

        let partner = partnerList.first ?? "Solo"

        return ParsedGame(partner: partner, vs: opponents, score: scoreRaw, akashWon: akashWon, preNote: preNote, postNote: postNote)
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
