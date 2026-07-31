import json
import tempfile
import unittest
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "engine" / "lib"))
from plugins import (  # noqa: E402
    badminton_analytics_available,
    is_plugin_enabled,
    load_plugins,
    plugins_path,
)


class TestPlugins(unittest.TestCase):
    def test_missing_plugins_json_defaults_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "user_data" / "ledger").mkdir(parents=True)
            self.assertEqual(load_plugins(repo), {"enabled": []})
            self.assertFalse(is_plugin_enabled(repo, "badminton"))

    def test_enabled_plugin(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            ledger = repo / "user_data" / "ledger"
            ledger.mkdir(parents=True)
            path = plugins_path(repo)
            path.write_text(json.dumps({"enabled": ["badminton"]}))
            self.assertTrue(is_plugin_enabled(repo, "badminton"))
            self.assertTrue(badminton_analytics_available(repo))

    def test_legacy_snapshot_without_plugins_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            activities = repo / "user_data" / "activities"
            activities.mkdir(parents=True)
            (activities / "badminton_analytics_snapshot.json").write_text("{}")
            self.assertTrue(badminton_analytics_available(repo))


if __name__ == "__main__":
    unittest.main()
