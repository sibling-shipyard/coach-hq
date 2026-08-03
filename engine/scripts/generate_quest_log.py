#!/usr/bin/env python3
"""
generate_quest_log.py — Reads challenge_v2.json + history/*.json and produces
a human-readable quest_log.md that the coach reads at boot (read-only).

Usage:
  python scripts/generate_quest_log.py                    # generate quest_log.md
  python scripts/generate_quest_log.py --date 2026-03-26  # override date
  python scripts/generate_quest_log.py --dry-run           # print to stdout only
  python scripts/generate_quest_log.py --validate          # validate schema only
"""

import argparse
import json
import glob
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here.parent / "lib"))
from repo_layout import hist_dir, ledger_dir, quest_log_path, repo_root_from_here  # noqa: E402
from challenge_schema import challenge_window  # noqa: E402
from timezone_util import resolve_athlete_timezone, today_in_timezone  # noqa: E402

ROOT = repo_root_from_here(__file__)
CHALLENGE_FILE = ledger_dir(ROOT) / "challenge_v2.json"
HISTORY_DIR = hist_dir(ROOT)
OUTPUT_FILE = quest_log_path(ROOT)

VALID_QUEST_TYPES = {"daily_streak", "progress", "count_target", "weekly_frequency", "milestone"}
VALID_POLARITIES = {"default_done", "default_not_done"}
VALID_STATUSES = {"active", "completed", "retired"}

REQUIRED_CHALLENGE_FIELDS = {"version", "main_quest", "quests"}
REQUIRED_QUEST_FIELDS = {"id", "name", "type", "category", "start_date", "status"}
REQUIRED_DAILY_STREAK_FIELDS = {"polarity", "tracking"}
REQUIRED_PROGRESS_FIELDS = {"current", "target"}


# ── Helpers ──────────────────────────────────────────────────────────────────

def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def iso_week_start(d: date) -> date:
    """Return Monday of the ISO week containing d."""
    return d - timedelta(days=d.weekday())


# ── Schema Validation ────────────────────────────────────────────────────────

