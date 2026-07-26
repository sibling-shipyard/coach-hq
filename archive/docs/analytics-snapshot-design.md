# Design Doc: Analytics Snapshot for Coach Integration

**Status:** Draft
**Author:** Sky + Manus
**Date:** 2026-03-28

## Goal

Give Coach Phelps access to pre-computed match analytics so it can reference performance data during coaching sessions — without running complex queries at boot time.

## Overview

A new script `generate_analytics_snapshot.py` reads activity JSONs and eBadders data, computes key match analytics, and writes a compact `training/analytics_snapshot.json`. The pipeline runs this as a final step after enrichment. Coach Phelps reads the snapshot during boot (added to SOUL.md boot sequence) and references it in pre/post session coaching.

## Schema

```json
{
  "generated_at": "2026-03-28T10:00:00Z",
  "data_range": {
    "first_session": "2024-01-15",
    "last_session": "2026-03-26",
    "total_sessions": 51,
    "total_games": 516
  },

  "ranked": {
    "overall": {
      "win_rate": 48,
      "total_games": 502,
      "total_sessions": 50,
      "best_month": { "label": "Oct 2025", "win_rate": 62 },
      "current_form": { "type": "losing_streak", "count": 4, "label": "4 session losing streak" }
    },
    "fatigue_curve": {
      "drop_off_game": 8,
      "buckets": {
        "early": { "games": "1-4", "win_rate": 55, "sample_size": 198 },
        "mid": { "games": "5-8", "win_rate": 48, "sample_size": 180 },
        "late": { "games": "9+", "win_rate": 35, "sample_size": 124 }
      },
      "insight": "Win rate drops from 55% (games 1-4) to 35% (games 9+). You fade after game 8."
    },
    "score_distribution": {
      "blowout_win": { "pct": 13, "count": 65 },
      "comfortable_win": { "pct": 17, "count": 85 },
      "close_win": { "pct": 18, "count": 90 },
      "close_loss": { "pct": 16, "count": 80 },
      "comfortable_loss": { "pct": 24, "count": 120 },
      "blowout_loss": { "pct": 12, "count": 62 },
      "insight": "Most common result: Comfortable Loss (4-7 pts) — 24%. You're competitive but not closing."
    },
    "top_partners": [
      { "name": "Ethan", "games": 8, "win_pct": 75, "score_diff": 2.1, "form": "up" },
      { "name": "Bogdana", "games": 8, "win_pct": 75, "score_diff": 1.8, "form": "stable" },
      { "name": "Tsz To", "games": 12, "win_pct": 67, "score_diff": 1.5, "form": "up" }
    ],
    "nemesis": [
      { "name": "Joe Chung", "games": 38, "win_pct": 26, "score_diff": -2.9, "form": "stable" },
      { "name": "Georgi", "games": 26, "win_pct": 31, "score_diff": -2.8, "form": "down" },
      { "name": "Steven Tran", "games": 23, "win_pct": 26, "score_diff": -1.9, "form": "stable" }
    ],
    "monthly_trend": [
      { "month": "Mar 2026", "win_rate": 25, "sessions": 3 },
      { "month": "Feb 2026", "win_rate": 43, "sessions": 4 },
      { "month": "Jan 2026", "win_rate": 43, "sessions": 4 }
    ],
    "recent_sessions": [
      { "date": "2026-03-23", "name": "Hit & Run #17: Ranked", "wl": "2W-5L", "win_pct": 29, "avg_hr": 132 },
      { "date": "2026-03-09", "name": "Hit & Run #15: Ranked", "wl": "2W-5L", "win_pct": 29, "avg_hr": 120 },
      { "date": "2026-03-02", "name": "Hit & Run #13: Ranked", "wl": "2W-6L", "win_pct": 25, "avg_hr": 129 },
      { "date": "2026-02-23", "name": "Hit & Run #11: Ranked", "wl": "0W-8L", "win_pct": 0, "avg_hr": 131 },
      { "date": "2026-02-09", "name": "Hit & Run #9: Ranked", "wl": "4W-3L", "win_pct": 57, "avg_hr": 114 }
    ]
  },

  "all_games": {
    "overall": {
      "win_rate": 47,
      "total_games": 516,
      "total_sessions": 51,
      "best_month": { "label": "Oct 2025", "win_rate": 62 },
      "current_form": { "type": "losing_streak", "count": 5, "label": "5 session losing streak" }
    },
    "fatigue_curve": { "...same structure as ranked..." : "" },
    "score_distribution": { "...same structure as ranked..." : "" },
    "top_partners": ["...same structure, different numbers..."],
    "nemesis": ["...same structure, different numbers..."],
    "monthly_trend": ["...same structure..."],
    "recent_sessions": ["...includes friendlies..."]
  }
}
```

The `ranked` and `all_games` sections share the same structure. The `ranked` section only counts games from the ranked/league portion of session descriptions (excludes "Friendlies:" section). The `all_games` section includes everything.

## Implementation

### 1. New script: `scripts/generate_analytics_snapshot.py`

**Input:** `training/history/*.json`, `training/ebadders_history.json`

