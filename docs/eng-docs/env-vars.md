# Vercel environment variables

## Context

No file in this repo ever listed every env var the `ui/api/*` functions need — each just read
`process.env.X` with its own silent fallback. That gap is why `SESSION_SECRET` being unset
went unnoticed until `ui/api/auth/[...action].ts` needed a `CLIENT_SECRET` fallback to keep
iOS sign-in working. This is the canonical list — check it against the Vercel dashboard
(Project → Settings → Environment Variables) when something silently misbehaves.

## Required

| Var | Used by | What breaks if unset |
|---|---|---|
| `GITHUB_APP_CLIENT_ID` | `ui/api/auth/[...action].ts` | Sign-in redirects to `?auth_error=config_error` instead of GitHub — every user blocked. |
| `GITHUB_APP_CLIENT_SECRET` | `ui/api/auth/[...action].ts` | Same as above. Also silently becomes the OAuth-state HMAC key if `SESSION_SECRET` is unset (see below). |
| `SESSION_SECRET` | `ui/api/auth/_lib/session.ts`, `ui/api/auth/[...action].ts` | `session.ts` throws outright for web sessions (must be 32 random bytes, base64-encoded). For the OAuth `state` HMAC specifically, falls back to `CLIENT_SECRET` instead of throwing — logs a `[auth]` warning on cold start if this happens. |
| `GITHUB_APP_SLUG` | `ui/api/auth/[...action].ts` | Falls back to `"coach-phelps"` — only matters if the App is ever renamed. |
| `GEMINI_API_KEY` | `ui/api/coach-chat.ts` | Every POST request (including `action: "greet"`) fails with a clean 500 — checked once at the top of the handler before any branch. |
| `WAITLIST_GITHUB_TOKEN` (or `GITHUB_PAT`) | `ui/api/waitlist.ts` | Waitlist signups fail (`waitlistConfig()` returns null). |
| `WAITLIST_GITHUB_REPO` | `ui/api/waitlist.ts` | Falls back to `sibling-shipyard/coach-phelps-hq` — logs a `[waitlist]` warning on first use if unset. Only matters if the waitlist should write elsewhere. |

## Optional (fails open)

| Var | Used by | What breaks if unset |
|---|---|---|
| `GLOBAL_CONFIG` | `ui/api/_lib/soulCache.ts` (via `@vercel/edge-config`'s `createClient`) | Explicit-cache name/expiry can't be read back across cold starts — every request falls back to the pre-caching prompt shape (still correct, just no explicit-cache discount). Named `GLOBAL_CONFIG` because that's the default var name Vercel's "Connect Project" flow gives an Edge Config store (rebranded "Global Config" in the dashboard, Aug 2026) — not `EDGE_CONFIG`, the SDK's own default. See `docs/eng-docs/gemini-flow.md`. |
| `EDGE_CONFIG_ID` | `ui/api/_lib/soulCache.ts` | Same fallback as above — a newly-created cache name can't be persisted, so it's only reused within the same warm instance. |
| `VERCEL_API_TOKEN` | `ui/api/_lib/soulCache.ts` | Same fallback — needed alongside `EDGE_CONFIG_ID` because Edge Config has no write API of its own, only reads; writes go through the Vercel REST API. |
| `VERCEL_TEAM_ID` | `ui/api/_lib/soulCache.ts` | Only needed if the Vercel project lives under a team account — omit for a personal-account project. |
| `COACH_CHAT_BRANCH` | `ui/api/coach-chat.ts` | Falls back to `"main"` — the intended default for real athlete traffic, not a misconfiguration, so no `console.warn` on this one (would fire on every production close otherwise). Set to a scratch branch when testing a real close end-to-end (see `coach-chat-design-history.md`'s 2026-08-14/15 entry), so a test run's commit doesn't land on an athlete's actual `main`. |

## Rule

Every new `process.env.X` read in `ui/api/*` should either throw/error visibly if required, or
log a `console.warn` if it silently falls back to a default — see `[auth]`/`[waitlist]` warnings
above for the pattern. A default with no log line is how `SESSION_SECRET` went unnoticed.
