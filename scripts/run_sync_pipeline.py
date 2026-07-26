#!/usr/bin/env python3
"""Sync pipeline for CI — chains all steps for workflow_dispatch.

Steps:
  1. Sync Strava activities to training/activities/history/ via fetch_strava.py --sync
  2. Detect & parse raw badminton descriptions (new activities only)
  3. Auto-rename new unrenamed activities via rename_single.py (new files only)
  4. Generate quest_log.md
  5. Generate quest_history.json (merged history across all seasons)
  6. Write sleep_log.json into the UI data bundle
  7. Generate badminton_analytics_snapshot.json
  Write sync_status.json at the end.

  activities.json, challenge_v2.json, and workouts.json are NOT written here -
  ui/scripts/build-data.mjs owns all three and regenerates them on every
  build/dev via the prebuild/predev npm hooks. training/widget_snapshots.json is populated
  by sync.yml (via npm run generate-snapshots), not this script.
  (Commit & push is handled by sync.yml, not this script)

Usage:
  python scripts/run_sync_pipeline.py
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
DATA_DIR = REPO_DIR / "ui" / "client" / "src" / "data"
TOKENS_PATH = REPO_DIR / "strava" / "strava_tokens.json"
SYNC_STATUS_PATH = TRAINING_DIR / "sync_status.json"
MATCH_DATA_PATH = REPO_DIR / "plugins" / "badminton" / "data" / "badminton_match_data.json"
SLEEP_LOG_SRC_PATH = TRAINING_DIR / "activities" / "sleep_log.json"
TIMEOUT = 600

sys.path.insert(0, str(REPO_DIR))
sys.path.insert(0, str(REPO_DIR / "strava"))
sys.path.insert(0, str(REPO_DIR / "scripts"))

from strava_api import load_tokens, refresh_if_needed, api_put
from parse_match_description import (
    parse_raw_description,
    format_description,
    build_structured_entry,
    is_already_formatted,
    is_raw_input,
)


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


def step_parse_descriptions(
    tokens: dict, new_files: list[Path],
) -> tuple[int, list[str]]:
    """Parse raw descriptions for newly synced badminton activities only.

    Write order: local JSON first (reversible), then match data (reversible),
    then Strava PUT (irreversible). Per-activity try/except so one failure
    doesn't block the rest.

    Returns (count_parsed, warnings).
    """
    count = 0
    warnings: list[str] = []

    for fpath in new_files:
        data = json.loads(fpath.read_text())
        sport = data.get("sport_type", data.get("type", ""))
        if sport != "Badminton":
            continue

        desc = data.get("description") or ""
        if not desc.strip():
            continue

        if is_already_formatted(desc):
            continue
        if not is_raw_input(desc):
            continue

        activity_id = data["id"]
        log(f"Parsing raw description for activity {activity_id}")

        parsed = parse_raw_description(desc)
        if parsed is None:
            continue

        if parsed["warnings"]:
            for w in parsed["warnings"]:
                warnings.append(f"Activity {activity_id}: {w}")

        formatted = format_description(parsed)

        try:
            # 1. Update local JSON (reversible). PRE stored locally only — not in formatted desc.
            data["description"] = formatted
            if parsed.get("pre_mental_state"):
                data["pre_mental_state"] = parsed["pre_mental_state"]
            fpath.write_text(json.dumps(data, indent=2, default=str) + "\n")

            # 2. Update badminton_match_data.json (reversible)
            start = data.get("start_date_local", "")
            date_str = start[:10] if start else ""
            entry = build_structured_entry(parsed, date_str, activity_id)
            _upsert_match_data(entry)

            # 3. Push formatted description to Strava (irreversible — last)
            api_put(tokens, f"/activities/{activity_id}", {"description": formatted})
            log("  Pushed formatted description to Strava")

            count += 1
        except Exception as e:
            warnings.append(f"Activity {activity_id}: failed to update — {e}")
            log(f"  ERROR updating activity {activity_id}: {e}")

    return count, warnings


def _upsert_match_data(entry: dict) -> None:
    """Append or overwrite entry in badminton_match_data.json (dedup by activity_id)."""
    history = []
    if MATCH_DATA_PATH.exists():
        history = json.loads(MATCH_DATA_PATH.read_text())

    history = [e for e in history if e.get("activity_id") != entry["activity_id"]]
    history.append(entry)
    history.sort(key=lambda e: e.get("date", ""), reverse=True)
    MATCH_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    MATCH_DATA_PATH.write_text(json.dumps(history, indent=2) + "\n")


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


def step_write_sleep_log() -> None:
    """Copy training/activities/sleep_log.json into the UI data bundle (empty array if absent)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    content = SLEEP_LOG_SRC_PATH.read_text() if SLEEP_LOG_SRC_PATH.exists() else "[]"
    (DATA_DIR / "sleep_log.json").write_text(content)
    log("sleep_log.json written to UI data bundle")


