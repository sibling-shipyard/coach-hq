# 0030 — Signup is iOS-only, and the athlete creates the repo themselves

- **Status:** Accepted · 2026-08-25 · Tech Lead
- **Area:** cross-cutting (web auth, iOS setup, onboarding docs)
- **Context:** The scaling plan assumed a web sign-up that creates the athlete's repo for them:
  give the GitHub App `Administration` permission, call the API, done. That was written before
  anyone tried it. Two things turned out to be true instead. GitHub App tokens **cannot** create a
  repo on a personal account — confirmed by 404/403 on `/repos/{template}/generate` and
  `/user/repos` (`ui/api/auth/[...action].ts`, `docs/eng-docs/github-auth.md`). And a new athlete's
  first sync pulls a year of Apple Health history (`HealthKitSyncManager.swift`, `since = -365
  days`), which only an app on the phone can read. Nats and Prateek both signed up on their own
  through the iOS app in August 2026, so the flow is proven by use, not by plan.
- **Decision:** Signing up happens in the iOS app only. `SetupView.swift` checks whether
  `coach-<login>` exists and whether the App is installed on it, and sends the athlete to GitHub's
  own prefilled "create from template" page for the repo. The athlete creates it; we never do. The
  web dashboard is sign-in only — a GitHub account with no install gets a "set up on iOS first"
  message. There is no web sign-up path to build.
- **Why:** The year of Health history is the athlete's starting point, and a browser cannot read
  it. Even if the App could create repos, a web signup would produce an athlete with no history
  and a coach with nothing to say. The repo step being GitHub-native is a bonus, not a workaround:
  the athlete sees exactly what is being created on their own account.
- **Rejected:** Give the App `Administration` permission and create the repo server-side → the API
  refuses this on personal accounts; the earlier plan assumed otherwise and was never tested. Add
  a web sign-up wizard for people without an iPhone → they would land with an empty history, which
  is a worse product, not a smaller one; revisit only if a non-Apple history source ever exists.

<!-- Write in plain English — short words, no jargon. Someone outside the team
     should understand it. Keep each field to a line or two. -->
