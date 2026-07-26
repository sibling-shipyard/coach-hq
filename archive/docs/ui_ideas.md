# Training Dashboard — UI Ideas

**Status:** Draft for discussion
**Date:** 2026-03-25

## Overview

A personal training dashboard that visualizes all enriched Strava data. The data layer is ready — all activities are named, described, and structured in JSON files with match results, leaderboard ranks, and HR zones.

## Option A: Training Dashboard (Personal Overview)

A single-page app showing your full training picture at a glance.

### Features

- **Weekly view:** Foundation, Calisthenics, Badminton sessions laid out by day. Color-coded by type.
- **Challenge tracker:** Day counter, streak tracking, workout completion vs plan.
- **Calendar heatmap:** GitHub-style grid showing activity types by color. Instantly see training density and gaps.
- **Calisthenics progression:** FL hold times, handstand progress charted over weeks.
- **Volume trends:** Weekly hours by category (badminton, calisthenics, cycling, foundation).

## Option B: Match Analytics (Badminton-Focused)

Deep dive into eBadders and match data.

### Features

- **Win rate trend:** Session-by-session win % over time (chart).
- **Partner analysis:** Win rate by partner. Who do you win most with?
- **Opponent analysis:** Win rate vs specific opponents. Who gives you trouble?
- **Score distribution:** Close losses (19-21, 20-22) vs blowouts. Are you losing tight games?
- **Session rank history:** Rank trend from leaderboard data (7 data points in 2025, 1 in 2026).
- **League record:** Match history with opponents and results.

## Option C: Coach Interface

Presents what Coach Phelps would tell you.

### Features

- **Today's workout:** Prescribed session based on the weekly plan.
- **Weekly plan view:** Mon-Sun with completion status (done / skipped / modified).
- **Injury & recovery notes:** Current flags and modifications.
- **Next session recommendations:** Based on what you did this week.

## Recommendation

Start with **A + B combined** as a static web app (`web-static` scaffold). Reasons:

1. All data is in JSON files — no backend needed initially.
2. The most immediate value is visibility into your training patterns and badminton performance.
3. Coach interface (C) can be layered on later, potentially with LLM integration for dynamic recommendations.

## Technical Approach

- **Scaffold:** `web-static` (Vite + React + TypeScript + TailwindCSS)
- **Data source:** JSON files from `training/history/` and `training/ebadders_history.json`, bundled at build time or fetched from a static endpoint.
- **Charts:** Chart.js or Recharts for trends and distributions.
- **Calendar:** Custom heatmap component or `react-calendar-heatmap`.
- **Hosting:** Can be deployed to GitHub Pages from the same repo, or kept local.

## Open Questions

1. Should this be a separate repo or a `dashboard/` directory in coach-phelps?
2. Do you want it publicly accessible (GitHub Pages) or local-only?
3. Any specific metrics or views you care about most?
4. Should it auto-update when new activities are synced, or manual refresh?
