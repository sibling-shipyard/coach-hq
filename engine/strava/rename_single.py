#!/usr/bin/env python3
"""Rename a single Strava activity using the Coach Phelps naming scheme.

SAFE: Only touches one activity. Derives the next counter by scanning
existing history files — never rebuilds or re-numbers anything.

Counter logic:
  1. Scan all history files for names matching the target category
  2. Counters reset every calendar year — each category is numbered independently
     per year, derived from the activity's start_date_local
  3. New counter = max (for that category + year) + 1

Usage:
  python rename_single.py <activity_id>                  # Dry-run (preview)
  python rename_single.py <activity_id> --apply          # Apply to Strava + local JSON
  python rename_single.py <activity_id> --name "Custom"  # Override auto-classification
  python rename_single.py --status                       # Show all current counters

Examples:
  python rename_single.py 12345678901
  python rename_single.py 12345678901 --apply
  python rename_single.py 12345678901 --name "Weight Training #4: Upper" --apply
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from rename_core import (
    COUNTER_PATTERNS,
    SKIP_SPORTS,
    classify_activity,
    generate_name,
    get_activity_year,
    is_already_renamed,
)
from strava_api import api_put, load_tokens, refresh_if_needed

REPO_DIR = Path(__file__).resolve().parent.parent
HISTORY_DIR = REPO_DIR / "training" / "activities" / "history"


def get_all_counters_by_year():
    """Scan all history files and return current max counter per (year, category)."""
    counters_by_year = {}
    for f in HISTORY_DIR.glob("20*.json"):
        data = json.loads(f.read_text())
        name = data.get("name", "")
        year = get_activity_year(data)
        counters = counters_by_year.setdefault(year, {k: 0 for k in COUNTER_PATTERNS})
        for key, pattern in COUNTER_PATTERNS.items():
            m = pattern.match(name)
            if m:
                counters[key] = max(counters[key], int(m.group(1)))
    return counters_by_year


def find_activity(activity_id):
    """Find activity JSON file by Strava ID. Returns (data, filepath) or None."""
    for f in HISTORY_DIR.glob("20*.json"):
        data = json.loads(f.read_text())
        if data.get("id") == activity_id:
            return data, f
    return None, None


def main():
    parser = argparse.ArgumentParser(
        description="Rename a single Strava activity (safe, isolated)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Counter logic:
  Scans training/activities/history/*.json for existing renamed activities.
  Counters reset every calendar year, per category, based on the
  activity's own start_date_local. New counter = max (that year) + 1.

  Example: If Foundation #17 exists in 2026, the next 2026 Foundation = #18,
  but the first 2027 Foundation starts fresh at #1.
        """,
    )
    parser.add_argument("activity_id", type=int, nargs="?", help="Strava activity ID")
    parser.add_argument("--apply", action="store_true", help="Apply rename to Strava + local JSON")
    parser.add_argument("--name", type=str, help="Override: use this exact name instead of auto-classification")
    parser.add_argument("--status", action="store_true", help="Show current counters across all categories")
    args = parser.parse_args()

    counters_by_year = get_all_counters_by_year()

    if args.status:
        print("\nCurrent counters (from training/activities/history/*.json, reset per calendar year):")
        for year in sorted(counters_by_year):
            print(f"\n  {year}:")
            for k, v in sorted(counters_by_year[year].items()):
                print(f"    {k:15s} #{v}")
        print(f"\nNext activity in each category/year will get max+1.")
        return

    if not args.activity_id:
        parser.print_help()
        return

    # Find the activity
    data, filepath = find_activity(args.activity_id)
    if data is None:
        print(f"ERROR: Activity {args.activity_id} not found in training/activities/history/", file=sys.stderr)
        print(f"  Run 'python strava/fetch_strava.py --sync --forward' first.", file=sys.stderr)
        sys.exit(1)

    old_name = data.get("name", "")
    start = data.get("start_date_local", "")
    sport = data.get("sport_type", data.get("type", ""))
    dur_min = data.get("elapsed_time", 0) / 60
    year = get_activity_year(data)
    counters = counters_by_year.setdefault(year, {k: 0 for k in COUNTER_PATTERNS})

    print(f"\nActivity: {args.activity_id}")
    print(f"  Current name: {old_name}")
    print(f"  Date:         {start}")
    print(f"  Sport:        {sport}")
    print(f"  Duration:     {dur_min:.0f} min")

    if is_already_renamed(old_name) and not args.name:
        print(f"\n  Already renamed. Use --name to override.")
        return

    # Determine new name
    if args.name:
        new_name = args.name
        print(f"\n  Manual override → {new_name}")
    else:
        category, detail, counter_key = classify_activity(data)

        if category == "skip":
            print(f"\n  Classification: skip (not a training activity)")
            print(f"  Use --name to force a custom name.")
            return

        if category == "badminton_casual":
            dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
            dow_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            new_name = f"Badminton: {dow_names[dt.weekday()]} session"
        else:
            next_counter = counters.get(counter_key, 0) + 1
            new_name = generate_name(category, detail, next_counter)

        print(f"\n  Classification: {category}")
        if counter_key:
            print(f"  Current max {counter_key}: #{counters.get(counter_key, 0)}")
            print(f"  Next counter:    #{counters.get(counter_key, 0) + 1}")
        print(f"  New name:        {new_name}")

    if not args.apply:
        print(f"\n  DRY RUN — run with --apply to push to Strava and update local JSON.")
        return

    # Apply
    tokens = refresh_if_needed(load_tokens())
    print(f"\n  Updating Strava...")
    api_put(tokens, f"/activities/{args.activity_id}", {"name": new_name})
    print(f"  ✓ Strava updated")

    print(f"  Updating local JSON...")
    data["name"] = new_name
    filepath.write_text(json.dumps(data, indent=2, default=str) + "\n")
    print(f"  ✓ {filepath.name} updated")

    print(f"\n  Done: {old_name} → {new_name}")


if __name__ == "__main__":
    main()