def validate_schema(data: dict) -> list[str]:
    """Validate challenge_v2.json schema. Returns list of error strings."""
    errors = []

    # Top-level fields
    missing_top = REQUIRED_CHALLENGE_FIELDS - set(data.keys())
    if missing_top:
        errors.append(f"Missing top-level fields: {missing_top}")

    has_challenge = "challenge" in data
    has_season = "season" in data
    if not has_challenge and not has_season:
        errors.append("Missing challenge or season block")
        return errors

    # Challenge / season window
    win = data["challenge"] if has_challenge else data["season"]
    block = "season" if has_season else "challenge"
    for f in ("name", "start_date", "end_date"):
        if f not in win:
            errors.append(f"{block} missing field: {f}")

    # Validate dates parse correctly
    for field_path, obj, key in [
        (f"{block}.start_date", win, "start_date"),
        (f"{block}.end_date", win, "end_date"),
    ]:
        if key in obj:
            try:
                parse_date(obj[key])
            except (ValueError, TypeError):
                errors.append(f"{field_path} is not a valid YYYY-MM-DD date: {obj.get(key)}")

    if has_challenge:
        ch = data["challenge"]
        if "duration_days" not in ch:
            try:
                start = parse_date(ch["start_date"])
                end = parse_date(ch["end_date"])
                if end < start:
                    errors.append("challenge.end_date is before start_date")
            except (ValueError, TypeError):
                pass

    # Main quest
    mq = data["main_quest"]
    mq_type = mq.get("type", "count_target")
    if mq_type == "weekly_sessions":
        for f in ("id", "name", "type", "weekly_floor"):
            if f not in mq:
                errors.append(f"main_quest missing field: {f}")
    else:
        for f in ("id", "name", "type", "target"):
            if f not in mq:
                errors.append(f"main_quest missing field: {f}")

    # Quests array
    if not isinstance(data["quests"], list):
        errors.append("quests must be an array")
        return errors

    seen_ids = set()
    for i, q in enumerate(data["quests"]):
        prefix = f"quests[{i}] ({q.get('id', '?')})"

        # Required fields
        missing_q = REQUIRED_QUEST_FIELDS - set(q.keys())
        if missing_q:
            errors.append(f"{prefix} missing fields: {missing_q}")
            continue

        # Duplicate ID check
        if q["id"] in seen_ids:
            errors.append(f"{prefix} duplicate quest id: {q['id']}")
        seen_ids.add(q["id"])

        # Type check
        if q["type"] not in VALID_QUEST_TYPES:
            errors.append(f"{prefix} unknown type: {q['type']}")

        # Status check
        if q["status"] not in VALID_STATUSES:
            errors.append(f"{prefix} unknown status: {q['status']}")

        # Type-specific validation
        if q["type"] == "daily_streak":
            missing_ds = REQUIRED_DAILY_STREAK_FIELDS - set(q.keys())
            if missing_ds:
                errors.append(f"{prefix} daily_streak missing fields: {missing_ds}")
            if q.get("polarity") and q["polarity"] not in VALID_POLARITIES:
                errors.append(f"{prefix} unknown polarity: {q['polarity']}")

            # Validate date arrays
            for arr_name in ("missed_dates", "excused_dates", "completed_dates"):
                arr = q.get(arr_name, [])
                if not isinstance(arr, list):
                    errors.append(f"{prefix} {arr_name} must be an array")
                else:
                    for d_str in arr:
                        try:
                            parse_date(d_str)
                        except (ValueError, TypeError):
                            errors.append(f"{prefix} invalid date in {arr_name}: {d_str}")

        elif q["type"] == "progress":
            missing_p = REQUIRED_PROGRESS_FIELDS - set(q.keys())
            if missing_p:
                errors.append(f"{prefix} progress missing fields: {missing_p}")

        # Validate start_date
        try:
            parse_date(q["start_date"])
        except (ValueError, TypeError):
            errors.append(f"{prefix} invalid start_date: {q['start_date']}")

        # Validate end_date if present
        if q.get("end_date"):
            try:
                q_end = parse_date(q["end_date"])
                q_start = parse_date(q["start_date"])
                if q_end < q_start:
                    errors.append(f"{prefix} end_date ({q['end_date']}) is before start_date ({q['start_date']})")
            except (ValueError, TypeError):
                errors.append(f"{prefix} invalid end_date: {q['end_date']}")

    return errors


# ── Loaders ──────────────────────────────────────────────────────────────────

def load_challenge() -> dict:
    """Load and validate challenge_v2.json."""
    if not CHALLENGE_FILE.exists():
        print(f"ERROR: {CHALLENGE_FILE} not found", file=sys.stderr)
        sys.exit(1)
    try:
        with open(CHALLENGE_FILE) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: {CHALLENGE_FILE} has invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)
    return data


def load_activities(earliest_date: Optional[date] = None) -> list[dict]:
    """Load history JSON files, optionally filtering by earliest date.

    Skips files whose date (from filename or content) is before earliest_date.
    Malformed files are skipped with a warning instead of crashing.
    """
    activities = []
    for fp in sorted(glob.glob(str(HISTORY_DIR / "*.json"))):
        # Quick filter: try to extract date from filename (e.g., 2026-03-17_12345.json)
        fname = Path(fp).stem
        if earliest_date:
            date_match = re.match(r"(\d{4}-\d{2}-\d{2})", fname)
            if date_match:
                try:
                    file_date = parse_date(date_match.group(1))
                    # Allow a week before earliest for weekly target calculations
                    if file_date < earliest_date - timedelta(days=7):
                        continue
                except ValueError:
                    pass  # Can't parse filename date, load anyway

        try:
            with open(fp) as f:
                activity = json.load(f)
            activities.append(activity)
        except json.JSONDecodeError as e:
            print(f"WARNING: Skipping malformed file {fp}: {e}", file=sys.stderr)
        except Exception as e:
            print(f"WARNING: Error reading {fp}: {e}", file=sys.stderr)

    activities.sort(key=lambda a: a.get("start_date_local", ""))
    return activities


# ── Main Quest (count_target from Strava) ────────────────────────────────────

