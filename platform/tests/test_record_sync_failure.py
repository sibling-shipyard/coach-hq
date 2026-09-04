import json
import unittest
from pathlib import Path

from engine.scripts import record_sync_failure


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (REPO_ROOT / "engine/.github/workflows/sync.user.yml").read_text()


class TestFailedStep(unittest.TestCase):
    def test_names_the_first_failing_step(self):
        steps = json.dumps(
            {
                "run_pipeline": {"outcome": "success", "conclusion": "success"},
                "commit_and_push": {"outcome": "failure", "conclusion": "failure"},
            }
        )
        self.assertEqual(record_sync_failure.failed_step(steps), "commit_and_push")

    def test_unknown_when_no_step_failed(self):
        steps = json.dumps({"run_pipeline": {"outcome": "success"}})
        self.assertEqual(record_sync_failure.failed_step(steps), "unknown")

    def test_unknown_for_empty_or_unparseable_input(self):
        for raw in ("", "   ", "not json", "[]"):
            self.assertEqual(record_sync_failure.failed_step(raw), "unknown")


class TestBuildRecord(unittest.TestCase):
    def test_record_carries_step_run_url_and_timestamp(self):
        record = record_sync_failure.build_record(
            {
                "SYNC_STEPS_JSON": json.dumps({"run_pipeline": {"outcome": "failure"}}),
                "SYNC_RUN_URL": "https://github.com/o/r/actions/runs/42",
                "SYNC_RUN_ID": "42",
                "SYNC_RUN_ATTEMPT": "1",
            }
        )
        self.assertEqual(record["status"], "error")
        self.assertEqual(record["failed_step"], "run_pipeline")
        self.assertEqual(record["run_url"], "https://github.com/o/r/actions/runs/42")
        self.assertEqual(record["schema_version"], record_sync_failure.SCHEMA_VERSION)
        self.assertRegex(record["timestamp"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_survives_a_missing_environment(self):
        record = record_sync_failure.build_record({})
        self.assertEqual(record["failed_step"], "unknown")
        self.assertEqual(record["run_url"], "")


class TestSyncWorkflow(unittest.TestCase):
    def test_recorder_runs_on_failure_and_is_the_last_step(self):
        self.assertIn("- name: Record sync failure\n        if: failure()", WORKFLOW)
        self.assertIn("SYNC_STEPS_JSON: ${{ toJSON(steps) }}", WORKFLOW)
        self.assertIn("python3 engine/scripts/record_sync_failure.py", WORKFLOW)

    def test_every_step_the_recorder_can_name_has_an_id(self):
        # toJSON(steps) only reports steps that carry an `id`; a nameless step would land in
        # the record as "unknown".
        self.assertEqual(WORKFLOW.count("      - name: "), WORKFLOW.count("        id: ") + 1)
        self.assertIn("id: run_pipeline", WORKFLOW)
        self.assertIn("id: commit_and_push", WORKFLOW)

    def test_recorder_does_not_reuse_the_pipeline_that_just_died(self):
        recorder = WORKFLOW.split("- name: Record sync failure", 1)[1]
        self.assertNotIn("regenerate_derived.py", recorder)
        self.assertNotIn("sync_status.json", recorder)
        self.assertIn("git reset --hard origin/main", recorder)

    def test_success_path_still_writes_only_the_files_it_always_wrote(self):
        success = WORKFLOW.split("- name: Record sync failure", 1)[0]
        self.assertEqual(success.count("git add gen/quest_history.json gen/sync_status.json"), 2)
        # The green run clears a stale marker; it never writes one.
        self.assertEqual(success.count("git rm -q --cached --ignore-unmatch gen/sync_failure.json"), 2)
        self.assertNotIn("record_sync_failure.py", success)


if __name__ == "__main__":
    unittest.main()
