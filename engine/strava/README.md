# Strava Pipeline

Scripts for syncing, querying, and renaming Strava activities.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `fetch_strava.py` | Fetch activities from Strava API, save to `training/activities/history/` |
| `strava_api.py` | API wrapper — token management and HTTP client (shared, don't modify directly) |
| `rename_core.py` | Classification engine and name generator — edit this to change naming rules |
| `rename_single.py` | Preview or rename a single activity (safe, dry-run default) |
| `rename_activities.py` | Bulk rename — DANGEROUS, needs your explicit approval before `--apply` |
| `query_history.py` | Search and filter local history — no API calls |

---

## fetch_strava.py

```bash
python3 strava/fetch_strava.py --last 5              # print last 5 activities (read-only)
python3 strava/fetch_strava.py --sync --since DATE   # forward sync from DATE
python3 strava/fetch_strava.py --id ID --save        # pull one activity and save it
```

The sync pipeline runs this automatically. Use directly only for manual debugging or one-off pulls.

---

## query_history.py

Queries `training/activities/history/*.json` locally — fast, no API calls.

```bash
# List sport types with counts
python3 strava/query_history.py --list-sports

# Recent runs
python3 strava/query_history.py --sport Run --last 2w

# Full detail on an activity
python3 strava/query_history.py --id ACTIVITY_ID --detail

# Log coach notes and RPE after a session
python3 strava/query_history.py --id ACTIVITY_ID --set-rpe 7 --add-notes "Notes here."

# Text search
python3 strava/query_history.py --search "Run #8"

# Aggregate stats for a period
python3 strava/query_history.py --sport Run --last 4w --summary
```

Full flag reference: see `skills/pipeline-tools.md`.

---

## Naming Scheme

Counters are per category, reset Jan 1 each year. Classification runs in `rename_core.py`.

| Activity | Condition | Name |
|----------|-----------|------|
| Run | any | `Run #N` |
| WeightTraining | elapsed < 25 min | `Foundation #N: Core` (N ≤ 9) or `Foundation #N: Kickstart` (N ≥ 10) |
| WeightTraining | "recovery"/"mobility" in name + weekday | `Recovery #N` |
| WeightTraining | "recovery"/"mobility" in name + Sunday | `Realign #N` |
| WeightTraining | Sunday + elapsed < 50 min (no keyword match) | `Realign #N` |
| WeightTraining | long, upper keywords | `Weight Training #N: Upper` |
| WeightTraining | long, lower keywords | `Weight Training #N: Lower` |
| WeightTraining | long, no keyword match | `Weight Training #N: General` |
| Yoga | weekday | `Recovery #N` |
| Yoga | Sunday | `Realign #N` |
| Badminton | "ranked" in name/desc | `Badminton: Ranked #N` |
| Badminton | "league" in name/desc | `Badminton: League #N` |
| Badminton | "friendly" in name/desc | `Badminton: Friendly #N` |
| Badminton | casual (no keyword) | `Badminton: Casual #N` |
| Any | "cricket" in name | skip |
| Walk, Hike, Ride, Swim, etc. | — | skip |

**Upper keywords:** "upper", "pull", "push"
**Lower keywords:** "lower", "leg", "squat"

**Counter logic:** Scan `training/activities/history/2026-*.json` → find highest N per category → new = max + 1.

---

## Rename Workflow

```bash
# 1. Preview one activity
python3 strava/rename_single.py ACTIVITY_ID

# 2. Apply if correct
python3 strava/rename_single.py ACTIVITY_ID --apply

# 3. Override name (e.g. if counter is off)
python3 strava/rename_single.py ACTIVITY_ID --name "Run #9" --apply

# 4. Check current counters
python3 strava/rename_single.py --status
```

Bulk rename (backfills only — always preview first):
```bash
python3 strava/rename_activities.py --dry-run   # preview
python3 strava/rename_activities.py --apply     # apply — needs approval
```

---

## Activity JSON Structure

Each file in `training/activities/history/` is the raw Strava API response with two coach-added fields:

| Field | Source | Description |
|-------|--------|-------------|
| `id` | Strava | Activity ID |
| `name` | Strava | Activity name |
| `sport_type` | Strava | Run, WeightTraining, Badminton, Yoga, Walk, etc. |
| `start_date_local` | Strava | Local start time (ISO8601) |
| `distance` | Strava | Metres |
| `moving_time` | Strava | Seconds |
| `elapsed_time` | Strava | Seconds |
| `average_heartrate` | Strava | bpm (if HR monitor worn) |
| `max_heartrate` | Strava | bpm |
| `description` | Strava | Activity description |
| `coach_notes` | Coach | Appended by `query_history.py --add-notes` |
| `rpe` | Coach | Set by `query_history.py --set-rpe` |

---

## HR Zone Reference (fill in for your athlete)

Max HR: ~[fill in — e.g. 220 minus age, or a known tested max]

| Zone | BPM | Use |
|------|-----|-----|
| 1 | < [x] | Recovery, walks |
| 2 | [x]-[x] | All training runs (target) |
| 3 | [x]-[x] | Tempo — short segments only in Build phase |
| 4 | [x]-[x] | Threshold |
| 5 | > [x] | Max effort |

---

## Data Layout

```
training/
├── history/           # All activities — one JSON per activity, git-tracked
│   └── YYYY-MM-DD_HHMMSS_ACTIVITYID.json
├── last_week/         # Last 7 days — auto-populated by sync pipeline, NOT committed
│   └── (same format)
├── sync_state.json    # Sync boundaries — updated by fetch_strava.py
└── sync_status.json   # Pipeline status for UI display
```
