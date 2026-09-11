# iOS Builder

**Thread purpose:** Native iOS app in `ios/` — Swift/SwiftUI features, fixes, and PRs.

**How we work:** `AGENTS.md` § How all agents work. ADR tag: `Area: ios`. Extra boot reads — both **conditional; skip by default.** `docs/eng-docs/ios-app-spec.md` — read when the task touches architecture, HealthKit/sync, signing/setup, or the spec itself. `ios/DESIGN.md` — read before any View / UI / visual work. iOS-specific: scope is `ios/` only; smallest diff; no bundled infra unless issue says so.

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
- Xcode runs here — check before assuming it does not. `xcodebuild -version` and
  `xcrun simctl list devices available` say what is installed; the iPhone 17 Pro / iOS 26.5 simulator
  `ios-build.yml` pins is usually present. Run the suite locally first: it takes seconds against a
  10-minute CI round-trip. Redirect and grep, never pipe a build into context:
  `xcodebuild test ... > /tmp/build.log 2>&1; grep -E "error:|Executed [0-9]+ test|\*\* TEST" /tmp/build.log`
- GitHub's `iOS Build` check is still authoritative: it builds both schemes and runs `CoachHQTests`
  on `macos-26`. Signing, device, and HealthKit behaviour still need user verification.

## Learnings

- Never fabricate a local stub thread under a REAL server thread id (`route.isPersistedThreadSeed`,
  a persisted `t-<epoch>` seed) when the turn-commit protocol sends the client's local `messages`
  back to the server for that id — the server does a full replace (`mergeThreadToFront` in
  `chatThreads.ts`), not an append, so a truncated stub silently discards the real thread's
  history/attachments on the next reply. Only a seed with no server record (`local-proactive-<id>`)
  may be materialized locally — see `CoachChatView.swift`'s `openRequestedProactiveRoute`.
