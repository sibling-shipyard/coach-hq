import unittest
import json
import tempfile
from pathlib import Path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from migrate_match_history import load_json, parse_activity_description

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

if __name__ == '__main__':
    unittest.main()