**Logic:**
- Load all activity JSONs
- Filter to badminton activities (same category logic as dashboard: `badminton_ranked`, `badminton_league`, `badminton_friendly`, `badminton_casual`)
- Parse descriptions using the same regex patterns as `parse_match_description.py` — extract W/L, scores, partners, opponents, friendly separator
- For each session, compute ranked games (before "Friendlies:" separator) and all games
- Aggregate stats for both `ranked` and `all_games` sections
- Compute fatigue buckets: early (1-4), mid (5-8), late (9+) — configurable
- Score distribution: 6 buckets based on point differential (blowout = 8+, comfortable = 4-7, close = 1-3)
- Top partners: composite score = `games * win_pct / 100`, min 10 games, >50% win rate, top 3
- Nemesis: composite score = `games * (1 - win_pct / 100)`, min 10 games, <50% win rate, top 3
- Form: last 5 games trend (up/down/stable)
- Monthly trend: last 3 months
- Recent sessions: last 5
- Write to `training/analytics_snapshot.json`

**Dependencies:** None beyond stdlib + existing `parse_match_description.py` functions.

### 2. Pipeline integration: `run_sync_pipeline.py`

Add as **Step 6** (after quest log generation, before sync status write):

```python
# ─── Step 6: Generate analytics snapshot ─────────────────────────
def step_generate_analytics_snapshot() -> bool:
    log("Generating analytics snapshot...")
    result = subprocess.run(
        [sys.executable, str(REPO_DIR / "scripts" / "generate_analytics_snapshot.py")],
        cwd=REPO_DIR,
        timeout=SUBPROCESS_TIMEOUT,
    )
    return result.returncode == 0
```

### 3. GitHub Action: `sync-dashboard-data.yml`

Add to the "Sync data files" step:

```yaml
# Copy analytics snapshot
if [ -f source/training/analytics_snapshot.json ]; then
  cp source/training/analytics_snapshot.json dashboard/data/analytics_snapshot.json
fi
```

Also add `training/analytics_snapshot.json` to the `paths` trigger so push-triggered syncs pick it up.

### 4. Dashboard build: `build-data.mjs`

Add a copy step for `analytics_snapshot.json`:

```javascript
// 6. Copy analytics_snapshot.json
const snapshotSrc = path.join(DATA_DIR, "analytics_snapshot.json");
if (fs.existsSync(snapshotSrc)) {
  fs.copyFileSync(snapshotSrc, path.join(OUT_DIR, "analytics_snapshot.json"));
  console.log("✓ analytics_snapshot.json copied");
}
```

This makes the snapshot available to the dashboard for a future "Coach Insights" widget if desired.

### 5. SOUL.md boot sequence update

Update boot step 2 to include the snapshot:

```
1. Read this entire file (SOUL.md).
2. Read training/quest_log.md — your pre-computed quest dashboard.
3. Read training/analytics_snapshot.json — your match performance data.
4. Read training/state.md — your living memory.
5. You are now Coach Phelps. Greet Sky and pick up where the last session left off.
```

Add to the file roles table:

```
| analytics_snapshot.json | Generator (auto) | Coach (read-only) | Pre-computed match analytics |
```

### 6. SOUL.md coaching guidance

Add a new subsection under the coaching workflow (or a dedicated section) telling Coach how to use the data:

> **Using analytics data:**
> - **Pre-session:** Reference fatigue curve ("You fade after game 8 — pace yourself tonight"), current form ("4 session losing streak — let's break it"), and nemesis ("If you face Joe Chung, focus on placement over power").
> - **Post-session logging:** Compare tonight's result to trends ("2W-5L is consistent with your March slump — but your score diffs are getting closer").
> - **Weekly planning:** Use monthly trend to adjust training focus ("March ranked win rate is 25%, down from 43% in Feb — let's add more match-simulation drills").
> - **Do NOT** recite raw numbers unprompted. Weave insights naturally into coaching conversation.

## Data Flow Diagram

```
Strava → fetch_strava.py → history/*.json
                                ↓
                    generate_analytics_snapshot.py
                                ↓
                    training/analytics_snapshot.json
                        ↓               ↓
                   Coach Phelps     Dashboard (future)
                   (boot read)     (build-data.mjs)
```

## File Changes Summary

| File | Change |
|------|--------|
| `scripts/generate_analytics_snapshot.py` | **New** — core analytics computation |
| `scripts/run_sync_pipeline.py` | Add Step 6 call |
| `.github/workflows/sync.yml` | Add snapshot to paths trigger + copy step |
| `SOUL.md` | Boot sequence + file roles + coaching guidance |
| `ui/scripts/build-data.mjs` | Add snapshot copy step |

## Open Questions

1. **Category detection:** The dashboard uses `getTrainingCategory()` in TypeScript. The snapshot script needs equivalent Python logic. Should we extract the category rules to a shared config, or duplicate the logic in Python? (Recommendation: duplicate — it's ~20 lines and avoids cross-language dependency.)

2. **Description parsing:** Should the snapshot script import from `parse_match_description.py` directly, or reimplement? (Recommendation: import — it's already in `scripts/` and well-tested.)

3. **Snapshot freshness:** The snapshot regenerates on every pipeline run (workflow_dispatch). For manual Coach sessions between pipeline runs, the data could be stale by a few days. Acceptable? (Recommendation: yes — match data doesn't change between sessions.)
