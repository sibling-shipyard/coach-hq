# GitHub Auth — how sign-in works (web + iOS, shared backend)

## Context

One shared backend, `ui/api/auth/`, handles GitHub sign-in for both the web dashboard and the
iOS app. There's a single entry point ("Log in with GitHub" on web, "Sign in with GitHub" on
iOS) - it looks the same whether the person is new or returning. First-time users (no
`coach-phelps` App installation yet) are walked through a two-step Setup wizard instead of
seeing a dead-end error page. Covers the same ground as [[strava-sync]] and [[ios-sync]] do for
their trigger paths - "if I press X, what changes."

This replaces an earlier two-button (Log in / Sign up) web-only flow and a completely separate
classic-OAuth iOS flow (embedded client secret, on-device token exchange - a real App Store
distribution blocker). Both are gone; this is what's there now.

## Why sign-up can't be fully automated

GitHub App user-to-server tokens cannot create repositories under a personal account - confirmed
live: `404 Not Found` on `POST /repos/{template}/generate`, `403 Resource not accessible by
integration` on `POST /user/repos`. This is a hard platform rule, not a config issue: Apps only
ever act on repos they're already installed on. Only a classic OAuth token/PAT with `repo` scope
can create a personal repo via API, and this system deliberately doesn't introduce one (keeps the
single-repo-access-only design the GitHub App was chosen for in the first place).

Every install of `coach-phelps` also grants access to exactly **one** repo, picked from GitHub's
own repo-picker on `/installations/new` - which only lists **existing** repos. So for a brand-new
user, the repo has to exist *before* that picker has anything to show.

Net result: two GitHub-native screens are unavoidable for a first-time user - creating the repo
from the `coach-skeleton` template, then installing the App on it. Everything else is automatic.
(`sibling-shipyard/coach-skeleton` had to be made **public** for this to work at all - a private
template is invisible to a brand-new account regardless of what kind of token it presents. Audited
first for secrets/PII before flipping visibility - clean, single commit, all placeholder data.)

## Overview

```mermaid
flowchart TD
    btn["Log in with GitHub<br/>(web button / iOS Sign in)"] --> start["/api/auth/start<br/>?platform=web|ios"]
    start --> authorize["GitHub /login/oauth/authorize"]
    authorize --> cb["/api/auth/callback"]
    cb -->|"installation found"| done["session ready"]
    cb -->|"no installation yet"| setup["Setup wizard<br/>pages/Setup.tsx or SetupView.swift"]
    setup -->|"1. create repo from template"| gen["github.com/new<br/>template_owner=sibling-shipyard"]
    setup -->|"2. continue to install"| installredirect["/api/auth/install-redirect<br/>?platform=web|ios"]
    installredirect --> installpage["GitHub /installations/new<br/>repo now exists, shows in picker"]
    installpage --> cb
    done -->|"web"| webdone["Set-Cookie session, redirect /"]
    done -->|"ios"| iosdone["coachhq://callback?token=&repo=&login="]
```

- The button always hits the plain `/login/oauth/authorize` sign-in endpoint - identical for new
  and returning users. It never routes straight into `/installations/new`; only `callback.ts`
  does that, and only when it discovers there's genuinely no installation yet.
- `callback.ts` branches its final response on a `platform` value (`web` or `ios`) that rides
  through the whole redirect chain inside the existing `coach_oauth_state` cookie payload
  (`{ state, codeVerifier, platform }`) - no new cookie, no new endpoint needed for that.

## Shared backend — `ui/api/auth/`

