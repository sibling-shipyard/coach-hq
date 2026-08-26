# Coach HQ iOS App

> The silent bridge between your body and your coach.

This is the native iOS client for the Coach Phelps system. It reads health data from Apple
HealthKit and commits it directly to your GitHub repository — where Coach Phelps, the Netlify
dashboard, and all analytics pipelines already live. Beyond sync, it's grown into the full
in-app coaching experience: a native workout timer, in-app Coach chat, an onboarding/setup
flow, HR zone analysis, and home-screen widgets.

No backend of its own. No subscriptions. Just your watch, your phone, and your repo.

## Architecture

```
Apple Watch / Garmin → Apple Health → This App → GitHub Repo → Coach + Dashboard
```

## Requirements

- iOS 16.0+
- Xcode 15.0+
- An Apple Watch or Garmin watch syncing to Apple Health
- A `coach-<name>` GitHub repository (e.g. `coach-akash`), or legacy `coach-phelps` / `coach-phelps-template`

## Setup

1. Open `ios/CoachHQ/CoachHQ.xcodeproj` in Xcode (the project file lives in `ios/CoachHQ/`; the
   actual targets sit one level deeper, in `ios/CoachHQ/CoachHQ/`, `ios/CoachHQ/CoachHQTests/`,
   and `ios/CoachHQ/CoachHQWidget/`)
2. Copy `ios/CoachHQ/CoachHQ/Secrets.swift.example` to `Secrets.swift` and set `dashboardBaseURL`
   — the app won't build without it
3. Set your development team (Signing & Capabilities)
4. Enable the **HealthKit** capability
5. Build and run on your device (not simulator — HealthKit requires a real device)
6. Sign in with GitHub when prompted
7. Grant HealthKit permissions
8. Done. Workouts will auto-sync.

## Project Structure

Three targets: `CoachHQ` (the app), `CoachHQTests` (unit tests), `CoachHQWidget` (the WidgetKit
extension). The app target is organized by layer:

```
CoachHQ/
├── App/
│   └── CoachHQApp.swift              # Entry point
├── Models/                           # Activity/Workout/HR schema, chat models, widget snapshots
├── Services/                         # HealthKit sync, GitHub auth/API, Coach chat, HR analysis,
│                                      # workout timer engine, onboarding/setup state, dedup
├── Views/                            # Home, activity feed, Coach chat, setup/onboarding,
│                                      # workout timer, settings, training heatmap
└── Shared/                           # App Group bridge to the widget extension, golden dataset
```

Notable pieces beyond the original sync flow:

- **Coach chat** — `CoachChatView.swift`, `CoachChatAPIClient.swift`, `CoachMessageAPIClient.swift`,
  `CoachChatLocalCache.swift`: in-app chat with Coach Phelps, backed by the hosted coach-chat API.
- **Workout timer** — `WorkoutTimerEngine.swift`, `WorkoutTimerView.swift`, `WorkoutTimerWarm.swift`,
  `BeepPlayer.swift`, `WorkoutCompleteView.swift`: a native timer that reads `sessions/*.json`.
- **Onboarding/setup** — `SetupView.swift`, `PersonalizeView.swift`, `OnboardingRevealFlow.swift`,
  `CoachSetupState.swift`, `OnboardingHints.swift`.
- **HR analysis** — `HRAnalysis.swift`, `HRZoneStore.swift`, `HRZone.swift`, `HRStream.swift`.
- **Auth** — `GitHubAuthManager.swift`, `WebAuthPresenter.swift`, `WebAuthBrowserStore.swift`,
  `InAppAuthWebView.swift` (GitHub OAuth via PKCE, `ui/api/auth/`).

`CoachHQTests/` covers activity sync/vs-usual logic, GitHub auth, Coach message seeding, and
HR analysis/zone storage (6 test files). No UI tests.

## WidgetKit Extension

`CoachHQWidget/` is a home-screen/lock-screen widget extension, bundled via
`CoachHQWidgetBundle.swift`. It ships six glance widgets, each with S/M sizes where the data
supports it: Engine, Quest, Commitment, Training Activity, Build Phase, and VO2 Max. They read
from an App Group snapshot written by the main app (`AppGroupSnapshotBridge.swift`,
`WidgetSnapshotStore.swift`) — never live HealthKit or network calls from the widget process
itself. A widget with no snapshot yet (fresh install, App Group misconfigured) shows
`EmptyGlanceView` instead of a placeholder number. Preview/gallery rendering uses the golden
dataset (`GoldenDataset.swift`), same as the in-app cards.

## Roadmap

| Version | Feature |
|---------|---------|
| v0.1 | HealthKit sync → GitHub |
| v0.2 | Native workout timer (shipped) |
| v0.3 | In-app Coach chat (shipped) |
| v0.4 | Home-screen widgets via WidgetKit (shipped) |

## Before You Ship

- [ ] Create a GitHub OAuth App at github.com/settings/developers
- [ ] Set `dashboardBaseURL` in `Secrets.swift` (see Setup above)
- [ ] Set the OAuth callback URL to `coachhq://callback`
- [ ] Enable HealthKit capability in Xcode project settings
- [ ] Test that `build-data.mjs` picks up `hk_` prefixed files correctly
