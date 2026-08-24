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
- Sandbox still can't run Xcode, but pushing gets a real compile check: `.github/workflows/ios-build.yml` builds `CoachHQ`, `CoachHQ-Dev`, `CoachHQ-Staging`, and `CoachHQWidgetExtension` for the iOS Simulator on `macos-15` for every `ios/**` push/PR. It catches compile errors and runs `CoachHQTests` on the Prod scheme; no signing/device/HealthKit runtime coverage, so the user still verifies behaviour locally.

## Learnings

- Side-by-side flavors need unique bundle ID, App Group, and URL scheme; auth allowlists the scheme in signed state (#547)