def count_main_quest(main_quest: dict, activities: list[dict], challenge_start: date) -> int:
    """Count activities matching the main quest rule."""
    count = 0
    pattern = main_quest.get("count_pattern", "")
    for a in activities:
        name = a.get("name", "")
        act_date_str = a.get("start_date_local", "")[:10]
        if not act_date_str:
            continue
        try:
            act_date = parse_date(act_date_str)
        except ValueError:
            continue
        if act_date >= challenge_start and pattern and re.match(pattern, name):
            count += 1
    return count


def main_quest_stats(mq: dict, activities: list[dict], ch_start: date, ch_end: date, today: date) -> dict:
    """Render stats for main quest — count_target (v2) or weekly_sessions (v3)."""
    mq_type = mq.get("type", "count_target")
    if mq_type == "weekly_sessions":
        sessions = mq.get("sessions", [])
        weekly_floor = float(mq.get("weekly_floor", 0))
        week_start = iso_week_start(today)
        week_weight = 0.0
        for s in sessions:
            try:
                s_date = parse_date(s["date"])
            except (ValueError, KeyError, TypeError):
                continue
            if week_start <= s_date <= today:
                week_weight += float(s.get("weight", 1.0))
        if week_weight >= weekly_floor:
            status = "ON TRACK"
        elif week_weight >= weekly_floor * 0.6:
            status = "SLIGHTLY BEHIND"
        else:
            status = "BEHIND PACE"
        return {
            "progress_line": (
                f"This week: {week_weight:.1f}/{weekly_floor} weighted sessions | "
                f"{len(sessions)} logged in season"
            ),
            "pace_line": f"Floor: {weekly_floor}/week (loaded + skill sessions)",
            "status": status,
        }

    mq_count = count_main_quest(mq, activities, ch_start)
    weeks_elapsed = max((today - ch_start).days / 7, 0.01)
    weeks_remaining = max((ch_end - today).days / 7, 0.01)
    pace = round(mq_count / weeks_elapsed, 1)
    needed = round((mq["target"] - mq_count) / weeks_remaining, 1)
    if mq_count >= mq["target"]:
        status = "COMPLETED"
    elif pace >= needed * 0.85:
        status = "ON TRACK"
    elif pace >= needed * 0.6:
        status = "SLIGHTLY BEHIND"
    else:
        status = "BEHIND PACE"
    return {
        "progress_line": f"Progress: {mq_count}/{mq['target']}",
        "pace_line": f"Pace: {pace}/week | Need: {needed}/week to finish on time",
        "status": status,
    }


# ── Daily Streak Logic ───────────────────────────────────────────────────────

def compute_daily_streak_stats(quest: dict, today: date) -> dict:
    """Compute completed, eligible, streak, rate for a daily_streak quest.

    Polarity semantics:
      - default_done: every day counts unless in missed_dates (unexcused) or excused_dates.
        excused_dates don't break streak, missed_dates (not excused) do.
      - default_not_done: only days in completed_dates count.
        excused_dates are treated as missed but don't break streak.
        Coach writes to EITHER missed_dates OR excused_dates, never both for same date.
    """
    start = parse_date(quest["start_date"])
    end_str = quest.get("end_date")
    end = parse_date(end_str) if end_str else today
    effective_end = min(end, today)

    if effective_end < start:
        return {"completed": 0, "eligible": 0, "streak": 0, "rate": 0.0}

    eligible = (effective_end - start).days + 1

    polarity = quest.get("polarity", "default_done")
    missed = set(quest.get("missed_dates", []))
    excused = set(quest.get("excused_dates", []))
    completed_dates = set(quest.get("completed_dates", []))

    # excused_dates are automatically treated as missed (coach only writes one array)
    all_missed = missed | excused

    if polarity == "default_done":
        # Completed = eligible days minus all missed days (excused or not)
        completed = eligible - len([m for m in all_missed if start <= parse_date(m) <= effective_end])
        # Streak: count backward from today, consecutive days without an unexcused miss
        streak = 0
        d = today
        while d >= start:
            ds = d.strftime("%Y-%m-%d")
            if ds in missed and ds not in excused:
                break  # unexcused miss breaks streak
            if ds in excused:
                # excused day — neutral: don't break, don't increment
                d -= timedelta(days=1)
                continue
            streak += 1
            d -= timedelta(days=1)
    else:  # default_not_done
        completed = len([c for c in completed_dates if start <= parse_date(c) <= effective_end])
        # Streak: walk backward from today, count consecutive completed days.
        # Skip today if not yet logged (don't break streak for "not yet updated today").
        # Excused days don't break streak either.
        streak = 0
        d = today
        while d >= start:
            ds = d.strftime("%Y-%m-%d")
            if ds in completed_dates:
                streak += 1
            elif ds in excused:
                # Excused day — doesn't break streak, doesn't add to it
                d -= timedelta(days=1)
                continue
            elif d == today:
                # Today not logged yet — don't break, just skip
                d -= timedelta(days=1)
                continue
            else:
                break  # gap found, streak ends
            d -= timedelta(days=1)

    rate = (completed / eligible * 100) if eligible > 0 else 0.0

    return {
        "completed": completed,
        "eligible": eligible,
        "streak": streak,
        "rate": rate,
    }


