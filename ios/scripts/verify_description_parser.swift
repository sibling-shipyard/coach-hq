import Foundation

// Standalone verification harness for DescriptionParser.swift.
//
// There is no Xcode test target in this project, so this ports every case from
// platform/tests/test_parse_match_description.py as plain assertions and runs them via the
// `swift`/`swiftc` CLI directly against the app's DescriptionParser.swift.
//
// Usage:
//   swiftc ios/CoachHQ/CoachHQ/Services/DescriptionParser.swift \
//          ios/scripts/verify_description_parser.swift \
//          -o /tmp/verify_parser && /tmp/verify_parser
//
// Note: this file uses the `@main` struct pattern (rather than bare top-level
// statements) so it can be compiled alongside DescriptionParser.swift without
// needing to be named `main.swift` — Swift only allows unrestricted top-level
// code in a file literally named `main.swift` when compiling multiple files.

final class TestRunner {
    private(set) var passed = 0
    private(set) var failed = 0
    private var failures: [String] = []

    func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        if condition() {
            passed += 1
            print("PASS: \(name)")
        } else {
            failed += 1
            failures.append(name)
            print("FAIL: \(name)")
        }
    }

    func summary() -> Bool {
        print("\n\(passed) passed, \(failed) failed out of \(passed + failed)")
        if !failures.isEmpty {
            print("Failures:")
            for f in failures { print("  - \(f)") }
        }
        return failed == 0
    }
}

