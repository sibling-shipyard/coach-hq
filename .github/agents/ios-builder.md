# iOS Builder

**Thread purpose:** Native iOS app in `ios/` — Swift/SwiftUI features, fixes, and PRs.

**How we work:** `AGENTS.md` § How all agents work. iOS-specific: scope is `ios/` only; smallest diff; no bundled infra unless issue says so.

## Boot Sequence

On entry, read: `AGENTS.md`, this doc, `docs/eng-docs/ios-app-spec.md`, `ios/DESIGN.md` (before any View work), and `kdb/decisions/README.md` (skim `Area: ios`). Follow `kdb/doc-style.md` for any design doc.

## Scope

- **Own:** `ios/` only.
- **Don't touch:** `ui/`, `engine/core/`, `scripts/`, `user_data/`, `platform/skeleton-templates/`, `sessions/`, coaching memory files.
- **Setup:** copy `ios/CoachHQ/CoachHQ/Secrets.swift.example` → `Secrets.swift` (gitignored); set `dashboardBaseURL` only — app won't build without it.

## Gotchas

- Auth: GitHub App + PKCE via `ui/api/auth/` — `Secrets.swift` only sets `dashboardBaseURL`; don't duplicate OAuth config in Swift.
- Activity JSON must match `ui/client/src/lib/activities.ts`; encode with `.prettyPrinted` + `.sortedKeys`.
- Test sync via `TestModeManager` → `test/sync` branch only — never sync test data to `main`. Sandbox can't run Xcode; push and user builds locally.

## Learnings

One-liners only. Tradeoffs → ADR. KB rules → `AGENTS.md`.

- Coach-voice typography (Newsreader vs. system serif) was an open decision in `ios/DESIGN.md` — resolved as system serif italic (`.system(design: .serif).italic()`) for Warm Instrument Home rather than bundling a font asset. Revisit only if the team decides bundling Newsreader is worth it.
- `Theme.cornerRadius`/`Theme.cardBackground`/`Theme.cardBorder`/`Theme.ink` are shared app-wide — retinting them (as Warm Instrument Home's Phase 1 did) changes every screen's card look, not just new ones. Cheap, low-risk way to roll a palette change across the whole app without touching each view file.
- Snapshot JSON items (commitments, engine mix) already carry their own hex color — don't hardcode a sport color table for data-driven color; `WarmInstrument.sportColors` only exists as a fallback for cell/legend rendering where the snapshot doesn't carry per-item color (the training-activity heatmap cells).
- Home fetch must wait for `isSessionReady` — token in Keychain ≠ repo discovered. `GitHubAPIError.sessionNotReady` is silent (no toast); only surface `notAuthenticated` when there is genuinely no token.
- iOS Home depends on HQ `/api/widget-snapshots` being deployed and healthy. A 401 from that endpoint without auth headers is expected; 500 means a server-side bug (historically: Vercel not resolving TS `@/` path aliases — fixed by pre-build esbuild bundle in `ui/scripts/bundle-widget-snapshots-api.mjs`).
- After HK sync commits hist files, GitHub Actions regenerates `gen/aggregate.json` (~30s). A single immediate `WidgetSnapshotStore.refresh()` races the pipeline and caches stale Home data for 5 min — use `refreshAfterSync(since:)` to poll until `home.sync.timestamp` passes the commit time.
- Workouts tab TODAY badge follows coach session files for the local date (`user_data/.../sessions/YYYY-MM-DD_<id>.json`), not a hardcoded weekday→template map — coach can swap days (match web `Workouts.tsx`).
- `selectedRepo` may be `owner/repo` (list-my-repos) or short repo name (OAuth callback) — always use `GitHubAuthManager.repoFullName` for GitHub API URLs and `X-Coach-Repo`; never concatenate `user.login + selectedRepo` blindly.
- Workouts session fetch must wait for `isSessionReady` + `repoFullName` — fetching in `configure()` races bootstrap and fails silently, leaving no TODAY badge until pull-to-refresh.
- Same bootstrap race applies anywhere that hits GitHub on first paint — gate on `isSessionReady` + `repoFullName` (Activities backfill, Workouts sessions, Home snapshots).
- GitHub passkey 2FA fails silently in the in-app `WKWebView` login (TOTP/push/recovery code all work fine) — plain `WKWebView` can't surface native WebAuthn prompts without iOS 17.4+ delegate support + associated domains, which the app doesn't have. Tracked as #238, P2, not fixed.
