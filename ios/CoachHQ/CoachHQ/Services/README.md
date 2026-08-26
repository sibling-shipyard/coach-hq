# Services

25 files, no subfolders. This is the app's logic layer: everything between HealthKit/the
network and the Views. Grouped below by concern so you don't have to open all 25 to find your way
around.

## HealthKit sync → GitHub

The original v0.1 flow: read a workout from Health, shape it, dedupe it, write it to the repo.

| File | Purpose |
|---|---|
| `HealthKitSyncManager.swift` | Orchestrates the sync: reads `HKWorkout`s, drives the mapping/dedup/write pipeline. |
| `ActivityMapper.swift` | Maps `HKWorkout` to the `Activity` schema (sport type, source priority for same-activity dupes). |
| `ActivityNamer.swift` | Assigns sequential generic names per sport per calendar year, matching `migrate_activity_naming.py` / `engine/core/rename_core.py`. |
| `WorkoutDeduplicator.swift` | Dedup rules on a minimal `DedupCandidate` struct (kept `HKWorkout`-free so `ios/scripts/verify_workout_dedup.swift` can compile it standalone). |
| `DescriptionParser.swift` | Parses badminton match text pasted into the description field into a formatted description + `MatchSession` (ADR 0013). |
| `TestModeManager.swift` | Toggles sync target between `main` and `test/sync` so you can test without touching production data. |

## GitHub auth + API

| File | Purpose |
|---|---|
| `GitHubAuthManager.swift` | GitHub OAuth via PKCE; owns the signed-in account/repo. |
| `WebAuthPresenter.swift` | Presents the system web-auth session for sign-in. |
| `WebAuthBrowserStore.swift` | Backing store for the web-auth browser session. |
| `GitHubAPIClient.swift` | Reads/writes repo files via the Contents API — retries, ETag-caches reads, wraps errors with GitHub's message. |
| `UserFacingError.swift` | Turns thrown errors into athlete-friendly copy (raw detail only shown in Dev Mode). |

## Coach chat

| File | Purpose |
|---|---|
| `CoachChatAPIClient.swift` | Talks to the hosted coach-chat API. |
| `CoachMessageAPIClient.swift` | Fetches/sends individual coach messages. |
| `CoachChatLocalCache.swift` | Local cache of chat history so the thread survives relaunch/offline. |

## Workout timer

| File | Purpose |
|---|---|
| `WorkoutTimerEngine.swift` | The timer state machine — reads `sessions/*.json` and drives intervals/rest. |
| `BeepPlayer.swift` | Plays the interval/rest audio cues. |
| `WorkoutService.swift` | Fetches workout templates and today's sessions from the repo via `GitHubAPIClient`. |
| `BundledTemplates.swift` | Offline fallback templates bundled in the app; keep in sync with `user_data/activities/workout_plans/templates/*.json`. |

## HR analysis

| File | Purpose |
|---|---|
| `HRAnalysis.swift` | Computes HR stats/zones from a recorded stream. |
| `HRZoneStore.swift` | Persists an athlete's HR zone config. |
| `RibbonBuilder.swift` | Turns an HR stream into per-cell zone indices for the session ribbon view (pure, no SwiftUI, so it's directly testable). |

## Onboarding / app state

| File | Purpose |
|---|---|
| `AppRouter.swift` | Top-level app state machine (`bootstrapping` → `unauthenticated` → `needsSetup` → `active`) and onboarding phase tracking. |
| `CoachSetupState.swift` | Persists setup/onboarding progress across launches. |
| `OnboardingHints.swift` | Copy/state for the onboarding hint bubbles. |

## Widget bridging

| File | Purpose |
|---|---|
| `WidgetSnapshotStore.swift` | Writes the App Group snapshot the widget extension reads; scoped per signed-in account so a sign-out/switch can't leak another account's data. |

Auth screens (`InAppAuthWebView.swift`) and other widget/onboarding views live in `Views/`, not
here — this folder is logic, not UI, with `WebAuthPresenter`/`WebAuthBrowserStore` as the one
pair that's UI-adjacent because they own the system auth sheet.
