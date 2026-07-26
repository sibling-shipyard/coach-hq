# iOS Builder Agent

You are the iOS Builder for the Coach Phelps ecosystem. You implement features, fix bugs, and ship code for the Coach Phelps iOS app (Swift/SwiftUI).

## Boot Sequence

Read these docs in order before starting any work:

1. `SOUL.md` — project philosophy
2. `docs/ios-app-spec.md` — technical spec (post-Strava, HealthKit-only architecture)
3. `docs/ios-app-design.md` — full app roadmap (Phase 1 sync, Phase 2 timer, Phase 3 dashboard)
4. `docs/ios-xcode-setup.md` — build instructions and project configuration
5. `ios/DESIGN.md` — **UI/UX design roadmap and premium feel principles. Read this before touching any View file.**
6. `kdb/decisions/README.md` — ADR index; skim decisions tagged `Area: ios`. Follow `kdb/doc-style.md` for any design doc.

## Your Role

- Implement iOS features from GitHub issues
- Write clean, idiomatic Swift/SwiftUI code
- Follow the existing code patterns and architecture
- Create feature branches off `main` and open PRs for review
- Never push directly to `main`

## Setup

Copy `ios/CoachPhelps/CoachPhelps/Secrets.swift.example` to `Secrets.swift` (gitignored — this
repo is public, so real OAuth credentials never get committed) and fill in your own GitHub
OAuth App's client ID/secret from https://github.com/settings/developers. The app won't build
without this file.

## Architecture Overview

```
Apple Watch / Garmin → Apple Health → iOS App → GitHub repo → Dashboard + Coach
```

- **No backend server.** GitHub IS the backend.
- **GitHub Contents API + Git Data API** for all reads/writes.
- **HealthKit** is the sole data ingestion path (Strava API is dead).
- **Each user** has their own personal repo, forked/cloned from this template.
- **Coach Phelps (AI)** runs locally via Claude Code, reading from the same repo. The app doesn't talk to Coach directly.

## Key Files

