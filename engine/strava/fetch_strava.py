#!/usr/bin/env python3
"""Fetch workout data from Strava API and output in the standard format.

Usage:
    python fetch_strava.py                    # latest activity
    python fetch_strava.py --last N           # last N activities
    python fetch_strava.py --last-week        # all activities from the past 7 days
    python fetch_strava.py --id ID            # specific activity by ID
    python fetch_strava.py --date 2026-03-23  # activities on a specific date
    python fetch_strava.py --sync --since 2025-12-24  # sync all history backwards to disk
    python fetch_strava.py --last 3 --save            # fetch + save 3 recent to training/activities/history/
    python fetch_strava.py --id ID --save             # fetch + save specific activity to training/activities/history/
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_BOOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_BOOT.parent / "lib"))
from repo_layout import activities_dir, hist_dir, repo_root_from_here, sync_state_path  # noqa: E402

from strava_api import load_tokens, save_tokens, refresh_if_needed, api_get

REPO_DIR = repo_root_from_here(__file__)
HISTORY_DIR = hist_dir(REPO_DIR)
PHOTOS_DIR = activities_dir(REPO_DIR) / "photos"
SYNC_STATE_PATH = sync_state_path(REPO_DIR)

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


def format_duration(seconds):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m {s}s"


def format_zone_time(seconds):
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}m {s}s"
    if m > 0:
        return f"{m}m {s}s"
    return f"{s}s"


def compute_hr_zones(tokens, activity_id):
    """Fetch HR stream and compute time in each zone."""
    try:
        streams = api_get(tokens, f"/activities/{activity_id}/streams",
                          {"keys": "time,heartrate", "key_by_type": "true"})
    except Exception:
        return None

    time_data = streams.get("time", {}).get("data")
    hr_data = streams.get("heartrate", {}).get("data")
    if not time_data or not hr_data or len(time_data) != len(hr_data):
        return None

    zone_seconds = [0.0] * len(HR_ZONES)
    for i in range(1, len(time_data)):
        dt = time_data[i] - time_data[i - 1]
        hr = hr_data[i]
        for z, (_, low, high) in enumerate(HR_ZONES):
            if low is None and hr <= high:
                zone_seconds[z] += dt
                break
            elif high is None and hr >= low:
                zone_seconds[z] += dt
                break
            elif low is not None and high is not None and low <= hr <= high:
                zone_seconds[z] += dt
                break

    return zone_seconds


def format_zone_label(name, low, high):
    if low is None:
        return f"{name} (<{high + 1} BPM)"
    if high is None:
        return f"{name} ({low}+ BPM)"
    return f"{name} ({low}-{high} BPM)"


def fetch_photos(tokens, activity_id, save_dir=None):
    """Fetch activity photos and download them. Returns list of local file paths."""
    try:
        photos = api_get(tokens, f"/activities/{activity_id}/photos", {"size": "600"})
    except Exception:
        return []

    if not photos:
        return []

    photo_dir = save_dir or (Path.home() / "strava_photos")
    photo_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, photo in enumerate(photos):
        url = photo.get("urls", {}).get("600")
        if not url:
            continue
        filename = f"{activity_id}_{i}.jpg"
        filepath = photo_dir / filename
        if filepath.exists():
            paths.append(str(filepath))
            continue
        try:
            import requests
            r = requests.get(url)
            r.raise_for_status()
            filepath.write_bytes(r.content)
            paths.append(str(filepath))
        except Exception:
            continue
    return paths


def enrich_activity(activity, tokens, photo_dir=None):
    """Fetch detail, HR zones, and photos for an activity. Returns enriched dict."""
    detail = api_get(tokens, f"/activities/{activity['id']}")

    enriched = {**detail}

    # HR zones
    if activity.get("has_heartrate"):
        zone_seconds = compute_hr_zones(tokens, activity["id"])
        if zone_seconds:
            enriched["hr_zones"] = {
                name: {"low": low, "high": high, "seconds": secs}
                for (name, low, high), secs in zip(HR_ZONES, zone_seconds)
            }

    # Photos
    photo_count = activity.get("total_photo_count", 0) or detail.get("total_photo_count", 0)
    if photo_count > 0:
        photo_paths = fetch_photos(tokens, activity["id"], save_dir=photo_dir)
        enriched["local_photos"] = photo_paths

    return enriched


def format_activity(activity, tokens):
    """Format a single activity into the standard output block."""
    start = datetime.fromisoformat(activity["start_date_local"].replace("Z", "+00:00"))
    elapsed = activity.get("elapsed_time", activity.get("moving_time", 0))
    end = start + timedelta(seconds=elapsed)
    date_str = start.strftime("%b %d, %Y")

    lines = [f"## Workout Data — {date_str}"]
    lines.append(f"- **Title:** {activity.get('name', 'Untitled')}")
    lines.append(f"- **Activity:** {activity.get('sport_type', activity.get('type', 'Unknown'))}")
    lines.append(f"- **Time:** {start.strftime('%H:%M')}-{end.strftime('%H:%M')}")
    lines.append(f"- **Duration:** {format_duration(elapsed)}")

    detail = api_get(tokens, f"/activities/{activity['id']}")
    desc = detail.get("description")
    if desc:
        lines.append(f"- **Description:** {desc}")
    cals = detail.get("calories")
    if cals:
        lines.append(f"- **Active Calories:** {int(cals)} kcal")

    if activity.get("has_heartrate"):
        avg_hr = activity.get("average_heartrate") or detail.get("average_heartrate")
        max_hr = activity.get("max_heartrate") or detail.get("max_heartrate")
        if avg_hr:
            lines.append(f"- **Avg Heart Rate:** {int(avg_hr)} BPM")
        if max_hr:
            lines.append(f"- **Peak Heart Rate:** {int(max_hr)} BPM")

        zone_seconds = compute_hr_zones(tokens, activity["id"])
        if zone_seconds:
            lines.append("- **HR Zones:**")
            for i, (name, low, high) in enumerate(HR_ZONES):
                label = format_zone_label(name, low, high)
                lines.append(f"  - {label}: {format_zone_time(zone_seconds[i])}")

    photo_count = activity.get("total_photo_count", 0) or detail.get("total_photo_count", 0)
    if photo_count > 0:
        photo_paths = fetch_photos(tokens, activity["id"])
        if photo_paths:
            lines.append(f"- **Photos:** {len(photo_paths)} attached")
            for p in photo_paths:
                lines.append(f"  - {p}")

    return "\n".join(lines)


def fetch_activities(tokens, params):
    """Fetch activities with pagination support."""
    all_activities = []
    page = 1
    per_page = params.get("per_page", 30)
    while True:
        p = {**params, "page": page, "per_page": per_page}
        activities = api_get(tokens, "/athlete/activities", p)
        if not activities:
            break
        all_activities.extend(activities)
        if len(activities) < per_page:
            break
        page += 1
    return all_activities


def activity_filename(activity):
    """Generate filename from activity: YYYY-MM-DD_HHMMSS_ID.json"""
    start = activity.get("start_date_local", "")
    dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    return f"{dt.strftime('%Y-%m-%d_%H%M%S')}_{activity['id']}.json"


def load_sync_state():
    if SYNC_STATE_PATH.exists():
        return json.loads(SYNC_STATE_PATH.read_text())
    return {}


def save_sync_state(state):
    SYNC_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    SYNC_STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")


def existing_activity_ids():
    """Get set of activity IDs already saved to disk."""
    ids = set()
    if HISTORY_DIR.exists():
        for f in HISTORY_DIR.glob("*.json"):
            # filename: YYYY-MM-DD_HHMMSS_ID.json
            parts = f.stem.rsplit("_", 1)
            if len(parts) == 2:
                try:
                    ids.add(int(parts[1]))
                except ValueError:
                    pass
    return ids


def sync_week(tokens, week_start, week_end, saved_ids, photo_dir):
    """Sync a single week of activities. Returns count of new activities saved."""
    params = {
        "after": int(week_start.timestamp()),
        "before": int(week_end.timestamp()),
        "per_page": 200,
    }
    activities = fetch_activities(tokens, params)
    new_count = 0

    for a in activities:
        if a["id"] in saved_ids:
            continue

        enriched = enrich_activity(a, tokens, photo_dir=photo_dir)
        fname = activity_filename(a)
        filepath = HISTORY_DIR / fname
        filepath.write_text(json.dumps(enriched, indent=2, default=str) + "\n")
        saved_ids.add(a["id"])
        new_count += 1
        print(f"  Saved: {fname} ({a.get('sport_type', a.get('type'))})", file=sys.stderr)

    return new_count


def sync_activities(tokens, since_date):
    """Sync activities in two passes: forward (catch new), then backward (fill history)."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    saved_ids = existing_activity_ids()
    state = load_sync_state()
    now = datetime.now(timezone.utc)
    since_dt = datetime.strptime(since_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    total_saved = state.get("total_activities", len(saved_ids))

    # === FORWARD PASS: newest_synced → now (catch new activities) ===
    # Subtract 48h overlap to catch activities that arrived on Strava late
    # (e.g. Apple Watch → Strava sync delay). Dedup via saved_ids.
    FORWARD_OVERLAP = timedelta(hours=48)
    newest_synced = state.get("newest_synced")
    if newest_synced:
        forward_start = datetime.fromisoformat(newest_synced).replace(tzinfo=timezone.utc) - FORWARD_OVERLAP
        if forward_start < now:
            print(f"Forward sync: {forward_start.strftime('%Y-%m-%d')} → now", file=sys.stderr)
            week_start = forward_start
            while week_start < now:
                week_end = min(week_start + timedelta(days=7), now)
                print(f"\nFetching: {week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}",
                      file=sys.stderr)
                new_count = sync_week(tokens, week_start, week_end, saved_ids, PHOTOS_DIR)
                total_saved += new_count
                print(f"  Week complete: {new_count} new activities.", file=sys.stderr)
                week_start = week_end

            state["newest_synced"] = now.isoformat()
            state["total_activities"] = total_saved
            state["last_run"] = now.isoformat()
            save_sync_state(state)
            print(f"\nForward sync done.", file=sys.stderr)

    # === BACKWARD PASS: oldest_synced → since_date (fill history) ===
    oldest_synced = state.get("oldest_synced")
    if oldest_synced:
        resume_end = datetime.fromisoformat(oldest_synced).replace(tzinfo=timezone.utc)
        if resume_end <= since_dt:
            print(f"\nBackward sync already complete (reached {since_date}).", file=sys.stderr)
        else:
            print(f"\nBackward sync: {resume_end.strftime('%Y-%m-%d')} → {since_date}", file=sys.stderr)
    else:
        resume_end = now
        print(f"Starting fresh sync from now back to {since_date}.", file=sys.stderr)

    # Walk backwards week by week
    week_end = resume_end
    while week_end > since_dt:
        week_start = max(week_end - timedelta(days=7), since_dt)
        print(f"\nFetching: {week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}",
              file=sys.stderr)

        new_count = sync_week(tokens, week_start, week_end, saved_ids, PHOTOS_DIR)
        total_saved += new_count
        print(f"  Week complete: {new_count} new activities.", file=sys.stderr)

        state["oldest_synced"] = week_start.isoformat()
        if not state.get("newest_synced"):
            state["newest_synced"] = now.isoformat()
        state["total_activities"] = total_saved
        state["since"] = since_date
        state["last_run"] = now.isoformat()
        save_sync_state(state)

        week_end = week_start

    print(f"\nSync complete! {total_saved} total activities on disk.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Fetch Strava workout data")
    parser.add_argument("--last", type=int, default=None, help="Number of recent activities")
    parser.add_argument("--last-week", action="store_true", help="All activities from the past 7 days")
    parser.add_argument("--id", type=int, help="Specific activity ID")
    parser.add_argument("--date", type=str, help="Date in YYYY-MM-DD format")
    parser.add_argument("--sync", action="store_true", help="Sync activities to activity history directory")
    parser.add_argument("--since", type=str, help="Sync start date (YYYY-MM-DD), used with --sync")
    parser.add_argument("--save", action="store_true", help="Save fetched activities to history (use with --last or --id)")
    args = parser.parse_args()

    tokens = refresh_if_needed(load_tokens())

    if args.sync:
        since = args.since
        if not since:
            state = load_sync_state()
            since = state.get("since")
        if not since:
            sys.exit("--sync requires --since YYYY-MM-DD (or a previous sync_state.json)")
        sync_activities(tokens, since)
    elif args.id:
        activity = api_get(tokens, f"/activities/{args.id}")
        if args.save:
            saved_ids = existing_activity_ids()
            if activity["id"] in saved_ids:
                print(f"Already saved: {activity_filename(activity)}", file=sys.stderr)
            else:
                enriched = enrich_activity(activity, tokens, photo_dir=PHOTOS_DIR)
                fname = activity_filename(activity)
                (HISTORY_DIR / fname).write_text(json.dumps(enriched, indent=2, default=str) + "\n")
                print(f"Saved: {fname}", file=sys.stderr)
        else:
            print(format_activity(activity, tokens))
    elif args.last_week:
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        params = {"after": int(week_ago.timestamp()), "per_page": 30}
        activities = fetch_activities(tokens, params)
        if not activities:
            print("No activities in the past 7 days.")
            return
        blocks = [format_activity(a, tokens) for a in activities]
        print("\n\n".join(blocks))
    elif args.date:
        dt = datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        params = {
            "after": int(dt.timestamp()),
            "before": int((dt + timedelta(days=1)).timestamp()),
            "per_page": 30,
        }
        activities = fetch_activities(tokens, params)
        if not activities:
            print("No activities found on that date.")
            return
        blocks = [format_activity(a, tokens) for a in activities]
        print("\n\n".join(blocks))
    else:
        count = args.last or 1
        params = {"per_page": count}
        activities = api_get(tokens, "/athlete/activities", params)
        if not activities:
            print("No activities found.")
            return
        if args.save:
            HISTORY_DIR.mkdir(parents=True, exist_ok=True)
            saved_ids = existing_activity_ids()
            for a in activities:
                if a["id"] in saved_ids:
                    print(f"Already saved: {activity_filename(a)}", file=sys.stderr)
                    continue
                enriched = enrich_activity(a, tokens, photo_dir=PHOTOS_DIR)
                fname = activity_filename(a)
                (HISTORY_DIR / fname).write_text(json.dumps(enriched, indent=2, default=str) + "\n")
                print(f"Saved: {fname}", file=sys.stderr)
        else:
            blocks = [format_activity(a, tokens) for a in activities]
            print("\n\n".join(blocks))


if __name__ == "__main__":
    main()
