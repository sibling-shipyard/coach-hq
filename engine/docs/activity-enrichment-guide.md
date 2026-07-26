# Activity Enrichment Guide

This guide covers the full pipeline for enriching Strava activities with proper names, match data, leaderboard rankings, and formatted descriptions. It operates in two modes: **Backfill** (one-time historical enrichment) and **Weekly** (ongoing maintenance after each session).

## Prerequisites

The following must be in place before starting:

| Item | Location | Notes |
|------|----------|-------|
| Strava tokens (with `activity:write` scope) | `strava/strava_tokens.json` | Refresh handled automatically |
| Synced activity history | `training/activities/history/*.json` | Run `fetch_strava.py --sync` to backfill |
| Badminton match history | `plugins/badminton/data/badminton_match_data.json` | Auto-updated by pipeline + iOS when scores are pasted |

## Overview

The pipeline has 5 stages, each building on the previous:

```
1. Classify → 2. Gather Match Data → 3. Generate Descriptions → 4. Review → 5. Push to Strava
```

### Backfill vs Weekly

| Aspect | Backfill Mode | Weekly Mode |
|--------|--------------|-------------|
| Scope | All activities for a year | This week's new activities |
| Match data | Parsed from pasted text descriptions → `badminton_match_data.json` | Paste `{partner} me vs {opp}/{opp} {score}` lines on iOS or in Strava |
| Naming | Assign counters from Jan 1 of the year | Continue from last counter value |
| Review | Full table of all renames | Quick check of 1-5 activities |

---

## Stage 1: Classify and Rename Activities

**Goal:** Assign each activity a name following the naming scheme.

### Naming Scheme

| Type | Pattern | Notes |
|------|---------|-------|
| Morning routine (pre-2026) | `Foundation #K: Core` | All pre-2026 foundations are Core |
| Morning routine (2026, pre-Mar 9) | `Foundation #K: Core` | |
| Morning routine (2026, Mar 9+) | `Foundation #K: Kickstart` | Continues same counter |
| Calisthenics (Workout A/B) | `Calisthenics #K: [focus]` | e.g., FL & Handstand, General |
| Recovery (Workout C) | `Recovery #K` | |
| Corrective (Workout D) | `Realign #K` | |
| Monday badminton | `Hit & Run #K: Ranked` | Single counter for all H&R |
| Thursday badminton | `Hit & Run #K: Friendly` | Same counter as Monday |
| Saturday badminton | `Badminton: Sat session` | No counter |
| League | `League #K: vs [opponent] ([result])` | e.g., `vs LBA (1W-2L)` |
| Cycling, runs, yoga | Leave as-is | |

Counters are **per-type** and **per-year**, starting from #1 on Jan 1 each year.

### Steps

1. **List all activities** for the target period. For each activity, extract: date, day-of-week, sport_type, name, duration, photos, description.

2. **Auto-classify** based on sport type, duration, day-of-week, and name patterns:
   - Badminton + Monday → Hit & Run Ranked
   - Badminton + Thursday → Hit & Run Friendly
   - Badminton + Saturday → Badminton: Sat session
   - WeightTraining + <30 min → Foundation
   - WeightTraining + >45 min → Calisthenics
   - Yoga/stretching → Recovery

3. **Flag outliers** for manual review. Common outliers:
   - Short weight training on unusual days
   - Badminton on non-standard days (could be friendly, league, or casual)
   - Activities with ambiguous names

4. **Get the athlete's input** on all outliers before proceeding.

5. **Assign counters** chronologically within each type.

6. **Generate final rename list** as a table for review. Include: date, day, current name, proposed name.

7. **After approval**, rename on Strava via API:
   ```python
   requests.put(f'https://www.strava.com/api/v3/activities/{activity_id}',
                headers=h, json={'name': new_name})
   ```

8. **Update local JSON files** with the new names too.

---

## Stage 2: Gather Match Data and Leaderboard

**Goal:** Collect match results and session rankings for Monday ranked sessions.

### Match data (current workflow)

Match data comes from **text descriptions** pasted into the activity (iOS app or Strava). Format:

```
Tony me vs Alston/Wei 21-18
Tony me vs Alex/Yin 13-21
```

The pipeline (`scripts/parse_match_description.py`) and iOS `DescriptionParser` parse this into:
1. A formatted Strava description (`Games:` / `Friendlies:` sections)
2. A structured entry in `plugins/badminton/data/badminton_match_data.json`

**Weekly mode:** After each Monday session, paste raw scores into the activity description on iOS (or Strava). Sync runs the parser automatically on new activities.

### Legacy data sources (historical backfill only)

| Period | Match Data Source | Leaderboard Source |
|--------|------------------|--------------------|
| Jul 24, 2023 onwards | `badminton_match_data.json` (from text descriptions) | Photos (screenshots) |
| Before Jul 24, 2023 | Photos (match result screenshots) | Photos (leaderboard screenshots) |

### Step 2b: Photo Parsing for Match Data (Before Jul 24, 2023 — historical only)

For sessions before Jul 24, 2023, eBadders data does not exist. Match data must be extracted from photos attached to the Strava activity.

