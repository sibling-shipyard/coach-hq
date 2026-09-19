# Plan: prompt caching for coach-message on OpenRouter

> Status: Plan (gated) · Owner: Tech Lead · Created: 2026-09-18

## Context

Coach-message is the proactive note Coach writes after a sync. It is the only path the cache
marker was ever measured on (`chat-provider-bench.md` § Explicit cache marker: 48% cached from
call 1). Chat ships the marker first (ADR 0053). This plan is what
follows, and it does not start until chat proves the marker works.

## Gate - do not build until all three hold

1. Production chat spans in Sentry carry `llm.cache_marker: true` and a nonzero
   `gen_ai.usage.input_tokens.cached`. The live control run in ADR 0053 already showed it locally.
2. Gap survival is not established. Under the marker, `cached_tokens` did not track reuse (ADR 0053),
   so measure the billed cost of a repeat call after gaps of 2, 6 and 15 minutes instead. Compare it
   with how far apart coach-message calls really are (step 1 below).
3. The athlete says go. If chat shows no benefit, this plan is deleted, not built.

## What I verified

- `buildProactivePrompt(soul, context)` (`coachMessage.ts:297`) returns one string: soul, fixed
  instructions, few-shot pairs, then `<athlete_context>` with the data. Only the last part varies.
- `generateProactiveBody` (`coachMessage.ts:327`) sends `system: ""`, no `cachePrefix`, one user
  turn. Two callers reach it: `ui/api/coach-message.ts:28` and `activitySyncTurn.ts:107`. One
  change covers both.
- `ui/eval/prefix-cache-probe.ts` already measures this. It splits at `<athlete_context>`.

## Build

1. **Measure real spacing first.** From Sentry, list coach-message spans per athlete for two weeks
   and get the gaps between calls. If most gaps exceed the survival gap from the gate, stop: the
   cache would expire before it is reused.
2. Change `buildProactivePrompt` to return `{ prefix, tail }`. Test that `prefix + "\n\n" + tail`
   equals today's output exactly, so the prompt text never changes, only where it is cut.
3. `generateProactiveBody` passes `cachePrefix: prefix` and puts `tail` in the user turn. Adapter
   needs no change; the chat PR already built the block shape.
4. **Direct-Gemini check before merge.** A `cachePrefix` makes `geminiAdapter.ts:169` try the
   explicit soul cache and `:179` add a retry that coach-message does not have today. Decide
   whether coach-message opts out on that path. Read `getCachedSoulName` before deciding.

## How to test it works

1. Unit: split round-trips; `generateProactiveBody` passes prefix and tail through a mocked
   adapter; a `body`-shape failure still reaches `captureLlmFailure`.
2. Live, extend `prefix-cache-probe.ts` with a gap option. On a scratch athlete repo run:
	a. 6 activities back to back with the marker.
	b. The same with a gap of 2, then 6, then 15 minutes.
	c. A control with the marker off, same gaps, each in a fresh window. This answers the bench's
	   open question about differing cache keys.
3. After merge, Sentry: `llm.cache_marker` true vs false on coach-message spans, cached share per
   call. Report zeros as zeros.
4. Full `ui/api` tests and `check.sh --quiet`; CI green on the pushed SHA.

## Done when

1. Steps 2a to 2c are written up with real numbers, including any zero.
2. Sentry shows marked coach-message spans with cached tokens over at least one week of traffic.
3. `chat-provider-bench.md` links the result; ADR 0053 gets an amendment line only if the result
   contradicts it.

## Deferred

- Splitting the few-shot pairs out of the prefix. Only if the numbers say the cut is in the wrong
  place.
