# Coach HQ iOS App

> The silent bridge between your body and your coach.

This is the native iOS client for the Coach Phelps system. It reads health data from Apple HealthKit and commits it directly to your GitHub repository — where Coach Phelps, the Netlify dashboard, and all analytics pipelines already live.

No backend. No third-party APIs. No subscriptions. Just your watch, your phone, and your repo.

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

1. Open `ios/CoachHQ/CoachHQ.xcodeproj` in Xcode
2. Set your development team (Signing & Capabilities)
3. Enable the **HealthKit** capability
4. Build and run on your device (not simulator — HealthKit requires a real device)
5. Sign in with GitHub when prompted
6. Grant HealthKit permissions
7. Done. Workouts will auto-sync.

## Project Structure

```
CoachHQ/
├── App/
│   └── CoachHQApp.swift              # Entry point
├── Models/
│   ├── Activity.swift                # Activity JSON schema (matches legacy Strava format)
│   └── SyncCache.swift               # Local cache of synced activities (UserDefaults)
├── Services/
│   ├── GitHubAuthManager.swift       # OAuth 2.0 sign-in + token management
│   ├── GitHubAPIClient.swift         # Read/write files via GitHub Contents API
│   ├── HealthKitSyncManager.swift    # HealthKit queries + background delivery
│   ├── ActivityMapper.swift          # HKWorkout → Activity conversion + HR zones
│   ├── ActivityNamer.swift           # Auto-sequential naming (e.g., "Calisthenics #30")
│   └── DescriptionParser.swift       # On-device badminton score parsing (port of parse_match_description.py)
├── Views/
│   ├── LoginView.swift               # GitHub OAuth sign-in screen
│   ├── MainTabView.swift             # Tab navigation (Home · Workouts · More)
│   ├── WarmInstrumentHomeView.swift  # Warm Instrument Home tab
│   ├── ActivityListView.swift        # Last-7-days synced activities (from Home)
│   ├── ActivityDetailView.swift      # Paste scores, live preview, save & sync
│   ├── WorkoutPlaceholderView.swift  # v0.2 timer placeholder
│   └── SettingsView.swift            # HR zones, account, repo selection
└── Info.plist                        # HealthKit + URL scheme config
```

## Roadmap

| Version | Feature |
|---------|---------|
| v0.1 | HealthKit sync → GitHub (this) |
| v0.2 | Native workout timer (reads `sessions/*.json`) |
| v0.3 | In-app Coach chat (LLM API integration) |

## Before You Ship

- [ ] Create a GitHub OAuth App at github.com/settings/developers
- [ ] Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` in `GitHubAuthManager.swift`
- [ ] Set the OAuth callback URL to `coachhq://callback`
- [ ] Enable HealthKit capability in Xcode project settings
- [ ] Test that `build-data.mjs` picks up `hk_` prefixed files correctly
