# Coach HQ iOS App: Architecture & Spec (Post-Strava)

> Status: Current · Owner: iOS Builder · Verified: 2026-08-18

## Overview
The Coach HQ iOS app is a native Swift/SwiftUI client that acts as a bridge between Apple HealthKit and the user's personal GitHub repository. 

Due to Strava deprecating free API access, this app replaces the legacy Strava-dependent sync pipeline entirely. It enables true multi-user support (e.g., Sky and his brother) without requiring a centralized backend, database, or third-party API dependencies.

The app is "dumb" by design: it reads from and writes to GitHub. The AI Coach (running via Manus/Claude) and the Netlify dashboard remain unchanged, continuing to use the GitHub repo as their single source of truth.

## Identity & Design Philosophy

The app is a **silent, fast, native iOS utility** — the on-device executor for Coach Phelps (the AI
coach), not a second place the coach lives. It provides the native sensors, timers, and data
ingestion that make the system seamless, and nothing else. Strict design boundaries:

- **Silent Utility:** No push notifications, no chat interface, no AI personality inside the sync/timer surfaces. The app moves data and runs timers; coaching conversation happens in coach-chat.
- **Native Aesthetic:** Built entirely in SwiftUI using system colors, SF Symbols, and standard iOS typography. Fully supports Light and Dark mode without custom theming.
- **Offline-First:** GitHub is the ultimate source of truth, but the app caches data locally so it opens instantly and works in the gym with poor connectivity.
- **GitHub as Backend:** No traditional backend or database of its own — it authenticates via GitHub and reads/writes directly to the athlete's repo.

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

- **No Backend for activity data:** The app uses the GitHub REST API (Contents API) to read and commit files directly to the user's `coach-<login>` repo (forked from `coach-skeleton`).
- **Authentication:** "Continue with GitHub" goes through the shared `coach-phelps-hq` GitHub App + PKCE flow entirely server-side (`ui/api/auth/`) - the same mechanism the web dashboard uses, no client secret embedded in the app. The resulting access token is stored securely in the iOS Keychain. See [`github-auth.md`](github-auth.md) and `.github/agents/ios-builder.md`'s Architecture Overview.
- **Sign-in surface — plain `WKWebView`, and passkey 2FA will never work in it.** Login runs in an
  in-app `WKWebView` (`WebAuthPresenter.swift`, `WebAuthBrowserStore.swift`, `InAppAuthWebView.swift`),
  chosen over `ASWebAuthenticationSession`/`SFSafariViewController` so the OAuth flow shares a cookie
  jar with GitHub browse-mode pages. Consequence: choosing a **passkey** for GitHub 2FA fails silently
  — WebAuthn needs the OS to intercept `navigator.credentials.get()`, which `WKWebView` only does with
  the restricted `com.apple.developer.web-browser` entitlement (Apple grants it to browser apps only)
  *and* a `webcredentials` entry in `github.com`'s association file (not ours to edit). Both are hard
  external gates, not implementation gaps — issue #238 investigated and closed on this. TOTP, GitHub
  Mobile push, and recovery codes are plain form submits and all work; they are the supported path.
  Switching this one flow to `ASWebAuthenticationSession` would enable passkeys at the cost of the
  shared cookie jar — a deliberate trade to reopen only if passkey support is wanted badly enough.
- **Multi-User:** A first-time user is walked through creating their repo from the `coach-skeleton` template and installing the App on it (`SetupView.swift`); a returning user's repo resolves automatically via the same ownership + marker-file check the web dashboard uses.

## Phase 1 (v0.1): HealthKit Sync Engine (The Strava Replacement)

The primary goal of v0.1 is to establish HealthKit as the sole ingestion path for workout data. Historical Strava data in `user_data/activities/hist/` is preserved as-is.

### HealthKit Integration
- **Data Scope:** Workouts (type, duration, calories, HR), continuous heart rate, resting heart rate, sleep, steps, HRV, and VO2max.
- **Sync Trigger:** The app registers for HealthKit Background Delivery. When a workout completes (via Apple Watch or Garmin Connect syncing to Apple Health), iOS wakes the app to process and commit the data immediately. Manual sync is also available via a pull-to-refresh UI.
- **Data Mapping:** A `HealthKitToActivity` mapper converts HealthKit `HKWorkout` objects into the exact JSON schema currently expected by the dashboard and coach.

### Naming & Enrichment (Option C Architecture)
The iOS app owns naming and enrichment at commit time to ensure a single, clean commit per activity.
- **Auto-Naming:** Before committing, the app reads the latest activities in `user_data/activities/hist/` to find the highest sequence number for a given category (e.g., `Calisthenics #29`). It increments the counter and assigns the new name (`Calisthenics #30`).
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

## Client runtime rules

Rules about app state and first paint. Breaking one fails silently, not loudly.
(Widget-snapshot fetch/refresh rules live in [`ios-sync.md`](ios-sync.md).)

- **Gate every first-paint GitHub call on `isSessionReady`** (plus `repoFullName` where the URL
  needs it). A token in Keychain is not a discovered repo, and fetching from `configure()` races
  bootstrap and fails silently. Applies to Home snapshots, Workouts sessions, and Activities
  backfill alike. `GitHubAPIError.sessionNotReady` is silent — no toast; only surface
  `notAuthenticated` when there is genuinely no token.
- **Workouts tab TODAY badge follows coach session files** for the local date
  (`sessions/YYYY-MM-DD_<id>.json` in the athlete repo), never a hardcoded weekday→template map —
  coach can swap days. Matches web `ui/client/src/pages/Workouts.tsx`.
- **Returning athlete on a new device or reinstall must not replay onboarding.**
  `AppRouter.checkAccountSwitch`'s `stored == nil` branch calls `CoachSetupState.isComplete(repoFullName:)`
  (fast, Keychain-backed, survives same-device reinstall), then falls back to the server signal
  `CoachChatAPIClient.profileStatus()` (`/api/coach-chat-profile-status`, the same one
  `CoachSetupBootstrap.shouldOpenChatFirst` uses). On either yes it jumps `onboardingPhase`
  straight to `.complete`.
- **Account-scoped data must be reset on _both_ exits.** `WorkoutService` and `WidgetSnapshotStore`
  are app-lifetime `@StateObject`s that `GitHubAuthManager.signOut()` does not own: sign-out clears
  them from `CoachHQApp`'s `.onChange(of: router.authManager.isAuthenticated)`, and account *switch*
  clears them from `AppRouter.checkAccountSwitch()` (services bound in via
  `bindAccountScopedServices`, called once from `CoachHQApp.onAppear`). Persisted caches need the
  same scoping — `WidgetSnapshotStore` defers `loadCached()` to `configure(apiClient:)` (the account
  is unknown in `init()`) and tags the cache with `apiClient.repoFullName`, refusing a mismatch.
  Otherwise a prior account's Home paints on cold launch until the real fetch lands ~5s later.

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
