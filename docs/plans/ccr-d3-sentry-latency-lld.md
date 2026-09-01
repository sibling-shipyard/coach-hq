# D3 — Sentry latency and error-capture instrumentation — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for D3 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on D2
(captures its validation-failure points, from both D1's mechanism and D2's broader audit).
Requested by Akash: GitHub-call and backend/overall latency, matching the Gemini latency
instrumentation already in place, plus broader error-capture around the new failure points this
redesign introduces.

## What already exists — the template to follow

`withGeminiSpan` (`ui/api/_lib/sentry.ts:338-364`): a `Sentry.startSpan` wrapper, op
`gen_ai.generate_content`, attributes following Sentry's own `gen_ai.*` convention. Nests
automatically under the outer `http.server` span already opened for every request
(`withSentryRoute`/`withContinuedTrace`, `sentry.ts:220-269`, wrapping `coach-chat.ts`'s `handle()`
call). `recordUsage` captures token counts + `outcome: ok|error` — no cost, no prompt/reply text on
the success path (that only appears on the separate failure-capture path, per ADR 0032).

## Fix

**GitHub-call spans**: new `withGithubSpan`, same shape as `withGeminiSpan`, wrapping every GitHub
API call site:
- `ui/api/_lib/githubGitData.ts`: `ghPost`/`ghGet` internal helpers (covers blob upload, tree
  create, commit create, ref get), the raw PATCH for ref-move, the recheck `ghGet`.
- `ui/api/coach-chat/_lib/coachChatFiles.ts`: `getFileRaw`, `listDirectory`, `getHeadSha`.

Op suggestion: `http.client` with a `github.*` namespace on attributes (repo path shape, status
code, retry count) — never the request URL or auth token (already blanket-blocked by
`ignoreEveryOutgoingRequest`, but don't manually attach one either).

**Backend/overall latency**: no new outer span needed — the existing `http.server` span already
covers total request time. Once Gemini and GitHub both have their own child spans, "our own
processing" time is visible for free as the remainder in the Sentry UI. If a named "processing"
sub-span is still wanted for direct visibility (not just subtraction), wrap `handle()`'s
non-Gemini/non-GitHub stages (prompt building, JSON parsing, reply validation) the same way.

**Broader error-capture** (the athlete's answer confirmed this is in scope, not latency-only):
- Applier/commit failures from D1's validation work — currently only `console.error`, zero Sentry
  capture. Wire `Sentry.captureException` (or a dedicated `captureValidationFailure`, matching the
  existing `captureGeminiFailure` naming pattern) into the rejected-action path.
- CI validation failures (`validate-data.yml`) — out of Sentry's reach (GitHub Actions, not the
  Vercel runtime); note this explicitly as a gap this PR does not close, since Sentry only sees
  runtime, not CI.

## Pipeline-script Sentry coverage — checked, not needed

Checked project-wide, not just coach-chat, per the athlete's ask: every one of the 7 top-level
`ui/api/*.ts` routes already uses `withSentryRoute` — no gap there, nothing to add. Client-side
Sentry already runs on both web (`@sentry/react`) and iOS (`sentry-cocoa`) — also nothing new to set
up, just more capture call sites within what already exists (see D1's client-side capture
additions). The one real gap found: `engine/scripts/` (the pipeline), which runs only via GitHub
Actions and has zero Sentry visibility. **Resolved: leave it out of scope.**
`docs/eng-docs/sentry-runbook.md`'s coverage boundary already deliberately scopes Sentry to
"homepage, chat, Gemini, HealthKit sync, Rage Reports" — the athlete confirmed that boundary stands,
matching Akash's existing doc rather than reopening it. Not part of this PR's diff.

## Data-rules constraint (ADR 0032)

Sentry is hosted in Germany, 30-day retention, `sendDefaultPii: false`. No URLs/tokens/file contents
on any new span. Latency + status only for GitHub spans, matching `withGeminiSpan`'s discipline —
model name/token counts/reply text stay failure-path-only, same rule applies to any raw content
in a validation-failure capture (scrub, don't attach full file contents verbatim if they could carry
athlete text beyond what's needed to diagnose the failure).

## Tests

- Unit test for `withGithubSpan`: confirm it wraps successfully and records `outcome` on both
  success and thrown-error paths, mirroring `withGeminiSpan`'s existing test coverage.
- Confirm no test asserts on span internals in a way that would break if Sentry's SDK changes
  attribute shape — match whatever discipline the existing Gemini span tests already use.

## Done when

A live scratch-repo turn shows, in Sentry: the outer `http.server` span, a nested `gen_ai.*` span
for the Gemini call, and a nested GitHub span for the commit — all three with real latency numbers.
A deliberately-triggered validation failure (from D1's test setup) shows up as a captured event,
not just a server log line.
