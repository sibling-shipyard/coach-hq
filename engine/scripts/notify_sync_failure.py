#!/usr/bin/env python3
"""Send one Sentry event for a Sync run that died, straight from the workflow.

The failure record (`gen/sync_failure.json`) only reaches someone who opens the repo, and a
broken Sync is exactly when nobody opens it. This tells the operator inside a minute.

Runs from the `if: failure()` branch of the Sync workflow, so the same limits as
record_sync_failure.py apply: standard library only — `pip install` may be the step that
died — and it must never fail the step. Every path here returns 0; a Sentry outage annotates
and stops, leaving the record file as the fallback.

Usage:
  python3 engine/scripts/notify_sync_failure.py

Environment:
  SENTRY_DSN        write-only ingest key, stamped into the workflow at carve time.
                    Unset or empty → no send, and that is not an error.
  SYNC_ATHLETE_ID   repo owner; the fleet's `athlete_id` tag (ui/api/_lib/sentry.ts)
  SYNC_STEPS_JSON / SYNC_RUN_URL / SYNC_RUN_ID / SYNC_RUN_ATTEMPT — as record_sync_failure.py

ADR 0032: nothing else is sent. No `GITHUB_TOKEN`, no auth header, no repo content beyond the
run's own identity — the event is built field by field here, never scraped from the environment.
"""

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

_BOOT = os.path.dirname(os.path.abspath(__file__))
if _BOOT not in sys.path:
    sys.path.insert(0, _BOOT)
from record_sync_failure import build_record  # noqa: E402

SENTRY_CLIENT = "coach-sync-workflow/1.0"
# The whole point is speed of notice, and the record push is queued behind this. Ten seconds is
# long enough for a cold TLS handshake on a runner and short enough that a dead Sentry costs
# nothing that matters.
TIMEOUT_SECONDS = 10


class DsnError(ValueError):
    """The DSN is missing a part we need to build the ingest URL."""


def envelope_endpoint(dsn: str) -> tuple[str, str]:
    """Split a DSN into (envelope URL, public key).

    A DSN looks like `https://<key>@o1.ingest.de.sentry.io/<project_id>`. The ingest host is
    region-specific (ADR 0032 puts us in Germany), so it is read from the DSN, never assumed.
    """
    parts = urlsplit(dsn.strip())
    key = parts.username or ""
    project_id = parts.path.strip("/")
    if not parts.scheme or not parts.hostname or not key or not project_id:
        raise DsnError("DSN must look like https://<key>@<host>/<project_id>")
    host = parts.hostname if parts.port is None else f"{parts.hostname}:{parts.port}"
    return f"{parts.scheme}://{host}/api/{project_id}/envelope/", key


def build_event(record: dict, env: dict) -> dict:
    """One Sentry error event describing the failed run.

    Carries an `exception` rather than a bare message so it arrives as `event.type:error`: the
    dashboard widgets and both alert rules in `sentry-runbook.md` filter on that, and a message
    event would be invisible to all of them. `fingerprint` groups every run that died at the
    same step into one issue, so a repeatedly broken pipeline is one row, not fifty.
    """
    step = record["failed_step"]
    athlete_id = env.get("SYNC_ATHLETE_ID", "").strip()
    event = {
        "event_id": uuid.uuid4().hex,
        "timestamp": record["timestamp"],
        "platform": "other",
        "level": "error",
        "logger": "sync-workflow",
        "environment": "production",
        "transaction": "sync.workflow",
        "exception": {
            "values": [
                {
                    "type": "SyncWorkflowFailure",
                    "value": f"Sync failed at step '{step}'",
                }
            ]
        },
        "fingerprint": ["sync-workflow-failure", step],
        "tags": {
            "operation": "sync",
            "failed_step": step,
            "run_id": record["run_id"],
            "run_attempt": record["run_attempt"],
        },
        "contexts": {
            "sync_run": {
                "failed_step": step,
                "run_url": record["run_url"],
                "run_id": record["run_id"],
                "run_attempt": record["run_attempt"],
                "message": record["message"],
            }
        },
    }
    if athlete_id:
        # Same handle web, API and iOS set (`setAthleteScope`), so one athlete stays one id
        # across every project. ADR 0032's deliberate exception to `sendDefaultPii: false`.
        event["tags"]["athlete_id"] = athlete_id
        event["user"] = {"id": athlete_id}
    return event


def build_envelope(dsn: str, event: dict) -> bytes:
    header = {
        "event_id": event["event_id"],
        "sent_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dsn": dsn,
    }
    payload = json.dumps(event).encode("utf-8")
    item_header = json.dumps({"type": "event", "length": len(payload)}).encode("utf-8")
    return b"\n".join([json.dumps(header).encode("utf-8"), item_header, payload]) + b"\n"


def send(dsn: str, event: dict) -> None:
    url, key = envelope_endpoint(dsn)
    request = urllib.request.Request(
        url,
        data=build_envelope(dsn, event),
        method="POST",
        headers={
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": (
                f"Sentry sentry_version=7, sentry_key={key}, sentry_client={SENTRY_CLIENT}"
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        response.read()


def main() -> int:
    env = dict(os.environ)
    dsn = env.get("SENTRY_DSN", "").strip()
    if not dsn:
        print("[notify-sync-failure] no SENTRY_DSN — skipping the alert")
        return 0
    try:
        event = build_event(build_record(env), env)
        send(dsn, event)
    except (urllib.error.URLError, DsnError, OSError, ValueError, KeyError) as error:
        # Never re-raise: the run already failed, and burying that failure under this one would
        # cost the operator the record push that runs after this script.
        print(f"::warning::Could not alert Sentry about this failed Sync: {error}")
        return 0
    print(f"[notify-sync-failure] sent event {event['event_id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
