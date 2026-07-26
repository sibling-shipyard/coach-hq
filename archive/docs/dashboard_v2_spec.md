# Dashboard v2 — Feature Spec

**Date:** 2026-03-25
**Context:** This document is a handoff from the data/coaching thread to the UI builder thread. It describes new features to integrate into the existing Coach Phelps HQ dashboard, along with data changes that need to be reflected.

## Data Updates

The underlying data has changed significantly since Dashboard v1 was built. These must be addressed first.

### 1. Rebuild `activities.json`

The bundled JSON needs to be regenerated from `training/history/*.json`.

| Before | After |
|--------|-------|
| 115 activities | 364 activities (full 2025 + 2026) |
| Old names ("Morning Weight Training", "Evening Badminton") | Enriched names (Foundation #16: Kickstart, Hit & Run #17: Ranked, Calisthenics #7: FL & Handstand, etc.) |
| No descriptions | Monday ranked sessions have formatted descriptions with match results |
| Generic sport types only | Activities now classifiable by naming convention into training categories |

### 2. Activity Classification

Activities can now be classified into training categories by parsing the `name` field. The naming convention is:

| Name Pattern | Category | Color Suggestion |
|---|---|---|
| `Foundation #K: Core` | Foundation (pre-2026 morning routine) | Light blue |
| `Foundation #K: Kickstart` | Foundation (current morning routine) | Light blue |
| `Calisthenics #K: [focus]` | Calisthenics | Slate blue (existing WEIGHTS color) |
| `Recovery #K` | Recovery | Teal |
| `Realign #K` | Realign (corrective mobility) | Lavender |
| `Hit & Run #K: Ranked` | Badminton — Ranked | Forest green (existing) |
| `Hit & Run #K: Friendly` | Badminton — Friendly | Lighter green |
| `League #K: vs [opponent]` | Badminton — League | Gold |
| `Badminton: Bangalore` | Badminton — Casual (travel) | Olive |
| `Badminton: Sat session` | Badminton — Casual | Olive |
| Rides (unchanged) | Ride | Amber (existing) |
| Runs, Hikes, Yoga (unchanged) | Other | Existing colors |

This classification replaces the generic "WEIGHTS" sport type with meaningful training categories. The `sport_type` field from Strava remains useful for top-level filtering, but the `name`-based classification is what the dashboard should use for training-specific views.

## New Features

### Feature 1: Weekly Summary Cards

**Replaces:** The current 4-card insights row (Weekly Volume, Sport Split, HR Trend, Week Comparison).

**New layout:** 4 category-specific cards showing this week's training at a glance.

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ FOUNDATION   │ │ CALISTHENICS │ │ BADMINTON    │ │ RIDES        │
│     3/5      │ │     1/2      │ │     2/2      │ │     4        │
│  ███████░░░  │ │  ██████░░░░  │ │  ██████████  │ │              │
│  M T W T F   │ │  T · · · ·   │ │  M · · T ·   │ │  15.2 km    │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

Each card contains:

**Foundation card:**
- Count vs weekly target (5 days/week)
- Progress bar
- Day-of-week dots showing which days completed (filled = done, hollow = missed, dim = future)

**Calisthenics card:**
- Count vs weekly target (2 sessions/week)
- Progress bar
- Which workout types completed this week (e.g., "Workout A ✓ Workout B ·")

**Badminton card:**
- Sessions this week (ranked + friendly)
- Win-loss record if available (from description parsing: "2W-5L")
- Which days played

**Rides card:**
- Total rides this week
- Total distance
- No target — informational only

**Weekly targets reference:**
- Foundation: 5/week (Mon-Fri mornings)
- Calisthenics: 2/week (Tue upper, Wed lower)
- Badminton: 2/week (Mon ranked, Thu friendly)
- Rides: no target

### Feature 2: Volume Trends by Category

**Enhances:** The existing Weekly Volume bar chart.

**Change:** Convert from single-color bars to stacked bars with segments per training category (Foundation, Calisthenics, Badminton, Rides, Other). Each segment uses the category color from the classification table above.

This shows training balance over time — whether the user is skewing too heavy on one type.

Keep the same 8-week window. Y-axis = hours.

### Feature 3: Streak Counters in Command Strip

**Location:** The black command strip at the top, after the 60-day challenge progress.

**Format:** Compact inline counters.

```
COACH PHELPS HQ  │  60-DAY: 2/20  DAY 8  13%  │  FOUNDATION: 7d  │  COLD: 3d  │
```

Streaks to track:
- **Foundation streak:** Consecutive days with a Foundation activity. Resets on a missed weekday (Mon-Fri). Weekends don't break the streak.
- **Cold shower streak:** Requires data from `training/state.md` or manual logging. May not be in Strava data — can be a placeholder initially.

Implementation note: Foundation streak can be computed from the activity data by checking for `Foundation #` activities on consecutive weekdays.

### Feature 4: Side Quest Tracker Panel

**Location:** Stats column (left sidebar), below "2026 So Far" section.

**Content:** Progress bars for each side quest from the 60-day challenge.

```
┌─────────────────────────────────┐
│ SIDE QUESTS                     │
│                                 │
│ Foundation    ████████░░  32/60 │
│ Cold Shower   ███░░░░░░░  12/60 │
│ Protein       █████░░░░░  20/40 │
│ Visualization ██░░░░░░░░   8/40 │
│ Reading       ████░░░░░░  15/60 │
│                                 │
│ Best streak: Foundation 12d     │
└─────────────────────────────────┘
```

Side quest definitions (from SOUL.md Section 5):
- **SQ1 (Foundation):** Morning routine completed. Target: daily (weekdays).
- **SQ2 (Cold Shower):** 1 min cold at end of shower. Target: daily.
- **SQ3 (Visualization):** 5 min visualization. Target: daily.
- **SQ4 (Reading):** The Inner Game of Tennis. Target: finish by challenge end.
- **SQ5 (Protein):** Hit 103-130g daily. Target: daily.

Note: Only SQ1 (Foundation) is directly trackable from Strava data. The others require manual logging or data from `training/state.md`. For v1, show Foundation as computed and the others as placeholder bars that can be manually updated via a config file or state.

### Feature 5: Enhanced Heatmap

**Enhances:** The existing Training Activity heatmap.

**Change:** Replace generic sport type colors (BADMINTON, WEIGHTS, RIDE) with training category colors from the classification table. This means a day with "Foundation #12: Kickstart" shows as light blue, not the generic WEIGHTS slate blue. A day with "Calisthenics #7: FL & Handstand" shows as slate blue.

For days with multiple activity types, use the highest-priority category color:
1. Badminton (green variants)
2. Calisthenics (slate blue)
3. Foundation (light blue)
4. Rides (amber)
5. Other

Or show multiple dots/segments per day if the heatmap supports it.

## Layout Integration

The overall layout evolves from:

```
BEFORE:
┌─────────────────────────────────────────────────┐
│ COMMAND STRIP                                    │
├─────────────────────────────────────────────────┤
│ [Weekly Vol] [Sport Split] [HR Trend] [WoW]     │
├─────────────────────────────────────────────────┤
│ HEATMAP                                          │
├────────┬────────────────────────────────────────┤
│ STATS  │ ACTIVITY FEED                           │
└────────┴────────────────────────────────────────┘
```

To:

```
AFTER:
┌─────────────────────────────────────────────────────────┐
│ COMMAND STRIP + streak counters (Foundation: 7d, Cold: 3d) │
├─────────────────────────────────────────────────────────┤
│ [Foundation 3/5] [Calisthenics 1/2] [Badminton 2/2] [Rides 4] │
├─────────────────────────────────────────────────────────┤
│ VOLUME TREND (stacked by category)  │  HR TREND         │
├─────────────────────────────────────────────────────────┤
│ HEATMAP (enhanced with category colors)                  │
├────────┬────────────────────────────────────────────────┤
│ STATS  │ ACTIVITY FEED                                   │
│ + Side │                                                 │
│ Quests │                                                 │
└────────┴────────────────────────────────────────────────┘
```

Key changes:
- Insights row → Weekly Summary Cards (category-specific)
- Sport Split pie chart → removed (redundant with heatmap + summary cards)
- Week-over-week comparison → can move to stats column or be a tooltip on the summary cards
- Volume chart → stacked by category
- Side Quest panel → added to stats column
- Streak counters → added to command strip

## Data Dependencies

All features can be built from the existing `activities.json` data (once rebuilt with 364 activities). The classification is purely name-based — no additional API calls needed.

The only data not in Strava:
- Cold shower completion (SQ2)
- Visualization completion (SQ3)
- Protein tracking (SQ5)
- Reading progress (SQ4)

These can be stubbed as placeholders or read from a separate `challenge_state.json` that gets manually updated.

## Design Notes

Follow the existing design system from `docs/DESIGN.md`:
- Neo-brutalist: no border-radius, 2px solid borders, hard edges
- Space Grotesk for labels, Space Mono for numbers
- Sport/category colors as defined above
- Progress bars: solid fill, no gradients, category color
- Streak counters: monospace, compact, same style as "DAY 8" in the challenge bar
