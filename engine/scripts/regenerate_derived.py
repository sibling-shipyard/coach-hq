#!/usr/bin/env python3
"""Regenerate derived training files — no Strava, no rename logic.

Used in coach-skeleton and iOS-only user repos. Ingestion already happened
(iOS app pushed hist/).

Usage:
  python engine/scripts/regenerate_derived.py
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_BOOT = Path(__file__).resolve().parent
_LIB = _BOOT.parent / "lib"
_CORE = _BOOT.parent / "core"
sys.path.insert(0, str(_LIB))
sys.path.insert(0, str(_CORE))
from plugins import badminton_analytics_script, is_plugin_enabled  # noqa: E402
from repo_layout import gen_dir, hist_dir, p, repo_root_from_here, sync_status_path  # noqa: E402
from vs_usual import enrich_activity_files  # noqa: E402

REPO = repo_root_from_here(__file__)
SCRIPTS_DIR = p(REPO, "scripts")
SYNC_STATUS = sync_status_path(REPO)
TIMEOUT = 600


def log(msg: str) -> None:
    print(f"[regenerate] {msg}", file=sys.stderr)


def run(script: str) -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / script)],
        cwd=REPO, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{script} failed:\n{result.stderr}")
    if result.stderr:
        log(result.stderr.strip())


def maybe_run_badminton_analytics() -> None:
    if not is_plugin_enabled(REPO, "badminton"):
        log("Badminton plugin not enabled — skipping analytics snapshot")
        return
    script = badminton_analytics_script(REPO)
    if script is None:
        log("Badminton plugin code absent — skipping analytics snapshot")
        return
    log("Generating gen/badminton_analytics_snapshot.json...")
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"badminton analytics failed:\n{result.stderr}")
    if result.stderr:
        log(result.stderr.strip())


def enrich_vs_usual() -> None:
    raw_paths = os.environ.get("CHANGED_ACTIVITY_PATHS", "")
    changed_paths = [REPO / line for line in raw_paths.splitlines() if line.strip()]
    writes = enrich_activity_files(hist_dir(REPO), changed_paths)
    log(f"Added vs_usual to {writes} new activity file(s)")


def write_sync_status(error: Optional[str] = None) -> None:
    status = "error" if error else "success"
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "activities_synced": 0,
        "activities_renamed": 0,
        "descriptions_parsed": 0,
        "warnings": [],
        "commit_message": "core: regenerate derived data [skip ci]",
    }
    if error:
        payload["error"] = error
    gen_dir(REPO).mkdir(parents=True, exist_ok=True)
    SYNC_STATUS.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    try:
        enrich_vs_usual()
        log("Generating quest_history.json...")
        run("generate_quest_history.py")
        maybe_run_badminton_analytics()
        write_sync_status()
        log("Done.")
    except Exception as e:
        log(f"Error: {e}")
        write_sync_status(error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
