# 0007 — One golden dataset for all sample data

- **Status:** Accepted · 2026-07-28 · Tech Lead
- **Area:** cross-cutting
- **Context:** Fake data had grown in three unrelated places on web — gallery fixtures, a
  current-week fixture, and hardcoded consts inside the marketing Welcome page — and iOS had
  none at all, so previews and product screens had nothing real to show. Separately, most of
  the app (Home, Workouts, sport-analytics pages, Coach Chat) doesn't read pre-baked snapshots
  at all — it computes its own numbers from raw activities/challenge/sync data, and that
  computation (streaks, "this week" filters, current-month analytics) keys off the real
  wall-clock `new Date()`. A hand-typed fixture with frozen dates looks right the day it's
  written and goes stale every day after.
- **Decision:** `shared/golden-dataset/` has two layers:
  - **Static, committed** (`widget_snapshots.json`, `current_week.json`) — hand-authored,
    written in the real `WidgetSnapshotsFile`/`CurrentWeekContract` schemas
    (`ui/client/src/components/home-warm/snapshots.ts`, `currentWeek.fixture.ts`). Read by web
    through `ui/client/src/lib/goldenDataset.ts` for `/gallery` and `/welcome`, and by iOS via
    `GoldenDataset.swift` decoding through the existing `WidgetSnapshots.swift` models for
    SwiftUI previews. Fine to freeze because these consumers don't care what "today" is.
  - **Generated, gitignored** (`generate-repo-data.mjs` → `repo-data/*.json`) — the raw
    `RepoData` shape `ui/client/src/hooks/useRepoData.ts` expects (`activities`,
    `challenge_v2`, `workouts`, `sync_status`, `sleep_log`, `quest_history`, `current_week`).
    Every date is computed relative to `Date.now()` at generation time, wired into `ui`'s
    `predev`/`prebuild` so it regenerates automatically on every `npm run dev`/`npm run build`.
    Randomness (win/loss counts, HR noise, sleep hours) is seeded from today's calendar date,
    so anyone running dev on the same day gets the identical dataset. This layer replaces
    `ui/client/src/data/*.json` as `useRepoData.ts`'s dev-mode source — those files stay
    exclusively pipeline-managed per `AGENTS.md`, untouched.
  - Marketing copy is not data and stays in the web app (`welcomeCopy.ts`), not either layer.
- **Why:** Reusing the real schemas means zero new types on either platform, and it keeps the
  fake data honest — if a schema changes, the sample data fails to typecheck or decode instead
  of drifting quietly. Splitting static vs. generated matches how the two consumer groups
  actually differ: pre-baked-snapshot consumers don't care about real dates, computed-from-raw
  consumers require them, and faking that would mean either date-stale fixtures or fragile
  hand-maintained "current week" JSON.
- **Rejected:** Fixtures next to each component (what we had) — copies that drift
  independently. Generating the golden file from real athlete data — leaks private data into a
  public marketing page. A new sample-only schema — a second contract to keep in sync with
  ADR-0005's real one, for no gain. Hand-typing the raw layer's dates like the static layer —
  works the day it's written, breaks every day after as "today" moves past the fixture.
- **Realism, not just happy-path:** an early version of the generated layer produced perfectly
  clean data — daily activity with zero misses — which meant a bunch of real UI states could
  never be exercised locally: heatmap gaps, a foundation streak reset, a stalled milestone, a
  calisthenics week under floor, badminton head-to-head/"am I improving," running route/PB
  clustering, and a quest that hasn't started yet ("not applicable" empty state). The generator
  now deliberately produces all of these — a few multi-day blackout blocks (one excused, e.g.
  travel), occasional single-day misses, a stalled `handstand_free` milestone alongside a
  progressing `fl_single_leg`/`weighted_pullups` (with a flagged PR), a couple of thin
  calisthenics weeks, badminton descriptions in the real `Games: / W <score> w/ <partner> vs
  <opponent>` format with a recurring opponent pool, a consistent named running route for
  benchmark clustering, and a second quest (`cold-plunge`) that only started a few weeks ago.
  One state — the commitment cube's alarm/BELOW-floor styling — turned out to be gated on
  `dataMode !== "live"` in `warmHomeSnapshots.ts`, and `Home.tsx` always passes `"live"`; no
  fixture can make that render on `/`, since it's an app-level constraint, not a data gap. It
  already renders on `/gallery` via the static layer.
