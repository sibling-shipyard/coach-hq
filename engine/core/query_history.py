#!/usr/bin/env python3
"""Search and filter training history stored in training/activities/history/.

Usage:
    python query_history.py                              # all activities (table)
    python query_history.py --sport Badminton             # filter by sport type
    python query_history.py --from 2026-03-01 --to 2026-03-15  # date range
    python query_history.py --last 7d                     # last 7 days (supports Nd or Nw)
    python query_history.py --sport Badminton --summary   # aggregate stats
    python query_history.py --peak-hr-above 170           # high intensity sessions
    python query_history.py --avg-hr-above 140            # sustained effort sessions
    python query_history.py --has-photos                  # only sessions with photos
    python query_history.py --has-description              # only sessions with descriptions
    python query_history.py --search "friendlies"         # text search in title + description
    python query_history.py --sport Badminton --detail    # full detail per activity
    python query_history.py --id 12345678901              # single activity by ID
    python query_history.py --list-sports                 # list all sport types with counts
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BOOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_BOOT.parent / "lib"))
from repo_layout import hist_dir, repo_root_from_here  # noqa: E402

REPO_DIR = repo_root_from_here(__file__)
HISTORY_DIR = hist_dir(REPO_DIR)

# ── CUSTOMIZE: HR zone boundaries ──────────────────────────────────────────
# Update these to match your personal HR zones.
# Simple estimate: Zone 2 upper = 70% of max HR (220 - age).
# Or use a lab test / Garmin/Polar zone calculator for accuracy.
HR_ZONES = [
    ("Zone 1", None, 131),   # Recovery
    ("Zone 2", 132, 145),    # Aerobic base
    ("Zone 3", 146, 158),    # Aerobic
    ("Zone 4", 159, 172),    # Threshold
    ("Zone 5", 173, None),   # Max effort
]
# ──────────────────────────────────────────────────────────────────────────


def load_all_activities():
    """Load all activity JSON files, sorted by date descending (newest first)."""
    activities = []
    if not HISTORY_DIR.exists():
        return activities
    for f in sorted(HISTORY_DIR.glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text())
            data["_file"] = str(f)
            data["_filename"] = f.name
            activities.append(data)
        except (json.JSONDecodeError, Exception):
            continue
    return activities


def parse_start(activity):
    """Parse start_date_local into a datetime."""
    raw = activity.get("start_date_local", "")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        return None


def format_duration(seconds):
    if not seconds:
        return "—"
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


def format_zone_time(seconds):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}m {s}s"
    if m > 0:
        return f"{m}m {s}s"
    return f"{s}s"


def format_zone_label(name, low, high):
    if low is None:
        return f"{name} (<{high + 1} BPM)"
    if high is None:
        return f"{name} ({low}+ BPM)"
    return f"{name} ({low}-{high} BPM)"


def parse_relative_time(value):
    """Parse '7d' or '2w' into a timedelta."""
    m = re.match(r"^(\d+)([dw])$", value)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    if unit == "d":
        return timedelta(days=n)
    elif unit == "w":
        return timedelta(weeks=n)
    return None


def filter_activities(activities, args):
    """Apply all filters and return matching activities."""
    result = []

    # Date filters
    date_from = None
    date_to = None

    if getattr(args, "from_date", None):
        date_from = datetime.strptime(args.from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if args.to:
        date_to = datetime.strptime(args.to, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
    if args.last:
        delta = parse_relative_time(args.last)
        if delta:
            date_from = datetime.now(timezone.utc) - delta

    for a in activities:
        dt = parse_start(a)

        # Date range
        if date_from and dt and dt < date_from:
            continue
        if date_to and dt and dt >= date_to:
            continue

        # Sport type
        if args.sport:
            sport = a.get("sport_type", a.get("type", "")).lower()
            if args.sport.lower() not in sport:
                continue

        # HR filters
        if args.peak_hr_above:
            max_hr = a.get("max_heartrate", 0)
            if not max_hr or max_hr < args.peak_hr_above:
                continue

        if args.avg_hr_above:
            avg_hr = a.get("average_heartrate", 0)
            if not avg_hr or avg_hr < args.avg_hr_above:
                continue

        # Photos
        if args.has_photos:
            photos = a.get("local_photos", [])
            photo_count = a.get("total_photo_count", 0)
            if not photos and not photo_count:
                continue

        # Description
        if args.has_description:
            desc = a.get("description", "")
            if not desc or not desc.strip():
                continue

        # Text search
        if args.search:
            needle = args.search.lower()
            title = (a.get("name", "") or "").lower()
            desc = (a.get("description", "") or "").lower()
            if needle not in title and needle not in desc:
                continue

        # ID filter
        if args.id:
            if a.get("id") != args.id:
                continue

        result.append(a)

    return result


def print_table(activities):
    """Print activities as a compact markdown table."""
    if not activities:
        print("No activities found.")
        return

    print(f"| Date | Sport | Title | Duration | Cal | Avg HR | Peak HR | Photos |")
    print(f"|------|-------|-------|----------|-----|--------|---------|--------|")

    for a in activities:
        dt = parse_start(a)
        date_str = dt.strftime("%Y-%m-%d") if dt else "?"
        sport = a.get("sport_type", a.get("type", "?"))
        title = (a.get("name", "") or "Untitled")[:30]
        dur = format_duration(a.get("elapsed_time", a.get("moving_time", 0)))
        cals = int(a.get("calories", 0)) or "—"
        avg_hr = int(a.get("average_heartrate", 0)) or "—"
        max_hr = int(a.get("max_heartrate", 0)) or "—"
        photos = len(a.get("local_photos", []))
        photo_str = str(photos) if photos else "—"
        print(f"| {date_str} | {sport} | {title} | {dur} | {cals} | {avg_hr} | {max_hr} | {photo_str} |")

    print(f"\n**{len(activities)} activities**")


def print_summary(activities):
    """Print aggregate stats for filtered activities."""
    if not activities:
        print("No activities found.")
        return

    total_time = sum(a.get("elapsed_time", 0) for a in activities)
    total_cals = sum(a.get("calories", 0) for a in activities)
    hr_values = [a.get("average_heartrate", 0) for a in activities if a.get("average_heartrate")]
    peak_values = [a.get("max_heartrate", 0) for a in activities if a.get("max_heartrate")]

    # Aggregate HR zones
    total_zone_secs = [0.0] * len(HR_ZONES)
    zone_count = 0
    for a in activities:
        zones = a.get("hr_zones")
        if zones:
            zone_count += 1
            for i, (name, _, _) in enumerate(HR_ZONES):
                total_zone_secs[i] += zones.get(name, {}).get("seconds", 0)

    # Sport breakdown
    sports = {}
    for a in activities:
        s = a.get("sport_type", a.get("type", "Unknown"))
        sports[s] = sports.get(s, 0) + 1

    dt_first = parse_start(activities[-1])
    dt_last = parse_start(activities[0])
    date_range = f"{dt_first.strftime('%Y-%m-%d')} to {dt_last.strftime('%Y-%m-%d')}" if dt_first and dt_last else "?"

    print(f"## Training Summary")
    print(f"- **Period:** {date_range}")
    print(f"- **Sessions:** {len(activities)}")
    print(f"- **Total Time:** {format_duration(total_time)}")
    print(f"- **Total Calories:** {int(total_cals)} kcal")

    if hr_values:
        print(f"- **Avg Heart Rate:** {int(sum(hr_values) / len(hr_values))} BPM (across {len(hr_values)} sessions)")
    if peak_values:
        print(f"- **Highest Peak HR:** {int(max(peak_values))} BPM")

    print(f"\n### By Sport")
    print(f"| Sport | Sessions |")
    print(f"|-------|----------|")
    for s, c in sorted(sports.items(), key=lambda x: -x[1]):
        print(f"| {s} | {c} |")

    if zone_count > 0:
        print(f"\n### Aggregate HR Zones ({zone_count} sessions with HR data)")
        for i, (name, low, high) in enumerate(HR_ZONES):
            label = format_zone_label(name, low, high)
            print(f"- {label}: {format_zone_time(total_zone_secs[i])}")


def print_detail(activities):
    """Print full detail for each activity."""
    if not activities:
        print("No activities found.")
        return

    for a in activities:
        dt = parse_start(a)
        date_str = dt.strftime("%b %d, %Y") if dt else "?"
        elapsed = a.get("elapsed_time", a.get("moving_time", 0))
        end = dt + timedelta(seconds=elapsed) if dt else None

        print(f"## Workout Data — {date_str}")
        print(f"- **Title:** {a.get('name', 'Untitled')}")
        print(f"- **Activity:** {a.get('sport_type', a.get('type', 'Unknown'))}")
        if dt and end:
            print(f"- **Time:** {dt.strftime('%H:%M')}-{end.strftime('%H:%M')}")
        print(f"- **Duration:** {format_duration(elapsed)}")

        desc = a.get("description")
        if desc and desc.strip():
            print(f"- **Description:** {desc.strip()}")

        cals = a.get("calories")
        if cals:
            print(f"- **Active Calories:** {int(cals)} kcal")

        avg_hr = a.get("average_heartrate")
        max_hr = a.get("max_heartrate")
        if avg_hr:
            print(f"- **Avg Heart Rate:** {int(avg_hr)} BPM")
        if max_hr:
            print(f"- **Peak Heart Rate:** {int(max_hr)} BPM")

        zones = a.get("hr_zones")
        if zones:
            print(f"- **HR Zones:**")
            for name, low, high in HR_ZONES:
                z = zones.get(name, {})
                secs = z.get("seconds", 0)
                label = format_zone_label(name, low, high)
                print(f"  - {label}: {format_zone_time(secs)}")

        photos = a.get("local_photos", [])
        if photos:
            print(f"- **Photos:** {len(photos)} attached")
            for p in photos:
                print(f"  - {p}")

        print(f"- **File:** {a.get('_filename', '?')}")
        print()


def update_activity(activities, args):
    """Append notes or set RPE on an activity JSON file."""
    target = None
    for a in activities:
        if a.get("id") == args.id:
            target = a
            break
    if not target:
        print(f"Error: Activity {args.id} not found in training/activities/history/", file=sys.stderr)
        sys.exit(1)

    filepath = Path(target["_file"])
    data = json.loads(filepath.read_text())

    if args.set_rpe:
        data["rpe"] = args.set_rpe
        print(f"Set RPE to {args.set_rpe}")

    if args.add_notes:
        existing = data.get("coach_notes", "")
        if existing:
            data["coach_notes"] = existing + " | " + args.add_notes
        else:
            data["coach_notes"] = args.add_notes
        print(f"Appended notes to activity {args.id}")

    filepath.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Updated: {filepath.name}")


def print_sports(activities):
    """List all sport types with counts."""
    sports = {}
    for a in activities:
        s = a.get("sport_type", a.get("type", "Unknown"))
        sports[s] = sports.get(s, 0) + 1

    print(f"| Sport | Sessions |")
    print(f"|-------|----------|")
    for s, c in sorted(sports.items(), key=lambda x: -x[1]):
        print(f"| {s} | {c} |")


def main():
    parser = argparse.ArgumentParser(description="Search and filter training history")
    parser.add_argument("--sport", type=str, help="Filter by sport type (e.g., Badminton, WeightTraining, Ride)")
    parser.add_argument("--from", dest="from_date", type=str, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to", type=str, help="End date (YYYY-MM-DD)")
    parser.add_argument("--last", type=str, help="Relative time window (e.g., 7d, 2w)")
    parser.add_argument("--peak-hr-above", type=int, help="Filter: peak HR above threshold")
    parser.add_argument("--avg-hr-above", type=int, help="Filter: avg HR above threshold")
    parser.add_argument("--has-photos", action="store_true", help="Only activities with photos")
    parser.add_argument("--has-description", action="store_true", help="Only activities with descriptions")
    parser.add_argument("--search", type=str, help="Text search in title and description")
    parser.add_argument("--id", type=int, help="Single activity by ID")
    parser.add_argument("--summary", action="store_true", help="Show aggregate stats instead of table")
    parser.add_argument("--detail", action="store_true", help="Show full detail per activity")
    parser.add_argument("--list-sports", action="store_true", help="List all sport types with counts")
    parser.add_argument("--add-notes", type=str, help="Append notes to an activity (requires --id)")
    parser.add_argument("--set-rpe", type=int, help="Set RPE (1-10) for an activity (requires --id)")
    args = parser.parse_args()

    activities = load_all_activities()

    if args.list_sports:
        print_sports(activities)
        return

    # Write operations (require --id)
    if args.add_notes or args.set_rpe:
        if not args.id:
            print("Error: --add-notes and --set-rpe require --id", file=sys.stderr)
            sys.exit(1)
        update_activity(activities, args)
        return

    filtered = filter_activities(activities, args)

    if args.summary:
        print_summary(filtered)
    elif args.detail:
        print_detail(filtered)
    else:
        print_table(filtered)


if __name__ == "__main__":
    main()
