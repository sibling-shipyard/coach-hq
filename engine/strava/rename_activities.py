#!/usr/bin/env python3
"""Rename Strava activities with the Coach Phelps naming scheme.

INCREMENTAL: Detects already-renamed activities by name pattern, derives
counters from existing names, and only processes new/unrenamed activities.

Naming scheme (counters reset every calendar year, per category):
  - Run #K                        — All runs
  - Swim #K                       — All swims
  - Foundation #K: Core|Kickstart — Morning routine (WeightTraining, <25 min)
      Core for #1-9, Kickstart for #10+
  - Weight Training #K: [focus]   — Strength session (WeightTraining, >=25 min, focus = Upper/Lower/General)
  - Recovery #K                   — Active recovery / mobility + Yoga (Mon-Sat)
  - Realign #K                    — Corrective mobility, Sunday + Sunday Yoga
  - Badminton: Ranked #K          — Ranked games (add "ranked" to name/description)
  - Badminton: League #K          — League games (add "league" to name/description)
  - Badminton: Friendly #K        — Friendly games (add "friendly" to name/description)
  - Badminton: Casual #K          — Casual games with friends (no keyword match)
  - Rides/Walks/Hikes             — Left as-is

Usage:
  python rename_activities.py --dry-run     # Preview changes (new only)
  python rename_activities.py --apply       # Apply changes to Strava
  python rename_activities.py --apply --id 12345  # Rename single activity
  python rename_activities.py --status      # Show current counters
"""

import argparse
import json
import sys
import time
from pathlib import Path

_BOOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_BOOT.parent / "lib"))
from repo_layout import hist_dir, repo_root_from_here  # noqa: E402

from rename_core import (
    COUNTER_PATTERNS,
    SKIP_SPORTS,
    classify_activity,
    generate_name,
    get_activity_year,
    is_already_renamed,
)
from strava_api import api_put, load_tokens, refresh_if_needed

REPO_DIR = repo_root_from_here(__file__)
HISTORY_DIR = hist_dir(REPO_DIR)


def derive_counters(activities):
    """Scan all activities and derive current max counter per (year, category)."""
    counters_by_year = {}
    for data in activities:
        name = data.get("name", "")
        year = get_activity_year(data)
        counters = counters_by_year.setdefault(year, {k: 0 for k in COUNTER_PATTERNS})
        for key, pattern in COUNTER_PATTERNS.items():
            m = pattern.match(name)
            if m:
                counters[key] = max(counters[key], int(m.group(1)))
    return counters_by_year


def build_rename_plan(activities, counters_by_year, filter_id=None):
    """Build rename plan for unrenamed activities only.

    Counters reset per calendar year — each activity draws from (and increments)
    its own year's counter bucket, not a global one.

    Returns list of (activity_id, old_name, new_name, category, filename) tuples.
    Mutates counters_by_year dict with new values.
    """
    plan = []
    for data, fname in activities:
        aid = data.get("id")
        old_name = data.get("name", "")

        # Skip already-renamed
        if is_already_renamed(old_name):
            continue

        category, detail, counter_key = classify_activity(data)
        if category == "skip":
            continue

        if filter_id and aid != filter_id:
            continue

        if counter_key is None:
            continue

        year = get_activity_year(data)
        counters = counters_by_year.setdefault(year, {k: 0 for k in COUNTER_PATTERNS})
        counters[counter_key] = counters.get(counter_key, 0) + 1
        new_name = generate_name(category, detail, counters[counter_key])

        if new_name and old_name != new_name:
            plan.append((aid, old_name, new_name, category, fname))

    return plan


def load_all_activities():
    """Load all history activities sorted by date. Returns list of (data, filename)."""
    activities = []
    for f in sorted(HISTORY_DIR.glob("20*.json")):
        data = json.loads(f.read_text())
        activities.append((data, f.name))
    activities.sort(key=lambda x: x[0].get("start_date_local", ""))
    return activities


def main():
    parser = argparse.ArgumentParser(description="Rename Strava activities (incremental)")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    parser.add_argument("--apply", action="store_true", help="Apply renames to Strava + local JSON")
    parser.add_argument("--id", type=int, help="Only rename a specific activity ID")
    parser.add_argument("--status", action="store_true", help="Show current counters and stats")
    args = parser.parse_args()

    if not args.dry_run and not args.apply and not args.status:
        parser.print_help()
        return

    activities = load_all_activities()

    # Derive counters from already-renamed activities, bucketed per year
    counters_by_year = derive_counters([d for d, _ in activities])

    if args.status:
        renamed_count = sum(1 for d, _ in activities if is_already_renamed(d.get("name", "")))
        total = len(activities)
        skip_count = sum(1 for d, _ in activities
                         if d.get("sport_type", d.get("type", "")) in SKIP_SPORTS)
        unrenamed = total - renamed_count - skip_count
        print(f"\nAll Activities: {total}")
        print(f"  Renamed:   {renamed_count}")
        print(f"  Skipped:   {skip_count} (rides, runs, etc.)")
        print(f"  Unrenamed: {unrenamed}")
        print(f"\nCounters (reset per calendar year):")
        for year in sorted(counters_by_year):
            print(f"\n  {year}:")
            for k, v in sorted(counters_by_year[year].items()):
                print(f"    {k:15s} #{v}")
        return

    plan = build_rename_plan(activities, counters_by_year, filter_id=args.id)

    if not plan:
        print("\nNo activities to rename. Everything is up to date.")
        return

    if args.dry_run:
        print(f"\n{'='*80}")
        print(f"RENAME PLAN — {len(plan)} new activities to rename")
        print(f"{'='*80}\n")
        for aid, old, new, cat, fname in plan:
            print(f"  [{cat:18s}] {old:45s} → {new}")
        print(f"\nUpdated counters (per calendar year):")
        for year in sorted(counters_by_year):
            print(f"\n  {year}:")
            for k, v in sorted(counters_by_year[year].items()):
                print(f"    {k:15s} #{v}")
        print(f"\nRun with --apply to execute.\n")
        return

    if args.apply:
        tokens = refresh_if_needed(load_tokens())
        applied = 0

        for aid, old, new, cat, fname in plan:
            print(f"  Renaming {aid}: {old} → {new}")
            try:
                # Update on Strava
                api_put(tokens, f"/activities/{aid}", {"name": new})

                # Update local JSON
                fpath = HISTORY_DIR / fname
                data = json.loads(fpath.read_text())
                data["name"] = new
                fpath.write_text(json.dumps(data, indent=2, default=str) + "\n")

                applied += 1
                time.sleep(0.5)
            except Exception as e:
                print(f"  ERROR: {e}", file=sys.stderr)

        print(f"\nDone. Applied: {applied}/{len(plan)}")
        print(f"Updated counters (per calendar year):")
        for year in sorted(counters_by_year):
            print(f"\n  {year}:")
            for k, v in sorted(counters_by_year[year].items()):
                print(f"    {k:15s} #{v}")


if __name__ == "__main__":
    main()