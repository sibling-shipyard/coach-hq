#!/usr/bin/env python3
"""Generate ui/client/src/data/quest_history.json from all season archives.

Reads training/seasons/*/challenge_v2.json (sorted by start_date) then
training/ledger/challenge_v2.json (current season). For each daily_streak quest,
reconstructs per-day status from polarity + date arrays and writes a unified
flat file the UI can read without being season-aware.

Status values: "done", "missed", "excused"
Gaps (e.g., Jun 7-17 between seasons) are omitted — no entry means no data.

Usage:
  python3 scripts/generate_quest_history.py
"""

import json
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
TRAINING_DIR = REPO_DIR / "training"
DATA_DIR = REPO_DIR / "ui" / "client" / "src" / "data"
OUTPUT_PATH = DATA_DIR / "quest_history.json"


def date_range(start: str, end: str):
    d = date.fromisoformat(start)
    e = date.fromisoformat(end)
    while d <= e:
        yield d.isoformat()
        d += timedelta(days=1)


def process_season(data: dict, is_current: bool, quests_out: dict) -> None:
    season_end = data["challenge"]["end_date"]

    for quest in data.get("quests", []):
        if quest.get("type") != "daily_streak":
            continue

        qid = quest["id"]
        qname = quest["name"]
        polarity = quest.get("polarity", "default_done")
        start = quest["start_date"]

        missed = set(quest.get("missed_dates", []))
        excused = set(quest.get("excused_dates", []))
        completed = set(quest.get("completed_dates", []))

        if is_current:
            end = date.today().isoformat()
        else:
            # Cap at the last date actually logged — no fake entries after tracking stopped
            all_logged = missed | excused | completed
            if not all_logged:
                continue
            end = max(all_logged)

        if qid not in quests_out:
            quests_out[qid] = {"name": qname, "entries": []}

        for d in date_range(start, end):
            if polarity == "default_done":
                if d in excused:
                    status = "excused"
                elif d in missed:
                    status = "missed"
                else:
                    status = "done"
            else:  # default_not_done
                if d in excused:
                    status = "excused"
                elif d in completed:
                    status = "done"
                else:
                    status = "missed"

            quests_out[qid]["entries"].append({"date": d, "status": status})


def main():
    quests_out: dict = {}

    # Archive seasons sorted by start_date
    archive_files = sorted(
        TRAINING_DIR.glob("seasons/*/challenge_v2.json"),
        key=lambda f: json.loads(f.read_text())["challenge"]["start_date"],
    )
    for path in archive_files:
        data = json.loads(path.read_text())
        process_season(data, is_current=False, quests_out=quests_out)

    # Current season
    current_path = TRAINING_DIR / "ledger" / "challenge_v2.json"
    if current_path.exists():
        data = json.loads(current_path.read_text())
        process_season(data, is_current=True, quests_out=quests_out)

    output = {
        "generated_at": date.today().isoformat(),
        "quests": quests_out,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n")
    print(f"[quest-history] wrote {OUTPUT_PATH}", file=sys.stderr)
    for qid, q in quests_out.items():
        print(f"[quest-history]   {qid}: {len(q['entries'])} entries", file=sys.stderr)


if __name__ == "__main__":
    main()
