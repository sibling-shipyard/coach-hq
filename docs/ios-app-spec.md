# Coach Phelps iOS App: Architecture & Spec (Post-Strava)

## Overview
The Coach Phelps iOS app is a native Swift/SwiftUI client that acts as a bridge between Apple HealthKit and the user's personal GitHub repository. 

Due to Strava deprecating free API access, this app replaces the legacy Strava-dependent sync pipeline entirely. It enables true multi-user support (e.g., Sky and his brother) without requiring a centralized backend, database, or third-party API dependencies.

The app is "dumb" by design: it reads from and writes to GitHub. The AI Coach (running via Manus/Claude) and the Netlify dashboard remain unchanged, continuing to use the GitHub repo as their single source of truth.

## Core Architecture: "GitHub as Backend"

```text
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│  iOS App    │◄──read──►│   GitHub     │◄──read──►│  Netlify    │
│ (HealthKit) │──write──►│   Repo       │◄──write──│  Dashboard  │
└─────────────┘         └──────────────┘         └─────────────┘
                              ▲
                              │ read/write
                              ▼
                        ┌──────────────┐
                        │ Coach Phelps │
                        │ (AI session) │
                        └──────────────┘
```

- **No Backend:** The app uses the GitHub REST API (Contents API) to read and commit files directly to the user's `coach-phelps-template` clone.
- **Authentication:** Users authenticate via "Sign in with GitHub" (OAuth 2.0). The resulting access token is stored securely in the iOS Keychain.
- **Multi-User:** The app automatically discovers the user's `coach-phelps` or `coach-phelps-template` repository upon login, or presents a picker if multiple candidates exist.

## Phase 1 (v0.1): HealthKit Sync Engine (The Strava Replacement)

The primary goal of v0.1 is to establish HealthKit as the sole ingestion path for workout data. Historical Strava data in `training/activities/history/` is preserved as-is.

### HealthKit Integration
- **Data Scope:** Workouts (type, duration, calories, HR), continuous heart rate, resting heart rate, sleep, steps, HRV, and VO2max.
- **Sync Trigger:** The app registers for HealthKit Background Delivery. When a workout completes (via Apple Watch or Garmin Connect syncing to Apple Health), iOS wakes the app to process and commit the data immediately. Manual sync is also available via a pull-to-refresh UI.
- **Data Mapping:** A `HealthKitToActivity` mapper converts HealthKit `HKWorkout` objects into the exact JSON schema currently expected by the dashboard and coach.

### Naming & Enrichment (Option C Architecture)
The iOS app owns naming and enrichment at commit time to ensure a single, clean commit per activity.
- **Auto-Naming:** Before committing, the app reads the latest activities in `training/activities/history/` to find the highest sequence number for a given category (e.g., `Calisthenics #29`). It increments the counter and assigns the new name (`Calisthenics #30`).
- **HR Zones:** The app computes time-in-zone distribution locally based on HR zone boundaries configured in the app settings.
- **Fallback:** The legacy Python rename script remains in the repo as a validator/migration tool, but is not part of the active daily pipeline.

### File Naming
- **Prefix:** HealthKit-sourced files will use the `hk_` prefix (e.g., `hk_2026-06-26_calisthenics_31.json`) to distinguish them from legacy Strava files.

### Badminton Score Input
Instead of typing scores into Strava descriptions, users will input them directly in the app.
- Upon detecting a new Badminton workout, the app prompts the user: "Badminton session detected — add scores?"
- The user pastes scores in the exact same text format used previously (e.g., `21-15, 21-18`).
- The app appends this text to the `description` field of the activity JSON before committing.
- Downstream parsing logic (`parse_descriptions.py`) remains completely unchanged.

## Phase 2 (v0.2): Native Workout Timer

The app will replace the web-based workout timer with a native SwiftUI implementation.

### Features
- Reads `sessions/*.json` directly from GitHub to load today's prescribed workout.
- Retains all existing timer physics (prep countdowns, phase transitions, rest hierarchy).
- Native audio cues and haptics for phase transitions.
- Supports background execution (timer continues while screen is locked).

## Phase 3 (v0.3+): Future Considerations

- **In-App Coach Chat:** Potential integration of LLM APIs (OpenAI/Anthropic) to allow direct conversation with Coach Phelps within the app, bypassing the need for Manus/Claude web interfaces. Users would provide their own API keys.
- **Dashboard Port:** Migrating the Netlify web dashboard widgets into native SwiftUI views for a unified experience.

## Tech Stack
- **Language:** Swift
- **UI Framework:** SwiftUI
- **Health Data:** HealthKit
- **Networking:** `URLSession` for GitHub REST API
- **Storage:** Keychain for PATs, `UserDefaults` or `AppStorage` for app settings

## Setup Flow for New Users
1. Clone `coach-phelps-template` on GitHub.
2. Install the iOS app (via Xcode or TestFlight).
3. Tap "Sign in with GitHub" to authenticate and grant repository access.
4. Select the correct repository (auto-selected if named `coach-phelps` or `coach-phelps-template`).
5. Configure personal HR zones in the app settings.
6. Grant HealthKit permissions.
7. (Optional) If using a Garmin watch, enable Apple Health sync in the Garmin Connect app.
