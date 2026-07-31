import unittest
import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from migrate_match_history import (
    load_json,
    parse_activity_description,
    find_legacy_history,
    legacy_list_from_payload,
    migrate,
)


class TestMigrateMatchHistory(unittest.TestCase):
    def test_parse_activity_description(self):
        desc = "Great session!\n6W-2L (75%) | Rank: #2\n\nGames:\nW 21-18 w/ Tony vs Alston + Wei\n\nFriendlies:\nL 18-21 w/ Tony vs Bob"
        categories, rank, notes = parse_activity_description(desc)
        self.assertEqual(notes, "Great session!")
        self.assertEqual(rank, 2)
        self.assertEqual(categories, ["ranked", "friendly"])

    def test_load_json(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump([{"test": 1}], f)
            f_path = Path(f.name)

        data = load_json(f_path)
        self.assertEqual(data, [{"test": 1}])
        f_path.unlink()

    def test_legacy_list_from_payload_list_and_sessions(self):
        self.assertEqual(legacy_list_from_payload([{"date": "2026-01-01"}]), [{"date": "2026-01-01"}])
        self.assertEqual(
            legacy_list_from_payload({"sessions": [{"date": "2026-01-01"}]}),
            [{"date": "2026-01-01"}],
        )
        self.assertIsNone(legacy_list_from_payload([]))
        self.assertIsNone(legacy_list_from_payload({}))

    def test_find_legacy_and_migrate_uses_repo_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            activities = root / "user_data" / "activities"
            activities.mkdir(parents=True)
            legacy = [
                {
                    "date": "2026-07-23",
                    "wins": 1,
                    "losses": 0,
                    "winPct": 100,
                    "matches": [
                        {
                            "partner": "Solo",
                            "vs": ["Alston"],
                            "score": "21-18",
                            "akashWon": True,
                        }
                    ],
                }
            ]
            (activities / "badminton_match_data.json").write_text(json.dumps(legacy))

            found, path = find_legacy_history(root)
            self.assertEqual(len(found), 1)
            self.assertTrue(str(path).endswith("badminton_match_data.json"))

            rc = migrate(root, dry_run=False)
            self.assertEqual(rc, 0)
            out = json.loads((activities / "match_history.json").read_text())
            self.assertEqual(out["version"], 1)
            self.assertEqual(len(out["sessions"]), 1)
            game = out["sessions"][0]["games"][0]
            self.assertEqual(game["scoreFor"], 21)
            self.assertEqual(game["scoreAgainst"], 18)
            self.assertEqual(game["result"], "W")
            self.assertIsNone(game["partner"])
            self.assertEqual(game["format"], "singles")


if __name__ == '__main__':
    unittest.main()
