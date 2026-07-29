#!/usr/bin/env python3
"""
20 unit tests for parse_match_description.py
Covers all cases from coach-phelps issue #8.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "platform" / "scripts"))

from parse_match_description import (
    parse_raw_description,
    format_description,
    build_structured_entry,
    is_already_formatted,
)


class TestParseMatchDescription(unittest.TestCase):
    """Tests 1-20 mapped to issue #8 test matrix."""

    # ── Test 1: Happy path — single Thursday friendly ──────────────────
    def test_01_happy_path_single_game(self):
        raw = "Tony me vs Alston/Wei 21-18"
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        out = format_description(parsed)
        self.assertIn("W 21-18 w/ Tony vs Alston + Wei", out)
        self.assertIn("1W-0L (100%)", out)

    # ── Test 2: Full session — 11 games ────────────────────────────────
    def test_02_full_session_11_games(self):
        raw = "\n".join([
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
        ])
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        out = format_description(parsed)
        # Count W and L in output lines
        game_lines = [l for l in out.splitlines() if l.startswith(("W ", "L "))]
        self.assertEqual(len(game_lines), 11)
        self.assertIn("5W-6L (45%)", out)

    # ── Test 3: Monday ranked + friendlies ─────────────────────────────
    def test_03_ranked_plus_friendlies(self):
        raw = "\n".join([
            "Dom L me vs Kean/Harry S 21-16",
            "Edward C me vs Tsz To/Rogie 21-10",
            "Niels G me vs Leon/Gabriella 18-21",
            "---",
            "Manu me vs Joe/Tien 19-21",
            "Manu me vs Richard/Kean 14-21",
        ])
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        out = format_description(parsed)
        # Summary counts ranked only (2W-1L)
        self.assertIn("2W-1L (67%)", out)
        self.assertIn("Games:", out)
        self.assertIn("Friendlies:", out)
        # 3 ranked + 2 friendly game lines
        games_section = out.split("Games:\n")[1].split("\nFriendlies:")[0]
        self.assertEqual(len(games_section.strip().splitlines()), 3)
        friendlies_section = out.split("Friendlies:\n")[1]
        self.assertEqual(len(friendlies_section.strip().splitlines()), 2)

    # ── Test 4: #rank metadata ─────────────────────────────────────────
    def test_04_rank_metadata(self):
        raw = "#rank 4\nTony me vs Alston/Wei 21-18"
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("| Rank: #4", out)

    # ── Test 5: #notes metadata ────────────────────────────────────────
    def test_05_notes_metadata(self):
        raw = "#notes Good session. Played calm.\nTony me vs Alston/Wei 21-18"
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        lines = out.splitlines()
        self.assertEqual(lines[0], "Good session. Played calm.")

    # ── Test 6: Both #rank and #notes ──────────────────────────────────
    def test_06_both_rank_and_notes(self):
        raw = "\n".join([
            "#notes Great day",
            "#rank 7",
            "Tony me vs Alston/Wei 21-18",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        lines = out.splitlines()
        self.assertEqual(lines[0], "Great day")
        self.assertIn("| Rank: #7", out)

    # ── Test 7: Reversed metadata order ────────────────────────────────
    def test_07_reversed_metadata_order(self):
        raw = "\n".join([
            "#rank 3",
            "#notes Tired legs",
            "Tony me vs Alston/Wei 21-18",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        lines = out.splitlines()
        self.assertEqual(lines[0], "Tired legs")
        self.assertIn("| Rank: #3", out)

    # ── Test 8: Deuce scores ───────────────────────────────────────────
    def test_08_deuce_scores(self):
        raw = "Ivor me vs Alston/Martin 23-25"
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("L 23-25 w/ Ivor vs Alston + Martin", out)

    # ── Test 9: Partner with space in name ─────────────────────────────
    def test_09_partner_with_space(self):
        raw = "Dom L me vs Kean/Harry S 21-16"
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("w/ Dom L vs Kean + Harry S", out)

    # ── Test 10: Single opponent (singles) ─────────────────────────────
    def test_10_singles(self):
        raw = "Ivor me vs Alston 21-18"
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("W 21-18 w/ Ivor vs Alston", out)
        self.assertNotIn("+", out.split("Games:")[1])

    # ── Test 11: Malformed line — missing score ────────────────────────
    def test_11_malformed_missing_score(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alston/Wei",
            "Tony me vs Alston/Wei 15-21",
        ])
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["warnings"]), 1)
        self.assertIn("malformed", parsed["warnings"][0].lower())
        out = format_description(parsed)
        game_lines = [l for l in out.splitlines() if l.startswith(("W ", "L "))]
        self.assertEqual(len(game_lines), 2)

    # ── Test 12: Malformed line — missing "me vs" ──────────────────────
    def test_12_malformed_missing_me_vs(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony Alston/Wei 21-18",
            "Tony me vs Alston/Wei 15-21",
        ])
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        # Line without "me vs" is noise — skipped silently, no warning
        out = format_description(parsed)
        game_lines = [l for l in out.splitlines() if l.startswith(("W ", "L "))]
        self.assertEqual(len(game_lines), 2)

    # ── Test 13: Unrecognized line (noise) ─────────────────────────────
    def test_13_noise_lines(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Had a great time tonight",
            "Tony me vs Alston/Wei 15-21",
        ])
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(len(parsed["warnings"]), 0)
        out = format_description(parsed)
        game_lines = [l for l in out.splitlines() if l.startswith(("W ", "L "))]
        self.assertEqual(len(game_lines), 2)

    # ── Test 14: Already formatted (idempotent) ────────────────────────
    def test_14_already_formatted(self):
        formatted = "4W-7L (36%)\n\nGames:\nW 21-18 w/ Tony vs Alston + Wei"
        result = parse_raw_description(formatted)
        self.assertIsNone(result)

    # ── Test 15: Empty input ───────────────────────────────────────────
    def test_15_empty_input(self):
        self.assertIsNone(parse_raw_description(""))
        self.assertIsNone(parse_raw_description("   \n\n  "))

    # ── Test 16: Only metadata, no games ───────────────────────────────
    def test_16_only_metadata(self):
        raw = "#notes Just warming up\n#rank 5"
        result = parse_raw_description(raw)
        self.assertIsNone(result)

    # ── Test 17: Win percentage rounding ───────────────────────────────
    def test_17_win_pct_rounding(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alston/Wei 18-21",
            "Tony me vs Alston/Wei 15-21",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        # 1/3 = 33.33... → rounds to 33
        self.assertIn("1W-2L (33%)", out)

    # ── Test 18: All wins ──────────────────────────────────────────────
    def test_18_all_wins(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alston/Wei 21-15",
            "Tony me vs Alston/Wei 21-10",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("3W-0L (100%)", out)

    # ── Test 19: All losses ────────────────────────────────────────────
    def test_19_all_losses(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 18-21",
            "Tony me vs Alston/Wei 15-21",
            "Tony me vs Alston/Wei 10-21",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("0W-3L (0%)", out)

    # ── Test 20: --- with no friendlies after ──────────────────────────
    def test_20_separator_no_friendlies(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alston/Wei 22-20",
            "Tony me vs Alex/Yin 13-21",
            "---",
        ])
        parsed = parse_raw_description(raw)
        out = format_description(parsed)
        self.assertIn("Games:", out)
        self.assertNotIn("Friendlies:", out)
        self.assertIn("2W-1L (67%)", out)


    # ── Test 21: Case-insensitive "me vs" ──────────────────────────────
    def test_21_case_insensitive(self):
        raw = "Tony ME VS Alston/Wei 21-18"
        parsed = parse_raw_description(raw)
        self.assertIsNotNone(parsed)
        out = format_description(parsed)
        self.assertIn("W 21-18 w/ Tony vs Alston + Wei", out)


class TestBuildStructuredEntry(unittest.TestCase):
    """Verify structured JSON output for badminton_match_data.json."""

    def test_structured_entry(self):
        raw = "\n".join([
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alex/Yin 13-21",
        ])
        parsed = parse_raw_description(raw)
        entry = build_structured_entry(parsed, "2026-03-27", 12345678)
        self.assertEqual(entry["date"], "2026-03-27")
        self.assertEqual(entry["activity_id"], 12345678)
        self.assertEqual(entry["source"], "manual")
        self.assertEqual(entry["wins"], 1)
        self.assertEqual(entry["losses"], 1)
        self.assertEqual(entry["total"], 2)
        self.assertEqual(entry["win_pct"], 50)
        self.assertEqual(len(entry["matches"]), 2)
        self.assertTrue(entry["matches"][0]["akash_won"])
        self.assertFalse(entry["matches"][1]["akash_won"])


class TestIsAlreadyFormatted(unittest.TestCase):
    """Verify idempotency detection helper."""

    def test_formatted_detected(self):
        self.assertTrue(is_already_formatted("3W-0L (100%)\n\nGames:\nW 21-18 w/ Tony vs A + B"))

    def test_raw_not_detected(self):
        self.assertFalse(is_already_formatted("Tony me vs Alston/Wei 21-18"))


if __name__ == "__main__":
    unittest.main()