@main
struct Verify {
    static func main() {
        let t = TestRunner()

        // ── Test 1: Happy path — single Thursday friendly ──────────────────
        do {
            let raw = "Tony me vs Alston/Wei 21-18"
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_01_happy_path_single_game: parsed not nil", parsed != nil)
            if let parsed = parsed {
                let out = DescriptionParser.formatDescription(parsed)
                t.check("test_01: contains game line", out.contains("W 21-18 w/ Tony vs Alston + Wei"))
                t.check("test_01: contains summary", out.contains("1W-0L (100%)"))
            }
        }

        // ── Test 2: Full session — 11 games ────────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alston/Wei 22-20",
                "Tony me vs Alex/Yin 13-21",
                "Tim me vs Alex/Yin 8-21",
                "Ivor me vs Wei/NewGuy 21-19",
                "Ivor me vs Martin/Joe 18-21",
                "Tony me vs Martin/Joe 21-15",
                "Alston me vs Alex/Yin 17-21",
                "Alston me vs Wei/NewGuy 21-14",
                "Tim me vs Alston/Wei 19-21",
                "Tony me vs Alex/Yin 15-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_02_full_session_11_games: parsed not nil", parsed != nil)
            if let parsed = parsed {
                let out = DescriptionParser.formatDescription(parsed)
                let gameLines = out.components(separatedBy: "\n").filter { $0.hasPrefix("W ") || $0.hasPrefix("L ") }
                t.check("test_02: 11 game lines", gameLines.count == 11)
                t.check("test_02: summary 5W-6L (45%)", out.contains("5W-6L (45%)"))
            }
        }

        // ── Test 3: Monday ranked + friendlies ─────────────────────────────
        do {
            let raw = [
                "Dom L me vs Kean/Harry S 21-16",
                "Edward C me vs Tsz To/Rogie 21-10",
                "Niels G me vs Leon/Gabriella 18-21",
                "---",
                "Manu me vs Joe/Tien 19-21",
                "Manu me vs Richard/Kean 14-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_03_ranked_plus_friendlies: parsed not nil", parsed != nil)
            if let parsed = parsed {
                let out = DescriptionParser.formatDescription(parsed)
                t.check("test_03: summary 2W-1L (67%)", out.contains("2W-1L (67%)"))
                t.check("test_03: contains Games:", out.contains("Games:"))
                t.check("test_03: contains Friendlies:", out.contains("Friendlies:"))

                let gamesSection = out.components(separatedBy: "Games:\n")[1].components(separatedBy: "\nFriendlies:")[0]
                let gamesLines = gamesSection.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
                t.check("test_03: 3 ranked lines", gamesLines.count == 3)

                let friendliesSection = out.components(separatedBy: "Friendlies:\n")[1]
                let friendlyLines = friendliesSection.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n")
                t.check("test_03: 2 friendly lines", friendlyLines.count == 2)
            }
        }

        // ── Test 4: #rank metadata ─────────────────────────────────────────
        do {
            let raw = "#rank 4\nTony me vs Alston/Wei 21-18"
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_04_rank_metadata: contains Rank: #4", out.contains("| Rank: #4"))
        }

        // ── Test 5: #notes metadata ────────────────────────────────────────
        do {
            let raw = "#notes Good session. Played calm.\nTony me vs Alston/Wei 21-18"
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            let lines = out.components(separatedBy: "\n")
            t.check("test_05_notes_metadata: first line is notes", lines.first == "Good session. Played calm.")
        }

        // ── Test 6: Both #rank and #notes ──────────────────────────────────
        do {
            let raw = [
                "#notes Great day",
                "#rank 7",
                "Tony me vs Alston/Wei 21-18",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            let lines = out.components(separatedBy: "\n")
            t.check("test_06: first line is notes", lines.first == "Great day")
            t.check("test_06: contains Rank: #7", out.contains("| Rank: #7"))
        }

        // ── Test 7: Reversed metadata order ────────────────────────────────
        do {
            let raw = [
                "#rank 3",
                "#notes Tired legs",
                "Tony me vs Alston/Wei 21-18",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            let lines = out.components(separatedBy: "\n")
            t.check("test_07: first line is notes", lines.first == "Tired legs")
            t.check("test_07: contains Rank: #3", out.contains("| Rank: #3"))
        }

        // ── Test 8: Deuce scores ───────────────────────────────────────────
        do {
            let raw = "Ivor me vs Alston/Martin 23-25"
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_08_deuce_scores", out.contains("L 23-25 w/ Ivor vs Alston + Martin"))
        }

        // ── Test 9: Partner with space in name ─────────────────────────────
        do {
            let raw = "Dom L me vs Kean/Harry S 21-16"
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_09_partner_with_space", out.contains("w/ Dom L vs Kean + Harry S"))
        }

        // ── Test 10: Single opponent (singles) ─────────────────────────────
        do {
            let raw = "Ivor me vs Alston 21-18"
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_10_singles: contains line", out.contains("W 21-18 w/ Ivor vs Alston"))
            let afterGames = out.components(separatedBy: "Games:").last ?? ""
            t.check("test_10_singles: no '+' after Games:", !afterGames.contains("+"))
        }

        // ── Test 11: Malformed line — missing score ────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alston/Wei",
                "Tony me vs Alston/Wei 15-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_11: parsed not nil", parsed != nil)
            if let parsed = parsed {
                t.check("test_11: exactly 1 warning", parsed.warnings.count == 1)
                t.check("test_11: warning mentions malformed", parsed.warnings.first?.lowercased().contains("malformed") ?? false)
                let out = DescriptionParser.formatDescription(parsed)
                let gameLines = out.components(separatedBy: "\n").filter { $0.hasPrefix("W ") || $0.hasPrefix("L ") }
                t.check("test_11: 2 game lines", gameLines.count == 2)
            }
        }

        // ── Test 12: Malformed line — missing "me vs" ──────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony Alston/Wei 21-18",
                "Tony me vs Alston/Wei 15-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_12: parsed not nil", parsed != nil)
            if let parsed = parsed {
                let out = DescriptionParser.formatDescription(parsed)
                let gameLines = out.components(separatedBy: "\n").filter { $0.hasPrefix("W ") || $0.hasPrefix("L ") }
                t.check("test_12: 2 game lines (noise skipped)", gameLines.count == 2)
            }
        }

        // ── Test 13: Unrecognized line (noise) ─────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Had a great time tonight",
                "Tony me vs Alston/Wei 15-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_13: parsed not nil", parsed != nil)
            if let parsed = parsed {
                t.check("test_13: no warnings", parsed.warnings.isEmpty)
                let out = DescriptionParser.formatDescription(parsed)
                let gameLines = out.components(separatedBy: "\n").filter { $0.hasPrefix("W ") || $0.hasPrefix("L ") }
                t.check("test_13: 2 game lines", gameLines.count == 2)
            }
        }

        // ── Test 14: Already formatted (idempotent) ────────────────────────
        do {
            let formatted = "4W-7L (36%)\n\nGames:\nW 21-18 w/ Tony vs Alston + Wei"
            let result = DescriptionParser.parseRawDescription(formatted)
            t.check("test_14_already_formatted: nil", result == nil)
        }

        // ── Test 15: Empty input ───────────────────────────────────────────
        do {
            t.check("test_15_empty_input: empty string", DescriptionParser.parseRawDescription("") == nil)
            t.check("test_15_empty_input: whitespace only", DescriptionParser.parseRawDescription("   \n\n  ") == nil)
        }

        // ── Test 16: Only metadata, no games ───────────────────────────────
        do {
            let raw = "#notes Just warming up\n#rank 5"
            let result = DescriptionParser.parseRawDescription(raw)
            t.check("test_16_only_metadata: nil", result == nil)
        }

        // ── Test 17: Win percentage rounding ───────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alston/Wei 18-21",
                "Tony me vs Alston/Wei 15-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_17_win_pct_rounding: 1W-2L (33%)", out.contains("1W-2L (33%)"))
        }

        // ── Test 18: All wins ──────────────────────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alston/Wei 21-15",
                "Tony me vs Alston/Wei 21-10",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_18_all_wins: 3W-0L (100%)", out.contains("3W-0L (100%)"))
        }

        // ── Test 19: All losses ────────────────────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 18-21",
                "Tony me vs Alston/Wei 15-21",
                "Tony me vs Alston/Wei 10-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_19_all_losses: 0W-3L (0%)", out.contains("0W-3L (0%)"))
        }

        // ── Test 20: --- with no friendlies after ──────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alston/Wei 22-20",
                "Tony me vs Alex/Yin 13-21",
                "---",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_20: contains Games:", out.contains("Games:"))
            t.check("test_20: no Friendlies:", !out.contains("Friendlies:"))
            t.check("test_20: 2W-1L (67%)", out.contains("2W-1L (67%)"))
        }

        // ── Test 21: Case-insensitive "me vs" ──────────────────────────────
        do {
            let raw = "Tony ME VS Alston/Wei 21-18"
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_21: parsed not nil", parsed != nil)
            let out = parsed.map { DescriptionParser.formatDescription($0) } ?? ""
            t.check("test_21_case_insensitive", out.contains("W 21-18 w/ Tony vs Alston + Wei"))
        }

        // ── Test: build_structured_entry ────────────────────────────────────
        do {
            let raw = [
                "Tony me vs Alston/Wei 21-18",
                "Tony me vs Alex/Yin 13-21",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("test_structured_entry: parsed not nil", parsed != nil)
            if let parsed = parsed {
                let entry = DescriptionParser.buildStructuredEntry(parsed, date: "2026-03-27", activityId: 12345678)
                t.check("test_structured_entry: date", entry.date == "2026-03-27")
                t.check("test_structured_entry: activity_id", entry.activityId == 12345678)
                t.check("test_structured_entry: source", entry.source == "manual")
                t.check("test_structured_entry: wins", entry.wins == 1)
                t.check("test_structured_entry: losses", entry.losses == 1)
                t.check("test_structured_entry: total", entry.total == 2)
                t.check("test_structured_entry: win_pct", entry.winPct == 50)
                t.check("test_structured_entry: 2 matches", entry.matches.count == 2)
                t.check("test_structured_entry: match[0] won", entry.matches[0].akashWon == true)
                t.check("test_structured_entry: match[1] lost", entry.matches[1].akashWon == false)
            }
        }

        // ── Test: is_already_formatted ──────────────────────────────────────
        do {
            t.check(
                "test_formatted_detected",
                DescriptionParser.isAlreadyFormatted("3W-0L (100%)\n\nGames:\nW 21-18 w/ Tony vs A + B")
            )
            t.check(
                "test_raw_not_detected",
                !DescriptionParser.isAlreadyFormatted("Tony me vs Alston/Wei 21-18")
            )
        }

        // ── Bonus: Format B (eBadders table) sanity checks ──────────────────
        // Not present in the Python test file, but the format is part of the spec
        // (see parse_match_description.py docstring) — added for extra confidence.
        do {
            let raw = [
                "Winners\tScore\tOpponents",
                "Mui + Akash\t21-14\tFrankiee + Maggie",
                "Frankiee + Maggie\t21-19\tMui + Akash",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("bonus_ebadders_table: parsed not nil", parsed != nil)
            if let parsed = parsed {
                t.check("bonus_ebadders_table: 2 ranked games", parsed.ranked.count == 2)
                // Table is newest-first (row 1 = most recent game), so after the parser's
                // reversal, row 2 (older) becomes ranked[0] and row 1 (newer) becomes ranked[1].
                t.check("bonus_ebadders_table: game 1 (oldest, row 2) is a loss", parsed.ranked.first?.akashWon == false)
                t.check("bonus_ebadders_table: game 1 partner is Mui", parsed.ranked.first?.partner == "Mui")
                t.check("bonus_ebadders_table: game 1 score flipped to 19-21", parsed.ranked.first?.score == "19-21")
                t.check("bonus_ebadders_table: game 2 (newest, row 1) is a win", parsed.ranked.last?.akashWon == true)
                t.check("bonus_ebadders_table: game 2 score is 21-14", parsed.ranked.last?.score == "21-14")
            }
        }

        do {
            // Singles row (no partner) -> "Solo"
            let raw = [
                "Winners\tScore\tOpponents",
                "Akash\t21-14\tFrankiee",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("bonus_ebadders_solo: parsed not nil", parsed != nil)
            t.check("bonus_ebadders_solo: partner is Solo", parsed?.ranked.first?.partner == "Solo")
        }

        do {
            // Row without Akash on either side should be skipped (no games -> nil overall
            // if it's the only row).
            let raw = [
                "Winners\tScore\tOpponents",
                "Frankiee + Maggie\t21-14\tSomeone + Else",
            ].joined(separator: "\n")
            let parsed = DescriptionParser.parseRawDescription(raw)
            t.check("bonus_ebadders_no_akash: nil (no games)", parsed == nil)
        }

        let ok = t.summary()
        exit(ok ? 0 : 1)
    }
}
