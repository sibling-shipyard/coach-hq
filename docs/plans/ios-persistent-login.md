# iOS persistent login

> Status: In progress · Owner: iOS Builder · Issue: #1201

## Context

An athlete is repeatedly logged out of the iOS app, possibly after TestFlight updates. A stored
session should survive cold launches and network failures, and end only when the athlete signs out
or deletes and reinstalls the app.

## Decision

1. **Observe the sign-out path.** Tag credential clearing and each `GitHubAuthManager.signOut`
   call with its reason. Capture local `AuthError` failures in Login and Setup. A clean install
   with no credentials is not a sign-out event.
2. **Keep valid credentials through failed bootstrap.** `GitHubAuthManager.bootstrapSession()`
   clears tokens today when both user and repo are unresolved, even if network requests failed.
   Only a confirmed credential rejection may clear them. A transient failure shows a retry state
   while the Keychain item remains intact.
3. **Detect reinstall from app-container state.** `CoachHQApp` currently uses a `UserDefaults`
   flag to decide when to wipe Keychain. Put the install marker in Application Support, which is
   removed on uninstall but survives a UserDefaults reset. On first launch after this change,
   migrate the existing `hasLaunched` flag into the marker without clearing current tokens.

A Keychain marker cannot identify a reinstall because Keychain items survive app deletion on the
same device. `CoachSetupState.swift` depends on that behavior too.

| PR | Milestone | Outcome | Final base | Files | Owner | Parallel with | Result |
|---|---|---|---|---|---|---|---|
| 1 | 1 | Sign-out reasons and auth-error captures | `main` | `ios/CoachHQ/CoachHQ/CoachHQApp.swift`, `Services/GitHubAuthManager.swift`, `Services/DiagnosticsManager.swift`, `Views/{LoginView,SetupView,SettingsView,SessionExpiredView}.swift`, auth tests | iOS Builder | — | Local gate green; iOS CI pending |
| 2 | 2–3 | Preserve tokens on network failure; reliable reinstall marker and retry UI | PR 1 | `ios/CoachHQ/CoachHQ/CoachHQApp.swift`, `Services/{GitHubAuthManager,AppRouter}.swift`, retry view, auth/router tests | iOS Builder | — | Pending |

## Done when

- Local tests distinguish network failure, rejected credentials, and no repo during bootstrap.
- Cold launch with network unavailable shows retry and preserves the token; retry can reach Home.
- A UserDefaults reset preserves sign-in; delete and reinstall returns to LoginView.
- The iOS build check is green. TestFlight confirms the behavior on a real device.

## Deferred

- `docs/eng-docs/env-vars.md` warning for `SESSION_SECRET` rotation is P2.
- Silent re-auth after explicit sign-out belongs to #239.
