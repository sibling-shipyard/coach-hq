# Pipeline Tools — CLI Reference

Load this file on-demand when you need to run pipeline scripts. Do not read at boot.

---

## fetch_strava.py

Fetches activity data from the Strava API. The sync pipeline runs this automatically — only use directly for manual debugging or one-off pulls.

```bash
python3 strava/fetch_strava.py [flags]
```

| Flag | Description |
|------|-------------|
| `--last N` | Print last N activities to stdout (no sync) |
| `--last-week` | Print all activities from the past 7 days to stdout |
| `--id ID` | Fetch a specific activity by Strava ID |
| `--date YYYY-MM-DD` | Fetch activities on a specific date |
| `--sync` | Sync mode — write fetched activities to `training/activities/history/` |
| `--since YYYY-MM-DD` | Use with `--sync` — only fetch activities from this date forward |
| `--save` | Save fetched activities to `training/activities/history/` (use with `--last` or `--id`) |

**Common recipes:**

```bash
# Check what came in recently (read-only, no writes)
python3 strava/fetch_strava.py --last 5

# Manual forward sync from a specific date
python3 strava/fetch_strava.py --sync --since 2026-05-20

# Pull a specific activity and save it
python3 strava/fetch_strava.py --id 12345678 --save
```

**Rate limit:** 100 requests per 15 minutes, 1000 per day. Token refresh is automatic via `strava_api.py`.

---

## query_history.py

Searches local `training/activities/history/*.json` files. No API calls — fast and safe.

```bash
python3 strava/query_history.py [filters] [output mode]
```

**Filters:**

| Flag | Description |
|------|-------------|
| `--sport SPORT` | Filter by sport type (e.g., Run, WeightTraining, Badminton) |
| `--from YYYY-MM-DD` | Start date filter |
| `--to YYYY-MM-DD` | End date filter |
| `--last Nd/Nw` | Relative window (e.g., `7d`, `2w`, `12w`) |
| `--peak-hr-above N` | Only activities where peak HR > N |
| `--avg-hr-above N` | Only activities where avg HR > N |
| `--has-photos` | Only activities with photos |
| `--has-description` | Only activities with a description |
| `--search TEXT` | Text search in title and description |
| `--id ID` | Single activity by Strava ID |
| `--list-sports` | List all sport types with counts (no other output) |

**Output modes:**

| Flag | Description |
|------|-------------|
| *(default)* | Table view — one row per activity |
| `--summary` | Aggregate stats (count, total distance, avg HR) |
| `--detail` | Full JSON-style detail per activity |

**Mutation flags (require `--id`):**

| Flag | Description |
|------|-------------|
| `--add-notes "text"` | Append coach notes to the activity's local JSON |
| `--set-rpe N` | Set RPE (1-10) on the activity's local JSON |

**Common recipes:**

```bash
# What runs has the athlete done in the last 2 weeks?
python3 strava/query_history.py --sport Run --last 2w

# Full detail on last 3 months of activity
python3 strava/query_history.py --last 12w --detail

# Log RPE and notes after a session
python3 strava/query_history.py --id 12345678 --set-rpe 7 --add-notes "Knee held up. HR drifted high in final km — heat effect."

# What sport types are in the history?
python3 strava/query_history.py --list-sports

# Find a specific workout by name
python3 strava/query_history.py --search "Run #8"
```

---

## rename_single.py

Preview or apply a rename for a single Strava activity. Always dry-run before applying.

```bash
python3 strava/rename_single.py [activity_id] [flags]
```

| Flag | Description |
|------|-------------|
| *(no flags)* | Dry-run — show what the new name would be, no changes |
| `--apply` | Apply rename to Strava API + local JSON |
| `--name "..."` | Override: use this exact name instead of auto-classification |
| `--status` | Show current counters for all categories (no activity needed) |

**Counter logic:** Scans `training/activities/history/*.json`, buckets by the activity's calendar year (from `start_date_local`), and finds the highest counter per (year, category) — new activity = max + 1 within that year. Counters reset every Jan 1. Example: if `Run #8` is the highest in 2026, next 2026 run gets `Run #9`, but the first run of 2027 starts at `Run #1`.

**Common workflow:**

```bash
# 1. Check what name would be assigned
python3 strava/rename_single.py 12345678

# 2. Apply if it looks right
python3 strava/rename_single.py 12345678 --apply

# 3. Override if you know the exact context (e.g. counter was off)
python3 strava/rename_single.py 12345678 --name "Weight Training #5: Upper" --apply

# 4. Check where all counters currently stand
python3 strava/rename_single.py --status
```

---

## rename_activities.py

Bulk rename for multiple activities. **Dangerous** — use only for backfills. Always preview first.

```bash
python3 strava/rename_activities.py [flags]
```

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview all changes — no API calls, nothing modified |
| `--apply` | Apply all renames to Strava + local JSON |
| `--id ID` | Only rename a specific activity (same as rename_single.py but via this script) |
| `--status` | Show current counters and rename/skip counts |

**Rule:** Always run `--dry-run` first and get the athlete's approval before `--apply`. This touches many activities at once — there's no easy undo.

---

## generate_quest_log.py

Regenerates `training/activities/quest_log.md` from `training/ledger/challenge_v2.json` + `training/activities/history/*.json`. Run this before every coach commit.

```bash
python3 scripts/generate_quest_log.py [flags]
```

| Flag | Description |
|------|-------------|
| *(no flags)* | Regenerate and write `training/activities/quest_log.md` |
| `--dry-run` | Print output to stdout instead of writing the file |
| `--date YYYY-MM-DD` | Override today's date (for testing) |
| `--validate` | Validate `challenge_v2.json` schema and exit |

```bash
# Standard usage before commit
python3 scripts/generate_quest_log.py

# Preview without writing
python3 scripts/generate_quest_log.py --dry-run

# Validate the challenge JSON is well-formed
python3 scripts/generate_quest_log.py --validate
```