def step_generate_analytics_snapshot() -> bool:
    """Run generate_analytics_snapshot.py. Returns True on success."""
    result = subprocess.run(
        [sys.executable, str(REPO_DIR / "scripts" / "generate_analytics_snapshot.py")],
        cwd=REPO_DIR, capture_output=True, text=True, timeout=TIMEOUT,
    )
    if result.returncode != 0:
        log(f"generate_analytics_snapshot.py failed:\n{result.stderr}")
        return False
    if result.stderr:
        log(result.stderr.strip())
    log("badminton_analytics_snapshot.json regenerated")
    return True


def write_sync_status(
    synced: int,
    renamed: int,
    descriptions_parsed: int,
    warnings: list[str],
    error: Optional[str] = None,
) -> None:
    status = "error" if error else ("partial" if warnings else "success")
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "activities_synced": synced,
        "activities_renamed": renamed,
        "descriptions_parsed": descriptions_parsed,
        "warnings": warnings,
        "commit_message": (
            f"core: sync pipeline — {synced} synced, "
            f"{descriptions_parsed} parsed, {renamed} renamed [skip ci]"
        ),
    }
    if error:
        payload["error"] = error
    TRAINING_DIR.mkdir(parents=True, exist_ok=True)
    SYNC_STATUS_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    log(f"sync_status.json written: {status}")


def main():
    synced, renamed, descriptions_parsed = 0, 0, 0
    warnings: list[str] = []
    new_files: list[Path] = []

    try:
        if os.environ.get("CI"):
            write_tokens_from_env()

        # Step 1: Sync Strava. Not fatal — iOS/HealthKit is the primary sync source
        # for some users; downstream steps read committed history and don't need
        # a fresh Strava pull to succeed.
        log("Step 1/7: Syncing Strava activities...")
        try:
            synced, new_files = step_sync_strava()
            log(f"  {synced} new activities")
        except Exception as e:
            warnings.append(f"Strava sync failed: {e}")
            log(f"  ERROR: {e}")
            synced, new_files = 0, []

        if new_files:
            tokens = refresh_if_needed(load_tokens())

            log("Step 2/7: Parsing raw match descriptions...")
            descriptions_parsed, parse_warnings = step_parse_descriptions(tokens, new_files)
            warnings.extend(parse_warnings)
            log(f"  {descriptions_parsed} descriptions parsed")

            log("Step 3/7: Renaming new activities...")
            renamed, rename_warnings = step_auto_rename(new_files)
            warnings.extend(rename_warnings)
            log(f"  {renamed} renamed")
        else:
            log("Step 2/7: No new activities — skipping parse/rename")

        log("Step 4/7: Generating quest_log.md...")
        step_generate_quest_log()

        log("Step 5/7: Generating quest_history.json...")
        try:
            step_generate_quest_history()
        except Exception as e:
            warnings.append(f"quest_history generation failed: {e}")
            log(f"  ERROR: {e}")

        log("Step 6/7: Writing sleep_log.json to UI data bundle...")
        try:
            step_write_sleep_log()
        except Exception as e:
            warnings.append(f"sleep_log write failed: {e}")
            log(f"  ERROR: {e}")

        log("Step 7/7: Generating analytics snapshot...")
        if not step_generate_analytics_snapshot():
            warnings.append("Analytics snapshot generation failed")

        write_sync_status(synced, renamed, descriptions_parsed, warnings)
        log("Pipeline complete.")

    except Exception as e:
        log(f"Pipeline error: {e}")
        write_sync_status(synced, renamed, descriptions_parsed, warnings, error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