# ── Weekly Targets ───────────────────────────────────────────────────────────

def compute_weekly_counts(activities: list[dict], data: dict, today: date) -> dict:
    """Count activities by category for the current ISO week.

    Driven entirely by the weekly_targets config in challenge_v2.json:
      - source "quest": derives count from a daily_streak quest's missed/excused dates
      - source "strava_pattern": matches Strava activity name against a regex pattern
      - source "strava_sport": matches Strava sport_type field (optionally also name pattern)
    """
    week_start = iso_week_start(today)
    week_end = week_start + timedelta(days=6)
    weekly_targets = data.get("weekly_targets", {})
    quests = data.get("quests", [])
    counts = {label: 0 for label in weekly_targets}

    for label, cfg in weekly_targets.items():
        if not isinstance(cfg, dict):
            continue  # plain integer targets have no source config — counted manually via UI
        source = cfg.get("source", "")
        if source == "quest":
            quest_id = cfg.get("quest_id")
            q = next((q for q in quests if q.get("id") == quest_id), None)
            if q and q.get("type") == "daily_streak":
                q_start = parse_date(q["start_date"])
                eff_start = max(q_start, week_start)
                eff_end = min(today, week_end)
                if eff_start <= eff_end:
                    missed = set(q.get("missed_dates", []))
                    excused = set(q.get("excused_dates", []))
                    all_missed = missed | excused
                    eligible = (eff_end - eff_start).days + 1
                    missed_wk = len([m for m in all_missed
                                     if eff_start <= parse_date(m) <= eff_end])
                    counts[label] = eligible - missed_wk

    for a in activities:
        act_date_str = a.get("start_date_local", "")[:10]
        if not act_date_str:
            continue
        try:
            act_date = parse_date(act_date_str)
        except ValueError:
            continue
        if not (week_start <= act_date <= week_end):
            continue
        name = a.get("name", "")
        sport = a.get("sport_type", "")
        for label, cfg in weekly_targets.items():
            if not isinstance(cfg, dict):
                continue
            source = cfg.get("source", "")
            if source == "strava_pattern":
                pattern = cfg.get("pattern", "")
                if pattern and re.match(pattern, name):
                    counts[label] += 1
            elif source == "strava_sport":
                sport_match = cfg.get("sport_type") and sport == cfg["sport_type"]
                pattern = cfg.get("pattern", "")
                name_match = pattern and re.match(pattern, name)
                if sport_match or name_match:
                    counts[label] += 1

    return counts


def progress_bar(done: int, target: int) -> str:
    """Render a text progress bar."""
    filled = min(done, target)
    empty = max(target - filled, 0)
    bar = "\u2593" * filled + "\u2591" * empty
    if done >= target:
        return f"{bar} DONE"
    return bar


# ── Render ───────────────────────────────────────────────────────────────────

