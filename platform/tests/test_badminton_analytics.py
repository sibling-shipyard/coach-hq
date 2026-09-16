import json
import tempfile
import unittest
from unittest.mock import patch
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "plugins" / "badminton"))
import analytics
from analytics import build_section, build_sessions, compute_win_rate

class TestBadmintonAnalytics(unittest.TestCase):
    def test_compute_win_rate(self):
        self.assertEqual(compute_win_rate(5, 10), 50)
        self.assertEqual(compute_win_rate(0, 0), 0)
        self.assertEqual(compute_win_rate(1, 3), 33)

    def test_build_sessions_structured(self):
        match_history = {
            "2026-07-23": {
                "date": "2026-07-23",
                "games": [
                    {
                        "format": "singles",
                        "category": "ranked",
                        "partner": None,
                        "opponents": ["Alston"],
                        "scoreFor": 21,
                        "scoreAgainst": 18,
                        "result": "W"
                    },
                    {
                        "format": "doubles",
                        "category": "friendly",
                        "partner": "Tony",
                        "opponents": ["Bob", "Carl"],
                        "scoreFor": 15,
                        "scoreAgainst": 21,
                        "result": "L"
                    }
                ]
            }
        }
        sessions = build_sessions([], list(match_history.values()))
        self.assertEqual(len(sessions), 1)
        session = sessions[0]
        self.assertEqual(session["date"], "2026-07-23")
        self.assertEqual(len(session["ranked_games"]), 1)
        self.assertEqual(len(session["friendly_games"]), 1)
        self.assertTrue(session["ranked_games"][0]["won"])
        self.assertEqual(session["ranked_games"][0]["format"], "singles")

    def test_build_sessions_skips_activity_without_structured_history(self):
        activities = [
            {
                "_date": "2026-07-24",
                "_category": "Badminton",
                "name": "Badminton",
                "description": "W 21-18 vs Alston",
                "average_heartrate": 140,
            }
        ]
        sessions = build_sessions(activities, [])
        self.assertEqual(sessions, [])

    def match(self, history_file=None, won=True):
        entry = {
            "date": "2026-07-23",
            "games": [{"scoreFor": 21 if won else 15, "scoreAgainst": 18 if won else 21}],
        }
        if history_file is not None:
            entry["historyFile"] = history_file
        return entry

    def activity(self, name, hour, hr):
        return {
            "sport_type": "Badminton",
            "start_date_local": f"2026-07-23T{hour}:00:00",
            "name": name,
            "average_heartrate": hr,
        }

    def load_fixture(self, entries, activities, wrapped=False, source="canonical"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hist = root / "hist"
            hist.mkdir()
            for filename, activity in activities.items():
                (hist / filename).write_text(json.dumps(activity))
            paths = {name: root / f"{name}.json" for name in ("canonical", "root", "legacy")}
            paths[source].write_text(json.dumps({"sessions": entries} if wrapped else entries))
            with patch.multiple(
                analytics,
                HISTORY_DIR=hist,
                CANONICAL_MATCH_HISTORY_PATH=paths["canonical"],
                ROOT_MATCH_DATA_PATH=paths["root"],
                LEGACY_MATCH_DATA_PATH=paths["legacy"],
            ):
                matches = analytics.load_match_history()
                return matches, build_sessions(analytics.load_badminton_activities(), matches)

    def test_two_keyed_same_day_matches_join_exact_files_and_count_separately(self):
        # File order and match order differ from time order; HR identifies the join.
        entries = [self.match("a-evening.json", won=False), self.match("z-morning.json")]
        matches, sessions = self.load_fixture(entries, {
            "a-evening.json": self.activity("Evening", "18", 160),
            "z-morning.json": self.activity("Morning", "08", 120),
        })
        self.assertEqual(matches, entries)
        self.assertEqual([(s["name"], s["avg_hr"]) for s in sessions], [
            ("Morning", 120), ("Evening", 160),
        ])
        self.assertEqual([s["all_games"][0]["won"] for s in sessions], [True, False])
        section = build_section(sessions, "all_games")
        self.assertEqual(section["overall"]["total_sessions"], 2)
        self.assertEqual(section["overall"]["total_games"], 2)
        self.assertEqual(section["overall"]["win_rate"], 50)
        self.assertEqual(section["monthly_trend"][0]["sessions"], 2)
        self.assertEqual([s["name"] for s in section["recent_sessions"]], ["Evening", "Morning"])

    def test_mixed_keyed_and_legacy_uses_only_unclaimed_activity(self):
        entries = [self.match(), self.match("keyed.json", won=False)]
        _, sessions = self.load_fixture(entries, {
            "keyed.json": self.activity("Keyed", "08", 120),
            "unclaimed.json": self.activity("Legacy", "18", 160),
        }, wrapped=True)
        self.assertEqual([(s["name"], s["avg_hr"]) for s in sessions], [
            ("Keyed", 120), ("Legacy", 160),
        ])
        self.assertEqual([s["all_games"][0]["won"] for s in sessions], [False, True])

    def test_legacy_cannot_reuse_keyed_activity(self):
        _, sessions = self.load_fixture([self.match("keyed.json"), self.match(won=False)], {
            "keyed.json": self.activity("Keyed", "08", 120),
        })
        self.assertEqual(len(sessions), 2)
        self.assertEqual([(s["name"], s["avg_hr"]) for s in sessions], [
            ("Badminton Session", None), ("Keyed", 120),
        ])

    def test_ambiguous_legacy_keeps_games_without_guessing_activity(self):
        _, sessions = self.load_fixture([self.match()], {
            "one.json": self.activity("First", "08", 120),
            "two.json": self.activity("Second", "18", 160),
        })
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["name"], "Badminton Session")
        self.assertEqual(sessions[0]["category"], "Badminton")
        self.assertIsNone(sessions[0]["avg_hr"])
        self.assertEqual(len(sessions[0]["all_games"]), 1)

    def test_multiple_legacy_records_are_preserved_in_source_order_without_guessing(self):
        entries = [self.match(won=False), self.match()]
        matches, sessions = self.load_fixture(entries, {
            "only.json": self.activity("Only", "08", 120),
        })
        self.assertEqual(matches, entries)
        self.assertEqual(len(sessions), 2)
        self.assertTrue(all(s["avg_hr"] is None for s in sessions))
        self.assertEqual([s["all_games"][0]["won"] for s in sessions], [False, True])

    def test_key_must_be_exact_basename_and_never_falls_back_to_date(self):
        for key in ("missing.json", "present", "hist/present.json"):
            with self.subTest(key=key):
                _, sessions = self.load_fixture([self.match(key)], {
                    "present.json": self.activity("Wrong activity", "08", 120),
                })
                self.assertEqual(len(sessions), 1)
                self.assertEqual(sessions[0]["name"], "Badminton Session")
                self.assertIsNone(sessions[0]["avg_hr"])
                self.assertEqual(len(sessions[0]["all_games"]), 1)

    def test_date_only_entry_still_joins_single_activity(self):
        for wrapped in (False, True):
            with self.subTest(wrapped=wrapped):
                _, sessions = self.load_fixture([self.match()], {
                    "only.json": self.activity("Only", "08", 120),
                }, wrapped=wrapped)
                self.assertEqual(len(sessions), 1)
                self.assertEqual(sessions[0]["name"], "Only")
                self.assertEqual(sessions[0]["avg_hr"], 120)

    def test_legacy_file_locations_and_score_format_still_work(self):
        entry = {"date": "2026-07-23", "matches": [{
            "score": "21-18", "akashWon": True, "partner": ["Tony"], "vs": ["Alston"],
        }]}
        for source in ("root", "legacy"):
            with self.subTest(source=source):
                _, sessions = self.load_fixture([entry], {}, wrapped=True, source=source)
                self.assertEqual(len(sessions), 1)
                game = sessions[0]["all_games"][0]
                self.assertEqual((game["our_score"], game["their_score"]), (21, 18))
                self.assertTrue(game["won"])
                self.assertEqual(game["partner"], "Tony")


if __name__ == "__main__":
    unittest.main()
