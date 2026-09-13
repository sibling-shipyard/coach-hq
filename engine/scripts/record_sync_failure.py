#!/usr/bin/env python3
"""Write gen/sync_failure.json — the athlete-repo record of a Sync run that died.

Runs from the `if: failure()` branch of the Sync workflow, so it may only use the standard
library and repo_layout: anything the dead step touched (pip installs, node, generated files)
is off limits.

Usage:
  python3 engine/scripts/record_sync_failure.py

Environment:
  SYNC_STEPS_JSON   GitHub `toJSON(steps)` — used to name the step that failed
  SYNC_RUN_URL      link to the failed run
  SYNC_RUN_ID       run id
  SYNC_RUN_ATTEMPT  run attempt number
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_BOOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_BOOT.parent / "lib"))
from repo_layout import gen_dir, repo_root_from_here  # noqa: E402

SCHEMA_VERSION = 1


def failed_step(steps_json: str) -> str:
    """Name the first step GitHub marked as failed. Only steps with an `id` appear here."""
    try:
        steps = json.loads(steps_json) if steps_json.strip() else {}
    except json.JSONDecodeError:
        return "unknown"
    if not isinstance(steps, dict):
        return "unknown"
    for step_id, result in steps.items():
        if isinstance(result, dict) and result.get("outcome") == "failure":
            return step_id
    return "unknown"


def build_record(env: dict) -> dict:
    step = failed_step(env.get("SYNC_STEPS_JSON", ""))
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "error",
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "failed_step": step,
        "run_id": env.get("SYNC_RUN_ID", ""),
        "run_attempt": env.get("SYNC_RUN_ATTEMPT", ""),
        "run_url": env.get("SYNC_RUN_URL", ""),
        "message": (
            f"Sync failed at step '{step}'. Derived files were not regenerated, "
            "so anything reading them is showing the previous sync."
        ),
    }


def main() -> None:
    repo = repo_root_from_here(__file__)
    out = gen_dir(repo) / "sync_failure.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build_record(dict(os.environ)), indent=2) + "\n")
    print(f"[record-sync-failure] wrote {out}")


if __name__ == "__main__":
    main()
