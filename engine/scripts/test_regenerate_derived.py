"""Badminton output follows the enabled plugin and its current sessions."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_SCRIPT = Path(__file__).resolve().parent / "regenerate_derived.py"
_SPEC = importlib.util.spec_from_file_location("regenerate_derived", _SCRIPT)
assert _SPEC and _SPEC.loader
regenerate_derived = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(regenerate_derived)


class BadmintonAnalyticsOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.snapshot = self.root / "gen/badminton_analytics_snapshot.json"
        self.snapshot.parent.mkdir()
        self.plugin_config = self.root / "user_data/ledger/plugins.json"
        self.plugin_config.parent.mkdir(parents=True)
        self.repo_patch = mock.patch.object(regenerate_derived, "REPO", self.root)
        self.repo_patch.start()
        self.addCleanup(self.repo_patch.stop)

    def enable_plugin(self, enabled):
        self.plugin_config.write_text(json.dumps({"enabled": ["badminton"] if enabled else []}))

    def test_enabled_plugin_replaces_old_snapshot(self):
        self.enable_plugin(True)
        self.snapshot.write_text("old")

        def generate(*_args, **_kwargs):
            self.assertFalse(self.snapshot.exists())
            self.snapshot.write_text("new")
            return subprocess.CompletedProcess([], 0, "", "")

        with mock.patch.object(regenerate_derived, "badminton_analytics_script", return_value=Path("analytics.py")), \
             mock.patch.object(regenerate_derived.subprocess, "run", side_effect=generate) as run:
            regenerate_derived.maybe_run_badminton_analytics()

        run.assert_called_once()
        self.assertEqual(self.snapshot.read_text(), "new")

    def test_disabled_plugin_removes_old_snapshot(self):
        self.enable_plugin(False)
        self.snapshot.write_text("old")

        with mock.patch.object(regenerate_derived.subprocess, "run") as run:
            regenerate_derived.maybe_run_badminton_analytics()

        run.assert_not_called()
        self.assertFalse(self.snapshot.exists())

    def test_no_sessions_removes_old_snapshot(self):
        self.enable_plugin(True)
        self.snapshot.write_text("old")

        with mock.patch.object(regenerate_derived, "badminton_analytics_script", return_value=Path("analytics.py")), \
             mock.patch.object(regenerate_derived.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")):
            regenerate_derived.maybe_run_badminton_analytics()

        self.assertFalse(self.snapshot.exists())


if __name__ == "__main__":
    unittest.main()
