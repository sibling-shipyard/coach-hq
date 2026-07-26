#!/usr/bin/env python3
"""Sync pipeline for CI — chains all steps for workflow_dispatch.

Steps (Strava path, SYNC_SOURCE=strava or unset):
  1. Sync Strava activities to training/activities/history/ via fetch_strava.py --sync
  2. Auto-rename new unrenamed activities via rename_single.py (new files only)
  3. Generate quest_log.md
  4. Generate quest_history.json (merged history across all seasons)
  5. Mirror sleep_log.json into ui/client/src/data/ when ui/ exists (HQ only)
  Write sync_status.json at the end.

Steps (iOS path, SYNC_SOURCE=ios):
  Skip Strava token write + fetch/rename; still run steps 3–4 and sync_status.
  Aggregate build is handled by sync.yml (build-aggregate.mjs or build-data.mjs).

Usage:
  python scripts/run_sync_pipeline.py
  SYNC_SOURCE=ios python scripts/run_sync_pipeline.py
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

REPO_DIR = Path(__file__).resolve().parent.parent
TRAINING_DIR = REPO_DIR / "training"
HISTORY_DIR = TRAINING_DIR / "activities" / "history"
UI_DIR = REPO_DIR / "ui"
DATA_DIR = UI_DIR / "client" / "src" / "data"
TOKENS_PATH = REPO_DIR / "strava" / "strava_tokens.json"
SYNC_STATUS_PATH = TRAINING_DIR / "sync_status.json"
TIMEOUT = 600

sys.path.insert(0, str(REPO_DIR / "strava"))


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", file=sys.stderr)


def write_tokens_from_env() -> None:
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        sys.exit("CI sync requires STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN secrets.")
    tokens = {
        "client_id": client_id,
        "client_secret": client_secret,
        "access_token": "",
        "refresh_token": refresh_token,
        "expires_at": 0,
    }
    TOKENS_PATH.parent.mkdir(parents=True, exist_ok=True)
    TOKENS_PATH.write_text(json.dumps(tokens, indent=2) + "\n")
    log("Strava tokens written from environment.")


def step_sync_strava() -> tuple[int, list[Path]]:
    """Run fetch_strava.py --sync. Detect new files by diffing directory before/after."""
    existing = set(HISTORY_DIR.glob("*.json")) if HISTORY_DIR.exists() else set()
    result = subprocess.run(
        [sys.executable, str(REPO_DIR / "strava" / "fetch_strava.py"), "--sync"],
        cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"fetch_strava.py failed:\n{result.stderr}")
    if result.stderr:
        log(result.stderr.strip())
    current = set(HISTORY_DIR.glob("*.json")) if HISTORY_DIR.exists() else set()
    new_files = sorted(current - existing)
    return len(new_files), new_files


def step_auto_rename(new_files: list[Path]) -> tuple[int, list[str]]:
    """Call rename_single.py <id> --apply for each new unrenamed activity."""
    from rename_core import is_already_renamed, SKIP_SPORTS, classify_activity

    rename_script = REPO_DIR / "strava" / "rename_single.py"
    count = 0
    warnings: list[str] = []

    for fpath in new_files:
        data = json.loads(fpath.read_text())
        sport = data.get("sport_type", data.get("type", ""))
        name = data.get("name", "")

        if sport in SKIP_SPORTS:
            continue
        if is_already_renamed(name):
            continue
        category, _, _ = classify_activity(data)
        if category == "skip":
            continue

        activity_id = data["id"]
        log(f"Renaming {activity_id} ({name})")
        result = subprocess.run(
            [sys.executable, str(rename_script), str(activity_id), "--apply"],
            cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
        )
        if result.returncode != 0:
            msg = f"Activity {activity_id}: rename failed - {result.stderr.strip()}"
            warnings.append(msg)
            log(f"  ERROR: {result.stderr.strip()}")
        else:
            count += 1
            if result.stdout:
                log(result.stdout.strip())

    return count, warnings


def step_generate_quest_log() -> None:
    result = subprocess.run(
        [sys.executable, str(REPO_DIR / "scripts" / "generate_quest_log.py")],
        cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"generate_quest_log.py failed:\n{result.stderr}")
    log("quest_log.md regenerated")


def step_generate_quest_history() -> None:
    result = subprocess.run(
        [sys.executable, str(REPO_DIR / "scripts" / "generate_quest_history.py")],
        cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"generate_quest_history.py failed:\n{result.stderr}")
    if result.stderr:
        log(result.stderr.strip())
    log("quest_history.json generated")


def write_sync_status(synced: int, renamed: int, warnings: list[str], error: Optional[str] = None) -> None:
    status = "error" if error else ("partial" if warnings else "success")
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "activities_synced": synced,
        "activities_renamed": renamed,
        "descriptions_parsed": 0,
        "warnings": warnings,
        "commit_message": (
            f"core: sync pipeline — {synced} synced, {renamed} renamed [skip ci]"
        ),
    }
    if error:
        payload["error"] = error
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    SYNC_STATUS_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    log(f"sync_status.json written: {status}")


def sync_source() -> str:
    return os.environ.get("SYNC_SOURCE", "strava").strip().lower()


def main():
    synced, renamed = 0, 0
    warnings: list[str] = []
    new_files: list[Path] = []
    source = sync_source()
    use_strava = source != "ios"

    try:
        if use_strava:
            if os.environ.get("CI"):
                write_tokens_from_env()

            log("Step 1/5: Syncing Strava activities...")
            synced, new_files = step_sync_strava()
            log(f"  {synced} new activities")

            if new_files:
                log("Step 2/5: Renaming new activities...")
                renamed, rename_warnings = step_auto_rename(new_files)
                warnings.extend(rename_warnings)
                log(f"  {renamed} renamed")
            else:
                log("Step 2/5: No new activities - skipping rename")
        else:
            log(f"SYNC_SOURCE={source} — skipping Strava token write and fetch/rename")

        log("Step 3/5: Generating quest_log.md...")
        step_generate_quest_log()

        log("Step 4/5: Generating quest_history.json...")
        step_generate_quest_history()

        if UI_DIR.exists():
            log("Step 5/5: Writing sleep_log.json to UI data bundle...")
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            sleep_src = TRAINING_DIR / "activities" / "sleep_log.json"
            (DATA_DIR / "sleep_log.json").write_text(
                sleep_src.read_text() if sleep_src.exists() else "[]"
            )
        else:
            log("Step 5/5: No ui/ directory — sleep_log stays in training/activities/")

        write_sync_status(synced, renamed, warnings)
        log("Pipeline complete.")

    except Exception as e:
        log(f"Pipeline error: {e}")
        write_sync_status(synced, renamed, warnings, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