1. **List all Monday badminton activities with photos** in the target period.
2. **View each photo** to identify match result screenshots (Games tab showing scores).
3. **Extract match data** from the photo: for each game, record W/L, score, partner, opponents.
4. **Store in the same format** as eBadders data so Stage 3 can handle it uniformly:
   ```json
   {
     "wins": 3, "losses": 4, "win_pct": 43,
     "matches": [
       {"akash_won": true, "score": "21-16", "partner": ["Dom L"], "vs": ["Kean", "Harry S"]},
       ...
     ]
   }
   ```

### Step 2c: Leaderboard Data (All Periods)

Leaderboard/ranking data is only available from screenshots — eBadders does not provide historical rankings.

1. **List all Monday activities with 2+ photos** (the `_0.jpg` is usually the leaderboard).
2. **View each `_0.jpg`** to check if it's a session ranking screenshot.
3. **Extract:** session_rank, win_pct, avg_points, grade, club_rank, top_n_players.
4. **Store temporarily** — this data will be folded into the description in Stage 3.

> **Note:** Not all sessions have leaderboard screenshots. For those without, the rank line is simply omitted from the description.

---

## Stage 3: Generate Descriptions

**Goal:** Create a formatted description for each Monday ranked session combining all data sources.

### Description Format

```
[existing comment if any]

{W}W-{L}L ({pct}%) | Rank: {session_rank}

Games:
W {score} w/ {partner} vs {opponent1} + {opponent2}
L {score} w/ {partner} vs {opponent1} + {opponent2}
...

[Friendlies: (if any manually recorded)]
```

### Rules

1. **Preserve existing descriptions** — if the athlete has written a comment, keep it at the top.
2. **Rank line** — only include `| Rank: K` if leaderboard data is available for that session.
3. **Games section** — sourced from parsed text descriptions or historical photo backfill. Each line: `W/L score w/ partner vs opponents`.
4. **Friendlies** — if manually recorded in the existing description, move to bottom in the same format.
5. **No description for non-ranked sessions** — Thursday friendlies, Saturday casuals, and league matches don't get auto-descriptions unless scores are pasted.
6. **Missing match data** — if no text description or photo data is available, generate a minimal description with just the rank line (if available) or skip entirely.

### Steps

1. **For each activity with match data**, generate the description string.
2. **Preview all changes** in a markdown file for review.
3. **Get approval** before applying.
4. **Update local JSONs** with the new description.
5. **Remove legacy `ebadders` keys** from activity JSONs if present — the description is the display layer, `badminton_match_data.json` is the analytics layer.

---

## Stage 4: Review

**Goal:** Final review before pushing to Strava.

### Backfill Mode

1. Generate a full markdown preview with old vs new descriptions for every activity.
2. Present to the athlete for review.
3. Address any corrections (wrong classification, missing data, formatting issues).

### Weekly Mode

1. Show the 1-5 new activities with proposed names and descriptions.
2. Quick confirmation before pushing.

---

## Stage 5: Push to Strava

**Goal:** Update activity names and descriptions on Strava via API.

### API Details

```python
# Update name
requests.put(f'https://www.strava.com/api/v3/activities/{id}',
             headers=h, json={'name': new_name})

# Update description
requests.put(f'https://www.strava.com/api/v3/activities/{id}',
             headers=h, json={'description': new_desc})
```

### Rate Limits

Strava enforces **100 requests per 15 minutes** and **1000 per day**. With 0.5s delay between requests, a batch of 50 takes ~25 seconds but may hit the 15-min limit if preceded by sync operations.

### Steps

1. **Always test with 2 activities first** — push, verify on Strava, then proceed.
2. **Push remaining batch** with rate-limit retry logic (wait for `Retry-After` header).
3. **Commit local changes** before pushing to Strava (local is source of truth).

---

## Year-Specific Notes

### 2026

Enrichment complete. Foundation suffix transitioned from Core (#1-9) to Kickstart (#10+) on Mar 9.

### 2025

- All Foundation sessions use `: Core` suffix.
- eBadders data covers all 20 Monday sessions (Feb 3 onwards). Already merged.
- 7 sessions have leaderboard screenshots (May-Oct). Already extracted.
- Hit & Run counter starts at #1.
- Counters are independent from 2026.

### 2024 (P2)

- eBadders data covers sessions from Jan 15 onwards (32 sessions in 2023-2024 range).
- Strava sync needs extending backward from Jan 1, 2025 to cover 2024.
- All Foundation sessions use `: Core` suffix.
- Hit & Run counter starts at #1.

### Pre-Jul 2023 (if ever needed)

- No eBadders data. Match results must come from photo parsing only.
- Leaderboard screenshots are the only data source for both matches and rankings.

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `strava/fetch_strava.py --sync` | Sync activities from Strava (forward + backward) |
| `scripts/parse_match_description.py` | Parse pasted text scores into formatted descriptions |
| `plugins/badminton/analytics.py` | Generate analytics snapshot from history + match data |
| `strava/rename_activities.py` | Auto-classify and rename (needs updating per year) |

## Data Architecture

```
plugins/badminton/data/badminton_match_data.json    ← Master analytics source (structured match history)
training/activities/history/*.json           ← Per-activity data (Strava + description as display layer)
docs/activity-enrichment-guide.md ← This guide
```
