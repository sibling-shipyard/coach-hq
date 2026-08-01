# 0015 — iOS app-launch state machine

- **Status:** Accepted · 2026-08-01 · Tech Lead
- **Area:** ios
- **Context:** Startup and signup routing is encoded across 10 booleans in `CoachHQApp`, `GitHubAuthManager`, and AppStorage. The `!isSessionReady` escape hatch and a three-callback onboarding cascade are where most signup bugs live; the `background(EmptyView().fullScreenCover)` double-cover hack is the most visible symptom.
- **Decision:** Introduce `AppRouter` that derives `AppState` from `GitHubAuthManager`'s published auth properties plus a single persisted `OnboardingPhase` enum. `CoachHQApp.body` becomes a plain `switch`; onboarding overlays stay inside `MainTabView`.
- **Why:** Derived state makes illegal combinations unrepresentable without accumulating events. The only mutable surface is `OnboardingPhase` (4 one-way transitions); auth state is read-only input, not accumulated output.
- **Rejected:** Full event-sourced machine (every auth event calls `advance()`) → one missed call permanently desyncs the router from auth state, which is already published by `GitHubAuthManager`. Top-level `AppState` cases for splash/HK-prompt/reveal → splash must render over pre-warmed tabs (`MainTabView.swift:99–110`); moving it breaks the Chat pre-warm and crossfade.
