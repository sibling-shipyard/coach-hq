#!/usr/bin/env python3
"""Post-ingestion pipeline for GitHub Actions.

**Ingestion happens elsewhere:**
  - Strava: fetch_strava.py (when repo has STRAVA_* secrets in CI)
  - iOS: HealthKit app commits training/activities/history/hk_*.json directly

This script regenerates derived files (quest_log, quest_history, sync_status).
In CI, Strava pull + rename runs only when STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET,
and STRAVA_REFRESH_TOKEN are all set as repo secrets — no per-repo flag needed.

Usage:
  python engine/scripts/run_sync_pipeline.py
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Bootstrap repo_layout before other path constants
_BOOT = Path(__file__).resolve().parent
if (_BOOT.parent / "soul").is_dir():
    _REPO = _BOOT.parent
    _LIB = _BOOT.parent / "lib"
elif (_BOOT.parent.parent / "engine" / "soul").is_dir():
    _REPO = _BOOT.parent.parent
    _LIB = _BOOT.parent.parent / "engine" / "lib"
elif (_BOOT.parent / "SOUL.md").is_file():
    _REPO = _BOOT.parent
    _LIB = _BOOT.parent / "lib"
else:
    raise RuntimeError("Cannot resolve repo root")

sys.path.insert(0, str(_LIB))
from repo_layout import engine_root, p, repo_root_from_here  # noqa: E402

REPO_DIR = repo_root_from_here(__file__)
TRAINING_DIR = REPO_DIR / "training"
HISTORY_DIR = TRAINING_DIR / "activities" / "history"
UI_DIR = REPO_DIR / "ui"
DATA_DIR = UI_DIR / "client" / "src" / "data"
TOKENS_PATH = p(REPO_DIR, "strava", "strava_tokens.json")
SCRIPTS_DIR = p(REPO_DIR, "scripts")
SYNC_STATUS_PATH = TRAINING_DIR / "sync_status.json"
TIMEOUT = 600

sys.path.insert(0, str(p(REPO_DIR, "strava")))


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", file=sys.stderr)


def strava_secrets_configured() -> bool:
    return all(
        os.environ.get(k)
        for k in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN")
    )


def write_tokens_from_env() -> None:
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    refresh_token = os.environ.get("STRAVA_REFRESH_TOKEN")
    if not all([client_id, client_secret, refresh_token]):
        sys.exit("Strava step requires STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN secrets.")
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
        [sys.executable, str(p(REPO_DIR, "strava", "fetch_strava.py")), "--sync"],
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

    rename_script = p(REPO_DIR, "strava", "rename_single.py")
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
        [sys.executable, str(SCRIPTS_DIR / "generate_quest_log.py")],
        cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(f"generate_quest_log.py failed:\n{result.stderr}")
    log("quest_log.md regenerated")


def step_generate_quest_history() -> None:
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "generate_quest_history.py")],
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


def should_run_strava() -> bool:
    """CI: only when secrets present. Local: always attempt (tokens file or env)."""
    if os.environ.get("CI"):
        return strava_secrets_configured()
    return True


def main():
    synced, renamed = 0, 0
    warnings: list[str] = []
    new_files: list[Path] = []
    use_strava = should_run_strava()

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
            log("No STRAVA_* secrets in CI — skipping Strava pull (iOS / regenerate-only path)")

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
