import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "plugins" / "badminton"))
from analytics import build_sessions, compute_win_rate

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
        sessions = build_sessions([], match_history)
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
        sessions = build_sessions(activities, {})
        self.assertEqual(sessions, [])

if __name__ == "__main__":
    unittest.main()
