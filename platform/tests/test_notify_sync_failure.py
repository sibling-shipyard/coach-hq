import json
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from engine.scripts import notify_sync_failure


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (REPO_ROOT / "engine/.github/workflows/sync.user.yml").read_text()
CARVE = (REPO_ROOT / "platform/scripts/carve-skeleton.mjs").read_text()

DSN = "https://abc123@o4509.ingest.de.sentry.io/4510"
FAILED_RUN_ENV = {
    "SYNC_STEPS_JSON": json.dumps({"run_pipeline": {"outcome": "failure"}}),
    "SYNC_RUN_URL": "https://github.com/o/r/actions/runs/42",
    "SYNC_RUN_ID": "42",
    "SYNC_RUN_ATTEMPT": "1",
    "SYNC_ATHLETE_ID": "skanda-athlete",
}


def event_for(env: dict) -> dict:
    from engine.scripts.record_sync_failure import build_record

    return notify_sync_failure.build_event(build_record(env), env)


class TestEnvelopeEndpoint(unittest.TestCase):
    def test_reads_the_region_host_and_project_from_the_dsn(self):
        url, key = notify_sync_failure.envelope_endpoint(DSN)
        self.assertEqual(url, "https://o4509.ingest.de.sentry.io/api/4510/envelope/")
        self.assertEqual(key, "abc123")

    def test_rejects_a_dsn_missing_a_key_or_a_project(self):
        for bad in ("", "not a dsn", "https://o4509.ingest.de.sentry.io/4510", "https://k@host/"):
            with self.assertRaises(notify_sync_failure.DsnError):
                notify_sync_failure.envelope_endpoint(bad)


class TestBuildEvent(unittest.TestCase):
    def test_carries_the_four_fields_the_operator_needs(self):
        event = event_for(FAILED_RUN_ENV)
        self.assertEqual(event["tags"]["failed_step"], "run_pipeline")
        self.assertEqual(event["tags"]["run_id"], "42")
        self.assertEqual(event["tags"]["athlete_id"], "skanda-athlete")
        self.assertEqual(event["user"]["id"], "skanda-athlete")
        self.assertEqual(
            event["contexts"]["sync_run"]["run_url"],
            "https://github.com/o/r/actions/runs/42",
        )

    def test_arrives_as_an_error_event_grouped_by_step(self):
        # Every dashboard widget and both alert rules in sentry-runbook.md filter
        # `event.type:error`; a message event would be invisible to all of them.
        event = event_for(FAILED_RUN_ENV)
        self.assertEqual(event["exception"]["values"][0]["type"], "SyncWorkflowFailure")
        self.assertEqual(event["level"], "error")
        self.assertEqual(event["environment"], "production")
        self.assertEqual(event["fingerprint"], ["sync-workflow-failure", "run_pipeline"])

    def test_omits_the_athlete_when_the_workflow_did_not_supply_one(self):
        event = event_for({**FAILED_RUN_ENV, "SYNC_ATHLETE_ID": ""})
        self.assertNotIn("athlete_id", event["tags"])
        self.assertNotIn("user", event)

    def test_sends_no_credential_from_the_surrounding_environment(self):
        # ADR 0032's scrub rule. The event is built field by field, so a token in the job's
        # environment has no path into it - this is the guard that keeps it that way.
        secrets = {
            "GITHUB_TOKEN": "ghs_supersecret",
            "GH_TOKEN": "gho_alsosecret",
            "GEMINI_API_KEY": "AIza-secret",
        }
        body = json.dumps(event_for({**FAILED_RUN_ENV, **secrets}))
        for value in secrets.values():
            self.assertNotIn(value, body)


class TestEnvelope(unittest.TestCase):
    def test_three_lines_with_a_byte_accurate_item_length(self):
        event = event_for(FAILED_RUN_ENV)
        header, item_header, payload = notify_sync_failure.build_envelope(DSN, event).split(b"\n")[
            :3
        ]
        self.assertEqual(json.loads(header)["event_id"], event["event_id"])
        self.assertEqual(json.loads(item_header)["type"], "event")
        self.assertEqual(json.loads(item_header)["length"], len(payload))


class TestMainNeverFailsTheStep(unittest.TestCase):
    def test_no_dsn_means_no_send_and_no_error(self):
        with mock.patch.dict("os.environ", {**FAILED_RUN_ENV, "SENTRY_DSN": ""}, clear=True):
            with mock.patch.object(notify_sync_failure, "send") as send:
                self.assertEqual(notify_sync_failure.main(), 0)
        send.assert_not_called()

    def test_a_dsn_sends_exactly_one_event(self):
        with mock.patch.dict("os.environ", {**FAILED_RUN_ENV, "SENTRY_DSN": DSN}, clear=True):
            with mock.patch.object(notify_sync_failure, "send") as send:
                self.assertEqual(notify_sync_failure.main(), 0)
        send.assert_called_once()
        self.assertEqual(send.call_args[0][0], DSN)

    def test_a_dead_sentry_still_exits_zero(self):
        for boom in (urllib.error.URLError("down"), OSError("timed out"), ValueError("bad")):
            with mock.patch.dict("os.environ", {**FAILED_RUN_ENV, "SENTRY_DSN": DSN}, clear=True):
                with mock.patch.object(notify_sync_failure, "send", side_effect=boom):
                    self.assertEqual(notify_sync_failure.main(), 0)


class TestSyncWorkflow(unittest.TestCase):
    def test_the_alert_runs_on_failure_and_cannot_abort_the_step(self):
        recorder = WORKFLOW.split("- name: Record sync failure", 1)[1]
        self.assertIn("python3 engine/scripts/notify_sync_failure.py \\\n            ||", recorder)
        self.assertIn("SYNC_ATHLETE_ID: ${{ github.repository_owner }}", recorder)
        self.assertIn('SENTRY_DSN: ""', recorder)

    def test_the_alert_goes_out_before_the_record_is_pushed(self):
        recorder = WORKFLOW.split("- name: Record sync failure", 1)[1]
        self.assertLess(
            recorder.index("notify_sync_failure.py"),
            recorder.index("record_sync_failure.py"),
        )

    def test_a_green_sync_sends_nothing(self):
        success = WORKFLOW.split("- name: Record sync failure", 1)[0]
        self.assertNotIn("notify_sync_failure.py", success)
        self.assertNotIn("SENTRY_DSN", success)


class TestCarve(unittest.TestCase):
    def test_the_sender_is_carved_into_athlete_repos(self):
        self.assertIn('"scripts/notify_sync_failure.py"', CARVE)

    def test_the_carve_stamps_the_dsn_into_the_workflow(self):
        self.assertIn("SYNC_DSN_PLACEHOLDER", CARVE)
        self.assertIn("stampSyncDsn(sync)", CARVE)
        self.assertIn("const SYNC_DSN_PLACEHOLDER = '          SENTRY_DSN: \"\"';", CARVE)


if __name__ == "__main__":
    unittest.main()
