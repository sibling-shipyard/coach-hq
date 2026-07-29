# Coach chat LLM provider — research

## Context

`coach-chat.ts` calls Gemini free tier (`gemini-flash-latest`) directly via raw `fetch`, no SDK.
The athlete asked which paid API would work best if/when the free tier stops being enough —
this is a recommendation for later, not a code change now.

## Current setup

Gemini free tier, `gemini-flash-latest` (Google's floating alias, chosen specifically because
dated Gemini model IDs kept getting sunset early — see the comment at `coach-chat.ts:37-43`).
Forces JSON output via `responseSchema` (`reply`/`commit_message`/`file_updates`),
`maxOutputTokens: 32768` so a close-session turn can carry full file bodies. 429s are caught and
surfaced as a quota-exceeded error. No prompt caching — `SOUL.md` + `state.md` + `quest_log.md`
are refetched and resent as system-prompt context on every single turn.

## Comparison

| Model | Input / output per M tokens | Structured JSON output | Notes for this use case |
|---|---|---|---|
| Gemini 3 Flash (current) | $0.50 / $3.00 | Yes (`responseSchema`, already in use) | Cheapest; free tier available, rate-limited |
| Claude Haiku 4.5 | $1 / $5 | Yes, GA since Feb 2026 (`output_config.format`) | Same JSON-schema pattern as today — near drop-in swap |
| GPT-5 mini | $0.25 / $2 | Yes (JSON schema strict mode) | Cheapest paid option |

## Recommendation

**Claude Haiku 4.5 over GPT-5-mini**, if/when Gemini free tier stops being enough — not the
cheapest, but the better fit for this specific job:

1. **Persona consistency.** `SOUL.md` is a large, identity-heavy system prompt re-sent whole
   every turn, and the whole point of Coach Phelps is staying in character across a long
   conversation. Claude models are generally stronger at sustained instruction-following/persona
   adherence than GPT-5-mini at a comparable price tier.
2. **Structured output fits the existing contract.** Haiku 4.5's structured outputs are GA and
   schema-based — the same `reply`/`commit_message`/`file_updates` shape `coach-chat.ts` already
   uses for Gemini. Swapping providers would be closer to a client-call change than a rewrite of
   the response-handling logic.
3. **Prompt caching.** Since the same `SOUL.md`/`state.md`/`quest_log.md` block gets resent every
   turn, Claude's prompt caching could cut effective cost well below the raw per-token rate
   suggests — this matters more here than GPT-5-mini's lower list price.

GPT-5-mini stays the cheapest option on paper ($0.25/$2 vs Haiku's $1/$5) and would be the
better pick for a use case that's pure throughput with no persona requirement — that's not this
one.

## Done when

Nothing to build — this is a reference doc. Re-open the comparison when Gemini free-tier limits
actually become a blocker (watch for 429s surfaced in `coach-chat.ts`'s error path), not before.

## Deferred

- No provider-abstraction layer — `coach-chat.ts` stays a direct Gemini caller for now.
- No code changes from this doc. Revisit pricing before committing to a switch — model pricing
  moves fast and this table will go stale.
