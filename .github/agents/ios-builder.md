# iOS Builder

**Thread purpose:** Native iOS app in `ios/` — Swift/SwiftUI features, fixes, and PRs.

**How we work:** `AGENTS.md` § How all agents work. iOS-specific: scope is `ios/` only; smallest diff; no bundled infra unless issue says so.

## Boot Sequence

On entry, read: `AGENTS.md`, this doc, `docs/eng-docs/ios-app-spec.md`, `ios/DESIGN.md` (before any View work), and `kdb/decisions/README.md` (skim `Area: ios`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `ios/` only.
- **Don't touch:** `ui/`, `engine/core/`, `scripts/`, `user_data/`, `platform/skeleton-templates/`, `sessions/`, coaching memory files.
- **Setup:** copy `ios/CoachHQ/CoachHQ/Secrets.swift.example` → `Secrets.swift` (gitignored); set `dashboardBaseURL` only — app won't build without it.

## Docs you own

Keep these current when `ios/` changes; rules in `docs/eng-docs/README.md`.

- `docs/eng-docs/ios-app-spec.md` — architecture + spec, the must-read.
- `docs/eng-docs/ios-sync.md` — HealthKit → athlete repo ingestion path.
- `docs/eng-docs/ios-xcode-setup.md` — local build/signing setup.

## Gotchas

- Auth: GitHub App + PKCE via `ui/api/auth/` — `Secrets.swift` only sets `dashboardBaseURL`; don't duplicate OAuth config in Swift.
- Activity JSON must match `ui/client/src/lib/activities.ts`; encode with `.prettyPrinted` + `.sortedKeys`.
- Test sync via `TestModeManager` → `test/sync` branch only — never sync test data to `main`.
- Sandbox still can't run Xcode, but pushing gets a real compile check: `.github/workflows/ios-build.yml` builds both `CoachHQ` and `CoachHQWidgetExtension` schemes for the iOS Simulator on `macos-15` for every `ios/**` push/PR. It catches compile errors only — no tests run (no XCTest target exists) and no signing/device/HealthKit runtime coverage, so the user still verifies behaviour locally.

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`. Cap ~15 entries — on overflow, promote the durable ones into the relevant `docs/eng-docs/` doc and drop the rest.

- Coach-voice typography (Newsreader vs. system serif) was an open decision in `ios/DESIGN.md` — resolved as system serif italic (`.system(design: .serif).italic()`) for Warm Instrument Home rather than bundling a font asset. Revisit only if the team decides bundling Newsreader is worth it.
- `Theme.cornerRadius`/`Theme.cardBackground`/`Theme.cardBorder`/`Theme.ink` are shared app-wide — retinting them (as Warm Instrument Home's Phase 1 did) changes every screen's card look, not just new ones. Cheap, low-risk way to roll a palette change across the whole app without touching each view file.
- Snapshot JSON items that carry their own hex `color` (`LoadMixSnapshot`, `QuestSideSnapshot`) must use it — never re-derive from a table. `WarmInstrument.sportColors` is the palette for snapshot types that only carry a `sport` id (`RecentSessionSnapshot`, `DoseRowSnapshot`, heatmap cells).
- Anything that hits GitHub on first paint must gate on `isSessionReady` (plus `repoFullName` where the URL needs it) — token in Keychain ≠ repo discovered, and fetching from `configure()` races bootstrap and fails silently. Applies to Home snapshots, Workouts sessions, and Activities backfill alike. `GitHubAPIError.sessionNotReady` is silent (no toast); only surface `notAuthenticated` when there is genuinely no token.
- iOS Home depends on HQ `/api/widget-snapshots` being deployed and healthy. A 401 from that endpoint without auth headers is expected; 500 means a server-side bug (historically: Vercel not resolving TS `@/` path aliases — fixed by pre-build esbuild bundle in `ui/scripts/bundle-widget-snapshots-api.mjs`).
- After HK sync commits hist files, GitHub Actions regenerates `gen/aggregate.json` (~30s). A single immediate `WidgetSnapshotStore.refresh()` races the pipeline and caches stale Home data for 5 min — use `refreshAfterSync(since:)` to poll until `home.sync.timestamp` passes the commit time.
- Workouts tab TODAY badge follows coach session files for the local date (`user_data/.../sessions/YYYY-MM-DD_<id>.json`), not a hardcoded weekday→template map — coach can swap days (match web `Workouts.tsx`).
- `selectedRepo` may be `owner/repo` (list-my-repos) or short repo name (OAuth callback) — always use `GitHubAuthManager.repoFullName` for GitHub API URLs and `X-Coach-Repo`; never concatenate `user.login + selectedRepo` blindly.
- `HKHealthStore.authorizationStatus(for:)` is unreliable for read-only types by design — Apple deliberately reports `.notDetermined` even after a real grant, so apps can't infer sensitive health status. Don't gate UI on it for read access; calling `requestAuthorization` again is the safe idempotent check (no-op if already decided).
- Returning-athlete re-onboarding (name prompt, HK prompt, reveal) on a new device/reinstall: `AppRouter.checkAccountSwitch`'s `stored == nil` branch now calls `CoachSetupState.isComplete(repoFullName:)` (fast, Keychain-backed, survives same-device reinstall) then falls back to the server `/api/coach-chat-profile-status` signal (`CoachChatAPIClient.profileStatus()`, same one `CoachSetupBootstrap.shouldOpenChatFirst` uses) — jumps `onboardingPhase` straight to `.complete` instead of replaying onboarding for an athlete who already finished First Session Protocol.
- Account-scoped data must be reset on **both** exits: `WorkoutService`/`WidgetSnapshotStore` are app-lifetime `@StateObject`s that `GitHubAuthManager.signOut()` doesn't own, so sign-out clears them from `CoachHQApp`'s `.onChange(of: router.authManager.isAuthenticated)`, and account *switch* clears them from `AppRouter.checkAccountSwitch()` (services bound in via `bindAccountScopedServices`, called once from `CoachHQApp.onAppear`). Persisted caches need the same scoping — `WidgetSnapshotStore` defers `loadCached()` to `configure(apiClient:)` (account unknown in `init()`) and tags the cache with `apiClient.repoFullName`, refusing a mismatch; otherwise a prior account's Home paints on cold launch until the real fetch lands ~5s later.
- "All activity" needs its own fetch path, never `SyncCache`: that cache only backfills 7 days and evicts anything past 30. `AllActivitiesListView` lists the full `user_data/activities/hist` dir once via `GitHubAPIClient.listFiles` (filenames encode date, so a lexical sort is enough to get newest-first) and paginates activity-body fetches in memory — nothing touches `SyncCache`, so nothing gets evicted.
