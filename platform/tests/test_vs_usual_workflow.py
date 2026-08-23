import os
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.scripts import regenerate_derived


REPO_ROOT = Path(__file__).resolve().parents[2]


class TestVsUsualWorkflow(unittest.TestCase):
    def test_workflow_exports_changed_activity_paths_and_stages_enrichment(self):
        workflow = (
            REPO_ROOT / "engine/.github/workflows/sync.user.yml"
        ).read_text()

        self.assertIn("CHANGED_ACTIVITY_PATHS<<EOF", workflow)
        self.assertIn("git diff --name-only --diff-filter=AM", workflow)
        self.assertIn("-- user_data/activities/hist/ || true", workflow)
        self.assertEqual(workflow.count("git add user_data/activities/hist/"), 2)

    def test_pipeline_passes_only_changed_activity_paths_to_enrichment(self):
        raw_paths = "\n".join(
            (
                "user_data/activities/hist/first.json",
                "user_data/activities/hist/second.json",
            )
        )
        with patch.dict(os.environ, {"CHANGED_ACTIVITY_PATHS": raw_paths}), patch.object(
            regenerate_derived, "enrich_activity_files", return_value=2
        ) as enrich:
            regenerate_derived.enrich_vs_usual()

        enrich.assert_called_once_with(
            regenerate_derived.hist_dir(regenerate_derived.REPO),
            [
                regenerate_derived.REPO / "user_data/activities/hist/first.json",
                regenerate_derived.REPO / "user_data/activities/hist/second.json",
            ],
        )


if __name__ == "__main__":
    unittest.main()
