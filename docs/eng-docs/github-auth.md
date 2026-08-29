# GitHub Auth — how sign-in works (web + iOS, shared backend)

> Status: Current · Owner: UI Expert · Verified: 2026-08-29

## Context

One shared backend, `ui/api/auth/`, handles GitHub sign-in for both the web dashboard and the
iOS app. Repo creation and first-time setup moved to **iOS-only** (#164) — it needs a year of
Apple Health data only the iOS app can pull, and iOS already had its own native setup wizard
(`SetupView.swift`). Web is now **login-only**: an existing user signs in, done. A GitHub
account with no `coach-phelps` App install yet gets a plain "set up on iOS first" message
instead of a repo-creation UI.

## Flow

```mermaid
flowchart TD
    btn["Log in with GitHub<br/>(web button / iOS Sign in)"] --> start["/api/auth/start<br/>?platform=web|ios"]
    start --> authorize["GitHub /login/oauth/authorize"]
    authorize --> cb["/api/auth/callback"]
    cb -->|"installation found"| done["session ready"]
    cb -->|"no installation, web"| authErr["AuthError: needs_ios_setup"]
    cb -->|"no installation, ios"| iossetup["SetupView.swift<br/>(native, unaffected)"]
    done -->|"web, popup"| popupdone["/auth/popup-complete<br/>postMessage + close()"]
    done -->|"web, full nav"| webdone["Set-Cookie session, redirect /"]
    done -->|"ios"| iosdone["coachhq://callback?token=&refresh_token=&repo=&login="]
    cb -->|"2+ owned repos"| blocked["multiple_repos_granted<br/>blocking message, no picker (ADR 0019)"]
```

- Single entry point (`/api/auth/start`) for both new and returning users — identical whether
  the person is new or returning; the callback handler is what branches.
- The callback handler branches on `platform` (`web`/`ios`), carried in an HMAC-signed `state`
  URL param GitHub echoes back verbatim — not a cookie. A `coach_oauth_state` cookie was tried
  first but WKWebView (iOS's in-app browser) silently drops `Set-Cookie` on redirects, so the
  whole state payload (`codeVerifier`, `platform`, `popup`, `iat`) travels signed in the URL
  instead; see `_lib/pkce.ts`'s `signOAuthState`/`verifyOAuthState`. `popup` is a third flag web
  sets when `GitHubAuthButton` opened the flow via `window.open()` instead of a full nav — every
  terminal redirect then goes to `/auth/popup-complete` instead of `/` or `/?auth_error=`.
- **iOS** still can't provision a repo via API (GitHub App tokens can't create personal repos —
  confirmed 404/403 on `/repos/{template}/generate` and `/user/repos`), so `SetupView.swift`
  still walks a first-timer through creating the repo from `sibling-shipyard/coach-skeleton`
  then installing the App — unchanged by #164, out of scope for web.
- **One repo per account, enforced, no picker (ADR 0019).** GitHub's own install flow can't
  restrict an account to granting exactly one repo, so an account can resolve 2+ owned,
  marker-matched repos. When that happens, both platforms block and tell the athlete to remove
  access to the extra repos at `github.com/settings/installations` and retry —
  `handleListMyRepos` returns `{ error: "multiple_repos_granted" }` (409) instead of a
  candidate list; there is no repo picker on either platform. See
  `ui/api/auth/_lib/repo-resolution.ts`'s `resolveOwnedRepos()`.

## Shared backend — `ui/api/auth/[...action].ts`

All auth endpoints live in one Vercel catch-all function (ADR 0017 — Hobby plan caps a
deployment at 12 functions), dispatching on the URL's dynamic segment. Each handler below is a
named export in that one file:

| Handler | Route | Role |
|---|---|---|
| `handleStart` | `/api/auth/start` | Entry point. Builds PKCE + signed state, redirects to GitHub's authorize endpoint. |
| `handleCallback` | `/api/auth/callback` | Token exchange, `GET /user`, installation lookup. Web: session or `AuthError`. iOS: `coachhq://callback` (token, or `needs_setup=1` into `SetupView`). |
| `handleInstallRedirect` | `/api/auth/install-redirect` | iOS-only in practice now — `SetupView`'s "continue to install" step. `?platform=ios`. |
| `handleListMyRepos` | `/api/auth/list-my-repos` | Resolves/confirms the account's repo, dual auth (session cookie or Bearer). Auto-selects on exactly one candidate, 409 `multiple_repos_granted` on 2+ (ADR 0019, no picker). iOS-only in practice now — its fallback for the 0-or-2+ candidate case. |
| `handleMe` / `handleLogout` | `/api/auth/me` / `/api/auth/logout` | Web session read / clear. |
| `handleRefresh` | `/api/auth/refresh` | iOS-only — confidential half of the refresh-token exchange (iOS has no `client_secret`). |
| `_lib/session.ts` | — | JWE session cookie helpers, `ensureFreshSession()` (refresh-token rotation, ADR 0009). |
| `_lib/pkce.ts` | — | PKCE verifier/challenge + the signed-state helpers above. |
| `_lib/repo-resolution.ts` | — | Single source of truth for installation + owned-repo lookup, shared by `handleCallback` and `handleListMyRepos`. |

**Gotcha:** `ui/vercel.json`'s SPA fallback rewrite must stay scoped to exclude `/api/`
(`"source": "/((?!api/).*)"`). A plain `"/(.*)"` rewrite competes with this file's own wildcard
route (`/api/auth/*`) since both are dynamic patterns — Vercel reliably prefers a real function
over a rewrite for a *literal* path (`/api/waitlist`), but not reliably between two wildcards.
This took down GitHub sign-in on web and iOS simultaneously for several hours with no server-side
error to find, because the request never reached this file at all.

**iOS gotcha — the two handlers hand back different shapes.** `selectedRepo` is `owner/repo` when
it came from `handleListMyRepos`, but a bare repo name when it came from the OAuth callback. Always
use `GitHubAuthManager.repoFullName` for GitHub API URLs and the `X-Coach-Repo` header; never
concatenate `user.login` + `selectedRepo` blindly.

## Which GitHub App this is

Sign-in runs on a **GitHub App**, not an OAuth App. They are separate things on separate pages,
and looking in the wrong list costs an hour.

| | |
|---|---|
| Kind | GitHub App (**not** an OAuth App) |
| Name / slug | `coach-phelps` — the `GITHUB_APP_SLUG` default at `ui/api/auth/[...action].ts:47` |
| Owner | the `sibling-shipyard` **org**, not a personal profile |
| Client ID | `Iv23liw9UF0ySLSh3fdq` |
| Settings | `https://github.com/organizations/sibling-shipyard/settings/apps` |

Two tells that this is a GitHub App: the install flow at `[...action].ts:145`
(`/apps/<slug>/installations/new`) and refresh tokens at `:288`. OAuth Apps have neither.

The client ID is not a secret — it is in the authorize URL every user sees. The client **secret**
is, and lives only in Vercel.

**Finding it:** it is not on a personal profile, and it is not called `coach-hq`. Unrelated
OAuth Apps by that name exist and are not this. Match on the client ID above.

## Preview deploys need their own callback URL

`redirectUri` is built from the host you are on (`[...action].ts:89`), so a preview deploy asks
GitHub to redirect to the preview host. GitHub refuses any host not registered, with a
"might be misconfigured" page that names nothing.

To test auth on a preview:

1. Register the branch alias as a callback URL on the App above, up to 10 total:
   `https://coach-hq-git-<branch>-skanda-sureshs-projects.vercel.app/api/auth/callback`
2. Enter through that **branch alias**, never the per-deploy `coach-<hash>-*.vercel.app` URL.
   The alias is stable for the branch; the hashed URL changes on every redeploy and would burn
   the 10-URL budget in a day.

**Do not enable wildcard matching to avoid this.** GitHub supports it, but a wildcard matches
subdomains of the registered host — and every preview lives under `vercel.app`, which we do not
own. Registering it would let anyone's Vercel deployment receive our authorization codes. A
wildcard is only safe on a domain we control end to end.

## Session mechanics (ADR 0009)

GitHub's access token dies at ~8h regardless of cookie settings. "Stay logged in" is
`ensureFreshSession()` (`_lib/session.ts`) silently exchanging the 6-month `refresh_token` for a
new access token 5 minutes before expiry, on every request, re-issuing a sliding 180-day
session cookie. iOS has no server session — it calls `/api/auth/refresh` itself and stores the
rotated pair in Keychain, access token + refresh token + expiry in one combined item written
with a single call, so a process kill mid-write can never pair a fresh access token with a
stale refresh token (`GitHubAuthManager.swift`; falls back to reading the old 3-key layout for
athletes signed in before this shipped). A transient 502 from `/api/auth/refresh` retries once;
a 401 fails immediately. Full reasoning: `kdb/decisions/0009-refresh-token-sliding-session.md`.

## Done when

Existing user logs in on web → dashboard, no repo-creation UI ever shown. A no-install GitHub
account on web → `AuthError`'s `needs_ios_setup` message, not a dead `/setup` route. iOS setup
flow unaffected.

## Deferred

- P2: `needs_ios_setup` message has a placeholder App Store mention — no app name/link yet
  (developer license in progress). Fill in once available.

## Appendix — file reference

| Path | Role |
|---|---|
| `ui/client/src/components/welcome/WelcomePage.tsx` | Web "Log in with GitHub" entry point |
| `ui/client/src/components/login/GitHubAuthButton.tsx` | Shared popup-based sign-in control |
| `ui/client/src/lib/authPopup.ts` | `window.open()` + `message`-listener helper |
| `ui/client/src/pages/AuthPopupComplete.tsx` | `/auth/popup-complete` — runs inside the popup only |
| `ui/client/src/pages/AuthError.tsx` | Renders `auth_error` types, incl. `needs_ios_setup` |
| `ui/client/src/components/RepoDataGate.tsx` | Loading/error/revoked states for `useRepoData()` pages |
| `ui/client/src/contexts/AuthContext.tsx` | Client-side auth state gate (`loading`/`local`/`unauthenticated`/`authenticated`) |
| `ui/api/auth/[...action].ts` | All auth handlers (`handleStart`, `handleCallback`, `handleInstallRedirect`, `handleRefresh`, `handleMe`, `handleLogout`, `handleListMyRepos`) — one catch-all function, see ADR 0017 |
| `ui/api/auth/_lib/session.ts` | Cookie helpers, JWE encrypt/decrypt, `ensureFreshSession()` |
| `ui/api/auth/_lib/pkce.ts` | PKCE verifier/challenge generation + signed OAuth state (`signOAuthState`/`verifyOAuthState`) |
| `ui/api/auth/_lib/repo-resolution.ts` | Shared installation/repo lookup logic |
| `ui/api/auth/_lib/resolve-auth.ts` | Per-request auth for repo-scoped endpoints (cookie or Bearer+X-Coach-Repo) |
| `ui/vercel.json` | Rewrites/headers — SPA fallback rewrite must exclude `/api/` (see Gotcha above) |
| `ios/CoachHQ/CoachHQ/Services/GitHubAuthManager.swift` | iOS sign-in, Keychain, repo resolution, token refresh |
| `ios/CoachHQ/CoachHQ/Views/SetupView.swift` | iOS native Setup wizard |
| `ios/CoachHQ/CoachHQ/Views/LoginView.swift` | iOS sign-in screen |
| `ios/CoachHQ/CoachHQ/CoachHQApp.swift` | iOS auth-state routing |
| `kdb/decisions/0009-refresh-token-sliding-session.md` | ADR for the refresh-token session design |
| `kdb/decisions/0019-enforce-single-repo-per-account.md` | ADR for the one-repo-per-account block (no picker) |