| File | Role |
|---|---|
| `start.ts` | The one entry point. Builds PKCE state, redirects to GitHub's authorize endpoint. Accepts `?platform=ios`. |
| `callback.ts` | Shared landing point. Token exchange, `GET /user`, installation lookup (`app_slug` + `account.login` match, per #30). Branches on platform - see below. |
| `install-redirect.ts` | Internal step, not linked from product UI directly - only the Setup wizard's "Continue to install" calls it. Same PKCE/state mechanics as `start.ts`, targets `/apps/coach-phelps/installations/new`. Accepts `?platform=ios`. |
| `me.ts` | Session read endpoint (web only - iOS has no session cookie to read). |
| `logout.ts` | Clears the session cookie. |
| `list-my-repos.ts` | Repo resolution/picker. Dual auth: session cookie (web) or `Authorization: Bearer <token>` with no cookie (iOS's fallback for the rare 0-or-2+-candidate case). |
| `_lib/session.ts` | JWE session cookie helpers (unchanged from before). |
| `_lib/pkce.ts` | PKCE verifier/challenge generation (unchanged from before). |
| `_lib/repo-resolution.ts` | **Single source of truth** for installation + owned-repo lookup - used by both `callback.ts` (iOS's inline resolution) and `list-my-repos.ts` (web's picker, iOS's fallback), so the ownership/marker-file rules can't drift between the two callers. |

### `callback.ts`'s platform branch

```mermaid
sequenceDiagram
    participant B as Browser / iOS session
    participant CB as callback.ts
    participant GH as GitHub API
    B->>CB: GET ?code=&state=
    CB->>CB: match state, exchange code for token
    CB->>GH: GET /user, GET /user/installations
    alt installation found
        CB->>CB: platform === "ios"?
        alt web
            CB->>B: Set-Cookie session (JWE), redirect /
        else ios
            CB->>CB: resolveOwnedRepos() - single candidate?
            CB->>B: redirect coachhq://callback?token=&login=[&repo=]
        end
    else no installation
        CB->>B: web: redirect /setup?login=<br/>ios: redirect coachhq://callback?needs_setup=1&login=
    end
```

- **Web** gets what it always got: a `Set-Cookie` session, redirect to `/`.
- **iOS** has no cookie jar shared with the API - it authenticates every subsequent request with
  `Authorization: Bearer <gh_token>` + `X-Coach-Repo: owner/repo` (`_lib/resolve-auth.ts`'s
  contract, also what `widget-snapshots.ts` and `GitHubAPIClient.swift`'s direct GitHub calls
  use). So instead of a cookie, the redirect carries the raw token, plus `repo` when
  `resolveOwnedRepos()` finds exactly one owned+marker-confirmed candidate - true for every
  install going forward, since installs are single-repo by design. If it's not exactly one
  (legacy multi-repo installs), the app falls back to calling `list-my-repos.ts` itself with the
  bearer token once it has one, running the same picker logic web's `Onboarding.tsx` uses.
- Error paths mirror this split too: web redirects to `/?auth_error=<type>` (`AuthError.tsx`
  renders it); iOS gets `coachhq://callback?error=<type>`.

## Web flow

- `WelcomePage.tsx` - one link, `/api/auth/start`. (The old separate `/api/auth-install` "Sign
  up" link and `LoginPage.tsx`/`pages/Login.tsx` route are gone - both were fully replaced.)
- `AuthPageHeader.tsx` - shared header (brand + a contextual "Cancel"/"Sign out" link) used by
  every screen below plus `RepoDataGate.tsx` - none of these used to have a way back to the
  product page mid-flow.
- `pages/Setup.tsx` - shown when `callback.ts` redirects to `/setup?login=<login>`. Two buttons:
  a `target=_blank` link to `github.com/new?template_owner=sibling-shipyard&template_name=coach-skeleton&owner=<login>&name=coach-<login>&visibility=private`
  (opens in a new tab, user clicks GitHub's own green "Create repository" button), and a link to
  `/api/auth/install-redirect`. Step 2's label notes it depends on step 1 finishing first, for
  whoever clicks out of order.
- `pages/Onboarding.tsx` - calls `list-my-repos.ts`, auto-selects on one candidate, renders a
  picker on 2+. The 0-candidate dead end (no recovery button at all) is fixed - "Try setup
  again" and "Sign out" both work now.
- `RepoDataGate.tsx` - gates `Home.tsx` (and other `useRepoData()` consumers) on load/error
  states. `error`/`notOnboarded`/`schemaUnsupported` all have working "Switch repo"/"Sign out"
  buttons now (used to be dead ends - this is what "deleted my test repo, dashboard got stuck
  with no way back" looked like before). A `401` from `repo-file.ts` specifically shows "Your
  GitHub access expired - sign in again" with a direct re-auth button, distinct from the
  generic error state.

## iOS flow

`Setup.tsx` is reimplemented **natively** as `SetupView.swift` rather than embedding the React
page. OAuth and install run in a **shared in-app WKWebView** (`WebAuthPresenter.shared` +
`InAppAuthWebView`) backed by `WebAuthBrowserStore` — one cookie jar for the whole flow
(Google federated login → GitHub → repo create → app install). `ASWebAuthenticationSession` and
Safari each use separate stores, so federated cookies did not carry across the old split flow.

- `CoachHQApp.swift` — presents `InAppAuthWebView` in a `.sheet` bound to
  `WebAuthPresenter.shared`. OAuth resumes on `coachhq://` callback; browse mode (repo create)
  dismisses manually while cookies persist for step 2.
- `GitHubAuthManager.swift` — `signIn()` and `continueToInstall()` call
  `WebAuthPresenter.start()` against `{dashboardBaseURL}/api/auth/start?platform=ios` and
  `/api/auth/install-redirect?platform=ios` respectively. `continueToInstall()` also passes
  `suggested_target_id` (GitHub user id) so install lands on the right account. Parses the
  `coachhq://callback` redirect (`handleCallback()`): `error=` throws, `needs_setup=1&login=`
  sets `pendingSetupLogin` (routes to `SetupView`), `token=&login=[&repo=]` saves the token to
  Keychain (`com.siblingshipyard.coachhq.github.token`, unchanged key) and sets `selectedRepo`
  when present. `repoFullName` normalizes `selectedRepo` whether it is already `owner/repo` or
  repo-name-only — fixes `X-Coach-Repo` and REST URLs on legacy paths.
- `SetupView.swift` — step 1 calls `WebAuthPresenter.presentBrowse()` with the same
  `github.com/new?template_owner=...` URL (shared cookies, no app switch). Step 2 calls
  `authManager.continueToInstall()`. Cancel signs out — used to be force-quit only.
- `resolveRepoIfNeeded()` — fallback for the rare not-exactly-one-candidate case; calls
  `list-my-repos.ts` with `Authorization: Bearer <token>`, no `X-Coach-Repo` (that's what's being
  resolved). No native picker UI for 2+ results — `selectedRepo` stays nil and
  `bootstrapSession()` routes back into `pendingSetupLogin` instead of a broken `MainTabView`.
- `CoachHQApp.swift` routing: `isAuthenticated && (selectedRepo != nil || !isSessionReady)` →
  `MainTabView` (the `!isSessionReady` half keeps cold-launch resolution from flashing to
  `SetupView`); else `pendingSetupLogin != nil` → `SetupView`; else `LoginView`.
- `CoachSetupState` / `CoachSetupBootstrap` — after setup completes, new athletes land on the
  **Chat** tab until first Coach intake is done (`UserDefaults` per repo). On upgrade,
  `MainTabView` loads chat history first; existing threads auto-mark setup complete so returning
  athletes still open Home.
- `fetchUser()`/`resolveRepoIfNeeded()` failures surface via `lastNetworkError`, shown inline on
  `LoginView`/`SetupView` — used to fail with only a console `print()`, no signal at all.
- `GitHubAuthManager`'s public surface (`isAuthenticated`, `isSessionReady`, `user`,
  `selectedRepo`, `loadToken()`, `signOut()`) is unchanged for callers — `GitHubAPIClient.swift`
  does now call `validToken()` (see Session mechanics) instead of `loadToken()` in a couple of
  places, for the refresh-token rotation below.

## Session mechanics — refresh-token rotation (ADR 0009)

`coach-phelps` has GitHub's "expire user authorization tokens" opted in - the real GitHub
access token embedded in every session dies at **8h** no matter what. That's not a cookie
setting we control; it's GitHub's own token lifetime. So "stay logged in until you log out"
isn't a bigger `Max-Age` - it's silently exchanging the `refresh_token` GitHub already hands
back (6 months, rotated on each use) for a new access token before the old one dies. See
`kdb/decisions/0009-refresh-token-sliding-session.md` for the full decision record.

- **Web**: `coach_session` cookie - JWE (encrypted, not just signed) via `jose`, key =
  `SESSION_SECRET`. Payload: `{ github_user_id, login, gh_token, refresh_token,
  gh_token_expires_at, installation_id, repo_full_name? }` - two clocks, deliberately separate:
  `gh_token_expires_at` (the real ~8h GitHub token lifetime) vs. the cookie's own JWE expiry
  (the sliding 180-day cap below).
  `ensureFreshSession()` (`_lib/session.ts`) is the **one place** every handler reads the
  session now (`repo-file.ts`, `list-my-repos.ts`, `me.ts`, `coach-chat.ts`, `trigger-sync.ts`,
  `resolve-auth.ts`'s cookie branch) - decrypts, and if `gh_token_expires_at` is within 5
  minutes of now, exchanges the refresh token for a new pair
  (`POST https://github.com/login/oauth/access_token`, `grant_type=refresh_token`) and
  re-issues the cookie with a renewed 180-day `Max-Age` (`SESSION_MAX_AGE_SEC`) - a sliding
  window roughly matching the refresh token's own 6-month GitHub-side validity, so anyone
  active within any 6-month stretch never sees a login screen again. If the refresh itself
  fails, `ensureFreshSession()` **falls back to the pre-refresh session** (old access token,
  cookie left as-is) rather than hard-failing - refreshing proactively 5 minutes before actual
  expiry means the old token is almost always still valid at that moment, and a failed refresh
  is just as likely two concurrent requests racing over the same single-use refresh token
  (GitHub rotates it on each use - one request wins, the other's exchange is rejected even
  though the session is fine) as it is a genuine revocation (issue #117). A *real* revocation
  surfaces on its own the next time the old token is actually used against GitHub -
  `repo-file.ts`'s direct 401/403 check (below) is what shows "your GitHub access was revoked
  or expired, sign in again," not the refresh layer guessing at it. iOS's `validToken()` has
  always worked this way (falls back to the old token on refresh failure); this brought web in
  line with it.
  `coach_oauth_state` - short-lived (10 min), carries `{ state, codeVerifier, platform }`
  across the GitHub redirect round trip, unchanged.
- **iOS**: no server-side session - stateless, same as before. Every API call presents
  `Authorization: Bearer <gh_token>` + `X-Coach-Repo: owner/repo`, verified by
  `_lib/resolve-auth.ts` (which itself calls `ensureFreshSession()` for the web-cookie half of
  its own dual auth). iOS can't do the refresh exchange itself - that needs `client_secret`
  server-side, exactly what the OAuth rewrite removed from the app - so it calls
  **`/api/auth/refresh`**, a new endpoint whose only job is the confidential half of the
  exchange. No cookie/bearer auth on that endpoint itself: possessing a valid, GitHub-issued
  `refresh_token` *is* the auth, same trust model as the initial sign-in exchange in
  `callback.ts`. `GitHubAuthManager.validToken()` calls it proactively (5-minute buffer, same
  as the web side) from `GitHubAPIClient`'s central retry choke point, and stores the rotated
  `refresh_token`/expiry in Keychain alongside the access token.

## Appendix — file reference

| Path | Role |
|---|---|
| `ui/client/src/components/welcome/WelcomePage.tsx` | Web "Log in with GitHub" entry point |
| `ui/client/src/components/login/AuthPageHeader.tsx` | Shared header (brand + Cancel/Sign out) |
| `ui/client/src/pages/Setup.tsx` | Web Setup wizard |
| `ui/client/src/pages/Onboarding.tsx` | Web repo picker (post-auth) |
| `ui/client/src/pages/AuthError.tsx` | Renders `auth_error` types |
| `ui/client/src/components/RepoDataGate.tsx` | Loading/error/not-onboarded/revoked states for `useRepoData()` pages |
| `ui/client/src/contexts/AuthContext.tsx` | Client-side auth state gate |
| `ui/api/auth/start.ts` | Sign-in entry point (both platforms) |
| `ui/api/auth/callback.ts` | Shared OAuth callback, platform branch |
| `ui/api/auth/install-redirect.ts` | Setup wizard step 2 |
| `ui/api/auth/refresh.ts` | iOS-only: confidential half of the refresh_token exchange |
| `ui/api/auth/me.ts` | Web session read endpoint |
| `ui/api/auth/logout.ts` | Clears web session cookie |
| `ui/api/auth/list-my-repos.ts` | Repo resolution/picker, dual auth |
| `ui/api/auth/_lib/session.ts` | Cookie helpers, JWE encrypt/decrypt, `ensureFreshSession()` |
| `ui/api/auth/_lib/pkce.ts` | PKCE verifier/challenge generation |
| `ui/api/auth/_lib/repo-resolution.ts` | Shared installation/repo lookup logic |
| `ui/api/auth/_lib/resolve-auth.ts` | Per-request auth for repo-scoped endpoints (cookie or Bearer+X-Coach-Repo) |
| `ui/api/repo-file.ts` | Reads `gen/aggregate.json`; 401 → revoked-access copy |
| `ui/api/widget-snapshots.ts` | Server-side widget snapshot generation, used by iOS |
| `ios/CoachHQ/CoachHQ/Services/GitHubAuthManager.swift` | iOS sign-in, Keychain, repo resolution, token refresh |
| `ios/CoachHQ/CoachHQ/Views/SetupView.swift` | iOS native Setup wizard |
| `ios/CoachHQ/CoachHQ/Views/LoginView.swift` | iOS sign-in screen |
| `ios/CoachHQ/CoachHQ/CoachHQApp.swift` | iOS auth-state routing |
| `ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift` | iOS direct GitHub Contents/Git Data API calls |
| `kdb/decisions/0009-refresh-token-sliding-session.md` | ADR for the refresh-token session design |