def render_quest_log(data: dict, activities: list[dict], today: date) -> str:
    win = challenge_window(data)
    ch_start = parse_date(win["start_date"])
    ch_day = (today - ch_start).days + 1
    ch_pct = round(ch_day / win["duration_days"] * 100, 1)

    mq = data["main_quest"]
    ch_end = parse_date(win["end_date"])
    mq_stats = main_quest_stats(mq, activities, ch_start, ch_end, today)

    lines = []
    lines.append("# Quest Log")
    lines.append(f"> Auto-generated from challenge_v2.json + history data. **DO NOT EDIT.**")
    lines.append(f"> Last updated: {today.strftime('%Y-%m-%d')}")
    lines.append("")
    lines.append(f"## {win['label']}: {win['name']}")
    lines.append(f"Day {min(ch_day, win['duration_days'])} of {win['duration_days']} | "
                 f"{min(ch_pct, 100)}% complete | Ends {win['end_date']}")
    lines.append("")
    lines.append(f"## Main Quest: {mq['name']}")
    lines.append(mq_stats["progress_line"])
    lines.append(mq_stats["pace_line"])
    lines.append(f"Status: **{mq_stats['status']}**")
    lines.append("")

    # Side quests table
    lines.append("## Side Quests")
    lines.append("")
    lines.append("| Quest | Type | Progress | Streak | Rate | Status |")
    lines.append("|-------|------|----------|--------|------|--------|")

    for q in data["quests"]:
        qtype = q["type"]
        status = q["status"]

        if qtype == "daily_streak":
            stats = compute_daily_streak_stats(q, today)
            progress = f"{stats['completed']}/{stats['eligible']} days"
            streak = f"{stats['streak']}d"
            rate = f"{stats['rate']:.0f}%"
        elif qtype == "progress":
            current = q.get("current", 0)
            target = q.get("target", 0)
            unit = q.get("unit", "")
            progress = f"{current}/{target} {unit}"
            streak = "—"
            rate = f"{round(current / target * 100) if target else 0}%"
        elif qtype == "count_target":
            progress = "—"
            streak = "—"
            rate = "—"
        elif qtype == "weekly_frequency":
            target_pw = q.get("target_per_week", 0)
            this_week = len([c for c in q.get("completed_dates", [])
                           if iso_week_start(parse_date(c)) == iso_week_start(today)])
            progress = f"{this_week}/{target_pw} this week"
            streak = "—"
            rate = "—"
        else:
            progress = "—"
            streak = "—"
            rate = "—"

        lines.append(f"| {q['name']} | {qtype.replace('_', ' ')} | "
                     f"{progress} | {streak} | {rate} | {status} |")

    lines.append("")

    # Weekly targets
    weekly_targets = data.get("weekly_targets", {})
    if weekly_targets:
        weekly_counts = compute_weekly_counts(activities, data, today)
        week_start = iso_week_start(today)
        lines.append(f"## Weekly Targets (Week of {week_start.strftime('%b %d')})")
        lines.append("")
        lines.append("| Category | Done | Target | Status |")
        lines.append("|----------|------|--------|--------|")
        for cat, cfg in weekly_targets.items():
            target = cfg["target"] if isinstance(cfg, dict) else cfg
            done = weekly_counts.get(cat, 0)
            bar = progress_bar(done, target)
            lines.append(f"| {cat.title()} | {done} | {target} | {bar} |")
        lines.append("")

    return "\n".join(lines) + "\n"


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate quest_log.md")
    parser.add_argument("--date", help="Override today's date (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print output to stdout instead of writing file")
    parser.add_argument("--validate", action="store_true",
                        help="Validate challenge_v2.json schema and exit")
    args = parser.parse_args()

    today = parse_date(args.date) if args.date else today_in_timezone(resolve_athlete_timezone(ROOT))

    # Load and validate challenge data
    data = load_challenge()
    errors = validate_schema(data)

    if args.validate:
        if errors:
            print(f"VALIDATION FAILED — {len(errors)} error(s):", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)
        else:
            print("VALIDATION PASSED — challenge_v2.json schema is valid")
            sys.exit(0)

    if errors:
        print(f"WARNING: {len(errors)} schema issue(s) found:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print("Continuing with generation (output may be incomplete)...", file=sys.stderr)

    # Load activities filtered by challenge/season start date
    ch_start = parse_date(challenge_window(data)["start_date"])
    activities = load_activities(earliest_date=ch_start)

    output = render_quest_log(data, activities, today)

    if args.dry_run:
        print(output)
    else:
        OUTPUT_FILE.write_text(output)
        print(f"Generated {OUTPUT_FILE} for {today}")


if __name__ == "__main__":
    main()
