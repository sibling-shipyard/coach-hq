"""The skeleton carve includes the scheduled current-week rollover workflow (#1118)."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CARVE = REPO_ROOT / "platform/scripts/carve-skeleton.mjs"


class TestCarveSkeleton(unittest.TestCase):
    def test_carves_daily_rollover_workflow_with_schedule_and_lock(self):
        env = {key: value for key, value in os.environ.items() if key != "SENTRY_DSN"}
        with tempfile.TemporaryDirectory(prefix="carve-rollover-") as out:
            result = subprocess.run(
                ["node", str(CARVE), "--dry-run", "--out-dir", out, "--no-sentry"],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

            workflow = Path(out) / ".github/workflows/rollover.yml"
            self.assertTrue(workflow.is_file())
            content = workflow.read_text(encoding="utf-8")
            self.assertIn("schedule:", content)
            self.assertIn("- cron: '17 0 * * *'", content)
            self.assertIn("concurrency:", content)
            self.assertIn("group: sync-${{ github.ref }}", content)
            self.assertIn("cancel-in-progress: false", content)


if __name__ == "__main__":
    unittest.main()
