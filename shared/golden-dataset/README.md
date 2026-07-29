# Golden dataset

One fake athlete, real schema. This is the sample data I show when there's no real athlete
data to show. It has two layers — a static pre-computed one and a generated raw one — because
they serve genuinely different consumers.

## Layer 1 — static, pre-computed (committed)

- `widget_snapshots.json` — a `WidgetSnapshotsFile`, same shape as the pipeline-generated
  `gen/widget_snapshots.json`. Schema owned by
  `ui/client/src/components/home-warm/snapshots.ts`.
- `current_week.json` — a `CurrentWeekContract`, same shape as a real current-week file.
  Schema owned by `ui/client/src/components/home-warm/currentWeek.fixture.ts`.

These are hand-typed with frozen dates and committed to git. That's fine here because their
consumers don't care what "today" is — they just render whatever numbers they're given:

- Web: `ui/client/src/lib/goldenDataset.ts` imports both through the `@golden` alias.
  - `/gallery` (`WidgetGallery.tsx`)
  - `/welcome` marketing page (`WelcomePage.tsx`)
- iOS: `GoldenDataset.swift` decodes `ios/CoachHQ/CoachHQ/Resources/golden_widget_snapshots.json`,
  synced from this file by `ios/scripts/sync-golden-dataset.mjs` (Xcode pre-build on
  `CoachHQWidgetExtension`; manual: `node ios/scripts/sync-golden-dataset.mjs`). Uses the
  existing `WidgetSnapshots.swift` models for SwiftUI `#Preview`s.

I reuse the real schemas on purpose (see ADR-0005 and ADR-0007): no new types on either
platform, and if a schema changes, this data fails to compile/decode instead of silently
drifting. `generated_at` in `widget_snapshots.json` must stay a frozen literal, not
`new Date()`, so builds stay deterministic.

## Layer 2 — generated, raw (gitignored)

- `generate-repo-data.mjs` writes `repo-data/activities.json`, `challenge_v2.json`,
  `workouts.json`, `sync_status.json`, `sleep_log.json`, `quest_history.json`, and
  `current_week.json` — the raw `RepoData` shape `ui/client/src/hooks/useRepoData.ts` expects.

This layer exists because most of the app — Home (`/`), Workouts, the sport-analytics pages,
Coach Chat — doesn't read pre-baked snapshots at all. It reads raw activities/challenge/sync
data and **computes** the numbers itself (`buildWarmHomeSnapshots`, `buildWarmHomeModel`, the
sport-analytics lens models). A lot of that computation keys off the real wall-clock
`new Date()` — training streaks, "this week" filters, "current month" analytics — so a
hand-typed fixture with frozen dates would look right the day it's written and go stale every
day after. `generate-repo-data.mjs` builds every date relative to whenever it runs, so it has
to actually be **regenerated**, not just read, each time you want fresh local data.

It's wired into `ui`'s `predev`/`prebuild` npm scripts, so it runs automatically before Vite
starts — `npm run dev` always gets a same-day-fresh fixture, no manual step. Output goes to
`repo-data/` (gitignored, same treatment as `ui/client/src/data/*.json`, which this replaces
as `useRepoData.ts`'s dev-mode data source — see that file's own header comment for why
`ui/client/src/data/*` itself is untouched: it's exclusively pipeline-managed per `AGENTS.md`).

Known tradeoff: because `repo-data/` regenerates fresh on every `npm run dev`, a bookmarked
local URL like `/workouts/:id` won't point at the same session across days. That's fine for a
dev-only fixture — don't try to pin IDs across regenerations.

## Changing a value

Layer 1: if you change a number, check `/gallery`, `/welcome`, and iOS previews all still read
sensibly — a change here is instantly visible on all three at once.

Layer 2: edit the generator, not the output — anything written directly into `repo-data/` is
overwritten on the next `npm run dev`.

This is fake data. It must never be shown to a signed-in athlete as if it were their own.