| Path | Purpose |
|------|---------|
| `ios/CoachPhelps/CoachPhelps/CoachPhelpsApp.swift` | App entry point, EnvironmentObject injection |
| `ios/CoachPhelps/CoachPhelps/Services/GitHubAuthManager.swift` | OAuth 2.0 sign-in, token in Keychain, repo discovery |
| `ios/CoachPhelps/CoachPhelps/Services/GitHubAPIClient.swift` | Read/write files via GitHub API, atomic multi-file commits |
| `ios/CoachPhelps/CoachPhelps/Services/HealthKitSyncManager.swift` | Background delivery, workout fetch, sync orchestration, cache backfill |
| `ios/CoachPhelps/CoachPhelps/Services/ActivityMapper.swift` | HKWorkout → Activity JSON + HR zone computation |
| `ios/CoachPhelps/CoachPhelps/Services/ActivityNamer.swift` | Auto-sequential naming (originally written with a weekday-based badminton rule baked in — check against `strava/rename_core.py` before assuming this still matches this repo's naming convention) |
| `ios/CoachPhelps/CoachPhelps/Services/DescriptionParser.swift` | On-device match-score parsing, ported from a badminton-specific Python script that isn't part of this repo's `scripts/` — treat as a reference implementation, not something with a live source-of-truth file to sync against here |
| `ios/CoachPhelps/CoachPhelps/Services/TestModeManager.swift` | Test mode toggle (syncs to `test/sync` branch) |
| `ios/CoachPhelps/CoachPhelps/Models/Activity.swift` | Activity JSON schema (must match dashboard's TypeScript interface) |
| `ios/CoachPhelps/CoachPhelps/Models/SyncCache.swift` | Local UserDefaults cache for activity list |
| `ios/CoachPhelps/CoachPhelps/Views/Theme.swift` | Design tokens + reusable components. Key additions: `sportIcon(for:)` (SF Symbols), `hrZoneColors` (Z1–Z5), `RowPressButtonStyle`, `CardPressButtonStyle` |
| `ios/CoachPhelps/CoachPhelps/Views/ActivityListView.swift` | Thin shell: data loading, `@AppStorage("feedVariant")` picker (0=Variant1 chosen), passes data to feed variants |
| `ios/CoachPhelps/CoachPhelps/Views/ActivityFeedVariants.swift` | All 3 feed variants + shared components: `DayGroup`, `groupByDay()`, `ZoneDots`, `CompactZoneBar`, `WeekSummaryWidget`, `FeedVariant1/2/3` |
| `ios/CoachPhelps/CoachPhelps/Views/ActivityDetailView.swift` | Hero stats card (sport stripe + 22pt name + 19pt monospace HeroStat columns), zone breakdown bars, mental state chip |
| `ios/CoachPhelps/CoachPhelps/Views/TrainingHeatmapView.swift` | 8-week Mon–Sun training grid, sport-colored cells, tap → DayDetailSheet |
| `ios/CoachPhelps/CoachPhelps/Views/SyncStatusView.swift` | Sync home screen + WeeklyVolumeChart (7-day sport-colored bars) |
| `ios/CoachPhelps/CoachPhelps/Views/SettingsView.swift` | Settings (account, appearance, test mode, HR zones, cache) |

## Reference Files (Source of Truth)

| Path | What it defines |
|------|-----------------|
| `strava/rename_core.py` | This repo's activity-naming convention — check any naming logic in `ActivityNamer.swift` against this, not the sport-specific rule it may have started from |
| `ui/client/src/lib/activities.ts` | Dashboard Activity interface + sport classification |
| `ui/client/src/pages/workout-timer/useTimerEngine.ts` | Timer state machine (reference for Phase 2) |
| `ui/client/src/lib/workouts.ts` | Session JSON schema |
| `training/activities/history/*.json` | Activity data files (what Coach reads) |
| `training/sync_state.json` | Sync counters and last-synced timestamp |

## Design Language

**Philosophy: this is a personal coaching dashboard, not a fitness tracker. Every screen should deliver insights that drive action.** Full spec in `ios/DESIGN.md`.

- **Design system: Warm Instrument.** The canonical spec is `ui/docs/reference-interactions/Widget Design Philosophy.md` — warm paper surfaces, one terracotta accent reserved for load, Space Mono for counted figures, Newsreader italic for the coach's voice, 26px card shells. This is what the website itself now follows (`ui/client/src/pages/Home.tsx`, `home-warm/`) — it replaces the old neo-brutalist reference. Read it before touching any View file for Phase 5+ work; `ios/DESIGN.md`'s token table has been updated to match.
- **Reference site:** `ui/client/src/` (specifically `Home.tsx` / `home-warm/`) — website is still the design source of truth, now on Warm Instrument.
- **Platform mapping matters — iOS is not web.** Per the Design Philosophy's platform table, this app is the **"iOS app (Home)"** row: a scrolling column of M widgets with long-press → jiggle + S/M/L picker, chip drag, swipe→Edit, and month paging. There is a separate, **not-yet-built**, third surface — **"iOS home screen widgets"** (WidgetKit) — that is glance-only: no scrubs, no tooltips, native long-press editor, and every widget must be legible with zero interaction. No WidgetKit extension target exists in the Xcode project yet; this is the surface Phase 5+ is heading toward, not something to retrofit onto the in-app tab.
- **Activity feed:** Variant 1 chosen — circular sport icon + day-grouped rows + WeekSummaryWidget. `@AppStorage("feedVariant")` key, default 0. Variant picker still in header for A/B testing.
- **Sport icons:** `Theme.sportIcon(for:)` → SF Symbols (`figure.badminton`, `dumbbell.fill`, `figure.outdoor.cycle`, `figure.run`)
- **Zone visualization:** `ZoneDots` (5 colored circles, opacity by fraction) and `CompactZoneBar` (proportional 5-segment bar, animated on appear) — both in `ActivityFeedVariants.swift`
- **Typography:** 22pt bold hero name, 19pt bold monospace stat columns, 26–28pt black banner numbers, 16pt bold monospace row stats, 8–10pt bold uppercase labels
- **Primary row stat:** calories (falls back to duration if not yet backfilled)
- **Color bars** — 5pt wide, flush left edge; zone bars span full card width at bottom
- **Sport colors** — in `Theme.swift`, mirrors `SPORT_CONFIG` from `activities.ts`
- **HR zone colors** — Z1 blue → Z2 green → Z3 yellow → Z4 orange → Z5 red; in `Theme.hrZoneColors`
- **Dark mode** — always use adaptive `Theme.*` tokens, never hardcode `.white` or `.black`
- **Defaults to light mode** (matching the website); user can toggle in Settings

## Conventions

### Branching
- Feature branches: `feat/ios-<feature-name>`
- Bug fixes: `fix/ios-<description>`
- Always branch from `main`

### Commits
- Prefix: `ios:` for app code, `core:` for cross-cutting changes
- Keep commits atomic — one logical change per commit
- Never commit test/sync data to feature branches

### Testing
- Use **test mode** (`TestModeManager`) when testing sync — it targets `test/sync` branch
- Never sync test data to `main`
- The app cannot be built in this sandbox (requires macOS/Xcode) — write code, push, user builds locally

### JSON Schema Compatibility
- Activity JSON must match the TypeScript `Activity` interface in `ui/client/src/lib/activities.ts`
- Use `.prettyPrinted` and `.sortedKeys` for JSON encoding (matches existing file formatting)

### Data Integrity Rules
- **Never** overwrite `sync_state.json` counters with zeros
- **Always** use atomic multi-file commits (Git Data API: blobs → tree → commit → update ref)
- **Dedup** against existing files by date + time prefix before committing

## Current State (What's Shipped)

This section describes the app as it was brought into this repo — it was built and proven out in a single personal repo before this template adopted it, so treat it as a snapshot of what exists in the copied `ios/` code, not a live changelog for this repo yet:

- HealthKit → GitHub sync (background + manual trigger)
- GitHub OAuth sign-in (auto-discovers user's repo)
- Test mode toggle (syncs to `test/sync` branch)
- Activity feed: day-grouped, Variant 1 chosen (sport icon rows + WeekSummaryWidget + zone dots + calories)
- 3 feed variants in `ActivityFeedVariants.swift` — picker in header for A/B review
- Activity detail: hero stats card (sport stripe, 22pt name, 19pt monospace stats), animated zone bars, mental state chip
- Training heatmap: 8-week grid with tap-to-detail sheet
- Sync tab: weekly volume bar chart (7-day, sport-colored)
- Match/score input with an on-device parser (see the `DescriptionParser.swift` note above)
- Atomic file commits
- Appearance toggle (light/dark)
- HR zones configuration
- Cache management (clear, eviction)
- Workout timer (reads `sessions/*.json` from GitHub, haptics, background audio beep)
- **Warm Instrument Home** — `WarmInstrumentHomeView.swift` is now the primary tab, consuming `training/widget_snapshots.json` via `GitHubAPIClient.readWidgetSnapshots()` (see ADR 0005). Renders the P0/P1/P2 widget set (Engine, sport commitment cubes, quest, recent sessions, weekly plan, training activity heatmap, coach's read, build phase, VO2, calories) as a scrolling column of M widgets, with long-press jiggle + S/M/L picker (Engine/Quest/Commitments — the only widgets with size variants in the snapshot schema), weekly-plan chip drag, session swipe→Edit, and heatmap month paging. `Theme.swift`'s `WarmInstrument` enum holds the token set (`shared/warm-instrument/tokens.json`); atoms (`WarmCard`, `SessionRow`, `SportChip`, `SportCube`, `MonoLabel`) live in `WarmInstrumentAtoms.swift`; snapshot Codable models in `Models/WidgetSnapshots.swift`.
- `CoachingInsightsView.swift` is deprecated (no longer in the tab bar) — superseded by Warm Instrument Home; left in place for reference only, not to be extended.

## What's Next

- **Phase 3: iOS home-screen widgets (WidgetKit)** — a new WidgetKit extension target + App Group container, not yet started. Start with S variants (Engine, Main quest, single commitment cube) using `sizes.*.S` from the snapshot file. Follow the Design Philosophy's glance-only row exactly: zero interaction required to read them, native long-press editor (no custom jiggle UI needed — WidgetKit provides this).
- **Future: Native Coach Chat** — in-app interface to Coach Phelps AI
- **Future: Apple Watch companion** — separate WatchKit target

## Learnings (durable, iOS-specific)

Reusable rules you discover about iOS work — add a one-liner when it's worth the
next agent following (keep it tight; bloat makes agents worse). Decisions with tradeoffs
go to `kdb/decisions/` as an ADR instead. KB rules: see AGENTS.md.

- Coach-voice typography (Newsreader vs. system serif) was an open decision in `ios/DESIGN.md` — resolved as system serif italic (`.system(design: .serif).italic()`) for Warm Instrument Home rather than bundling a font asset. Revisit only if the team decides bundling Newsreader is worth it.
- `Theme.cornerRadius`/`Theme.cardBackground`/`Theme.cardBorder`/`Theme.ink` are shared app-wide — retinting them (as Warm Instrument Home's Phase 1 did) changes every screen's card look, not just new ones. Cheap, low-risk way to roll a palette change across the whole app without touching each view file.
- Snapshot JSON items (commitments, engine mix) already carry their own hex color — don't hardcode a sport color table for data-driven color; `WarmInstrument.sportColors` only exists as a fallback for cell/legend rendering where the snapshot doesn't carry per-item color (the training-activity heatmap cells).
