# Vercel environment variables

> Status: Current · Owner: Tech Lead · Verified: 2026-09-04

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
| `GEMINI_API_KEY` | `ui/api/coach-chat.ts`, `ui/api/coach-message.ts` (direct Gemini adapter — the default) | Chat always, and post-sync Coach generation when `LLM_PROVIDER` is unset or `"gemini"`, fail with a clean 500 before a model call. |
| `OPENROUTER_API_KEY` | `ui/api/coach-message.ts` (OpenRouter adapter, `ui/api/_lib/llmAdapters/openRouterAdapter.ts`) | Only read when `LLM_PROVIDER=openrouter`. Post-sync Coach generation fails with a clean 500 before a model call on a deployment that sets it (#713). |
| `WAITLIST_GITHUB_TOKEN` (or `GITHUB_PAT`) | `ui/api/waitlist.ts` | Waitlist signups fail (`waitlistConfig()` returns null). |
| `WAITLIST_GITHUB_REPO` | `ui/api/waitlist.ts` | Falls back to `sibling-shipyard/coach-phelps-hq` — logs a `[waitlist]` warning on first use if unset. Only matters if the waitlist should write elsewhere. |

## Optional (fails open)

| Var | Used by | What breaks if unset |
|---|---|---|
| `GLOBAL_CONFIG` | `ui/api/coach-chat/_lib/soulCache.ts` (via `@vercel/edge-config`'s `createClient`) | Explicit-cache name/expiry can't be read back across cold starts — every request falls back to the pre-caching prompt shape (still correct, just no explicit-cache discount). Named `GLOBAL_CONFIG` because that's the default var name Vercel's "Connect Project" flow gives an Edge Config store (rebranded "Global Config" in the dashboard, Aug 2026) — not `EDGE_CONFIG`, the SDK's own default. See `docs/eng-docs/gemini-flow.md`. |
| `EDGE_CONFIG_ID` | `ui/api/coach-chat/_lib/soulCache.ts` | Same fallback as above — a newly-created cache name can't be persisted, so it's only reused within the same warm instance. |
| `VERCEL_API_TOKEN` | `ui/api/coach-chat/_lib/soulCache.ts` | Same fallback — needed alongside `EDGE_CONFIG_ID` because Edge Config has no write API of its own, only reads; writes go through the Vercel REST API. |
| `VERCEL_TEAM_ID` | `ui/api/coach-chat/_lib/soulCache.ts` | Only needed if the Vercel project lives under a team account — omit for a personal-account project. |
| `COACH_CHAT_BRANCH` | `ui/api/coach-chat.ts` | Falls back to `"main"` — the intended default for real athlete traffic, not a misconfiguration, so no `console.warn` on this one (would fire on every production close otherwise). Set to a scratch branch when testing a real close end-to-end (see `coach-chat-design-history.md`'s 2026-08-14/15 entry), so a test run's commit doesn't land on an athlete's actual `main`. |
| `LLM_PROVIDER` | `ui/api/_lib/llmClient.ts` (`selectLlmAdapter`), read by `ui/api/coach-message.ts` | Falls back to `"gemini"` — the default, and what production runs. No `console.warn`: this is the intended rollback state, not a misconfiguration (docs/plans/chat-openrouter-migration.md). Only the exact value `"openrouter"` selects the OpenRouter adapter; any other value, including a typo, stays on direct Gemini (#713). |
| `SENTRY_DSN` | `ui/api/_lib/sentry.ts` | Server-side error capture is off — `initServerMonitoring()` returns false and nothing is sent. Set to the `coach-hq-api` project DSN (EU region). |
| `VITE_SENTRY_DSN` | `ui/client/src/lib/observability.ts` | Browser error capture is off. Set to the `coach-hq-web` project DSN; Vite bakes it into the client bundle at build time, so it must exist at build, not just at runtime. |
| `SENTRY_RELEASE` / `VITE_SENTRY_RELEASE` | server / browser Sentry setup | Both fall back to `VERCEL_GIT_COMMIT_SHA`, then to `development` if that is missing too. The browser gets it via `ui/vite.config.ts`, which bakes the value into the bundle at build time. Left at `development`, Sentry has no release to match uploaded source maps against. |
| `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT` | server / browser Sentry setup | Both fall back to `VERCEL_ENV` (`production`/`preview`) — then to `NODE_ENV` on the server, Vite's build mode in the browser. Vite's `MODE` alone is `production` for every built bundle, preview included, so the browser side is wired to `VERCEL_ENV` in `ui/vite.config.ts` (#641). |
| `SENTRY_TRACES_SAMPLE_RATE` / `VITE_SENTRY_TRACES_SAMPLE_RATE` | server / browser Sentry setup | Both fall back to `1` — every trace sampled, which is what four athletes want. Set them to turn the rate down; a value that isn't a number logs a `[sentry]` warning and uses `1` rather than letting Sentry read `NaN` as tracing-off. Traces bill against the span quota, not the error quota. |

## Vercel variable types

**`VITE_`-prefixed vars are Vercel type Config, not Secret.** Vite inlines them into the client
bundle at build time, so a Secret is unreadable to the build and the var lands as `undefined` with
no error — the same silent-fallback failure this page exists to prevent. Only the non-`VITE_` half
of each pair above is a Secret.

## Rule

Every new `process.env.X` read in `ui/api/*` should either throw/error visibly if required, or
log a `console.warn` if it silently falls back to a default — see `[auth]`/`[waitlist]` warnings
above for the pattern. A default with no log line is how `SESSION_SECRET` went unnoticed.
