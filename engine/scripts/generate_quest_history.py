#!/usr/bin/env python3
"""Generate quest_history.json from all season archives.

Reads seasons/*/challenge_v2.json (sorted by start_date) then
ledger/challenge_v2.json (current season). For each daily_streak quest,
reconstructs per-day status from polarity + date arrays and writes a unified
flat file the dashboard can read without being season-aware.

Output path:
  - QUEST_HISTORY_OUTPUT env var if set
  - gen/quest_history.json (new layout) or training/activities/quest_history.json (legacy)

Status values: "done", "missed", "excused"
Gaps (e.g., Jun 7-17 between seasons) are omitted — no entry means no data.

Usage:
  python3 scripts/generate_quest_history.py
"""

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
from repo_layout import ledger_dir, quest_history_path, repo_root_from_here, seasons_dir  # noqa: E402
from challenge_schema import challenge_window, season_start_date  # noqa: E402
from timezone_util import resolve_athlete_timezone, today_in_timezone  # noqa: E402

REPO_DIR = repo_root_from_here(__file__)
TODAY = today_in_timezone(resolve_athlete_timezone(REPO_DIR))


def resolve_output_path() -> Path:
    override = os.environ.get("QUEST_HISTORY_OUTPUT")
    if override:
        return Path(override)
    return quest_history_path(REPO_DIR)


def date_range(start: str, end: str):
    d = date.fromisoformat(start)
    e = date.fromisoformat(end)
    while d <= e:
        yield d.isoformat()
        d += timedelta(days=1)


def process_season(data: dict, is_current: bool, quests_out: dict) -> None:
    season_end = challenge_window(data)["end_date"]

    for quest in data.get("quests", []):
        if quest.get("type") != "daily_streak":
            continue

        qid = quest["id"]
        qname = quest["name"]
        # default_not_done is the schema-wide default (unified challenge_v2 shape) - must match
        # generate_quest_log.py's compute_daily_streak_stats and warmHomeSnapshots.ts's
        # buildQuestSnapshot, which both default an absent polarity the same way.
        polarity = quest.get("polarity", "default_not_done")
        start = quest["start_date"]

        missed = set(quest.get("missed_dates", []))
        excused = set(quest.get("excused_dates", []))
        completed = set(quest.get("completed_dates", []))

        if is_current:
            end = TODAY.isoformat()
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
    seasons = seasons_dir(REPO_DIR)
    archive_files = sorted(
        seasons.glob("*/challenge_v2.json") if seasons.exists() else [],
        key=lambda f: season_start_date(json.loads(f.read_text())),
    )
    for path in archive_files:
        data = json.loads(path.read_text())
        process_season(data, is_current=False, quests_out=quests_out)

    # Current season
    current_path = ledger_dir(REPO_DIR) / "challenge_v2.json"
    if current_path.exists():
        data = json.loads(current_path.read_text())
        process_season(data, is_current=True, quests_out=quests_out)

    output = {
        "generated_at": TODAY.isoformat(),
        "quests": quests_out,
    }

    output_path = resolve_output_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, indent=2) + "\n")
    print(f"[quest-history] wrote {output_path}", file=sys.stderr)
    for qid, q in quests_out.items():
        print(f"[quest-history]   {qid}: {len(q['entries'])} entries", file=sys.stderr)


if __name__ == "__main__":
    main()
