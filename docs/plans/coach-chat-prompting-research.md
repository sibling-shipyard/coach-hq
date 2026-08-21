# Coach-chat prompting research — restored from part 7

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

Restored at Skanda's request from `coach-redesign-part7-prompting.md`, deleted in #451 as part
of the shipped-plan cleanup. That file was a working research doc, deferred as a whole at the
time ("revisit once the restructure is actually running"). The restructure has since shipped
(#437, #439, #443, #445, #446, #447, #448). This is that doc re-checked against the code as it
stands today, not a verbatim restore — some of the four flagged recommendations already
happened, one is now moot, two are still real open questions.

## What's changed since the original research

| # | Original recommendation | Status today | Evidence |
|---|---|---|---|
| 1 | Per-athlete cache tier for `profile.json`/`memory.json`, pulled forward into the memory-file split | **Not built.** `soulCache.ts` is still one shared cache entry for the static SOUL prefix only — "Not per-athlete - one entry (keyed by content hash) serves every call." | `ui/api/coach-chat/_lib/soulCache.ts:6-7` |
| 2 | Sequential-smaller-calls vs. one-wide-schema for closing turns | **Partially addressed, differently than proposed.** #446 shipped mode-specific schemas (`generationConfigFor(mode, firstSession)` in `coachReplySchema.ts`) — closing gets a wider property set than greeting/ordinary, but it's still one call, not sequential per-fact-type calls. The original question (is one wide schema per closing turn reliable enough) is still open; the answer chosen was "narrow the schema by mode," not "split into multiple calls." | `ui/api/coach-chat/_lib/coachReplySchema.ts:317-339` |
| 3 | Windowed `sessions.json`/`coach_log.json` reads instead of sending the whole log every turn | **Shipped**, via a different route than named. Recent session notes are windowed (`RECENT_SESSION_WINDOW = 5`, most-recent-first) rather than sending the full log. #437 ("widen coach-log window") is the PR that did this. | `ui/api/coach-chat/_lib/coachContext.ts` (`RECENT_SESSION_WINDOW`) |
| 4 | Retry-with-repair for JSON-truncation, instead of blind retry | **Not built.** `geminiClient.ts`'s retry is still blind — same request replayed once on a stale-cache 400 or a 503/504, no re-ask-with-the-malformed-output-and-fix-this variant. | `ui/api/coach-chat/_lib/geminiClient.ts:92-104` |

So of the four, one shipped (#3, windowing), one shipped but via a different mechanism than
proposed (#2, mode-narrowing instead of call-splitting), two are still open (#1 per-athlete
cache, #4 retry-with-repair).

## Failure history — still the operative filter

Unchanged from the original doc, still true: `reasoning`, `title`, and an early `session_note`
attempt each independently triggered the same runaway-repetition failure mode, burning the output
budget on degenerate rambling and sometimes taking `session_closed` down with it. `coach_note` has
been reliable — short, single-purpose, declared early in the schema. This is now formalized as the
"action-field design rule" in `gemini-flow.md`: every reported-fact field needs server-owned
bookkeeping, ships one at a time, prefers constrained enums over free text, and is ordered before
`reply` in the schema. Any new prompting change should be filtered through this same question:
does it add another free-text field competing for the model's attention, or does it constrain the
ask further.

## Open items carried forward

### 1. Per-athlete cache tier

Gemini's explicit caching supports a second `cachedContents` entry per athlete (keyed by
athlete + content hash) sitting between the shared SOUL cache and the fully-fresh per-turn
content. `profile.json`/`memory.json` change rarely enough per athlete to be a reasonable
candidate. Not urgent at 2 athletes — the win is cost/latency at scale, not correctness. Worth
scoping once a third athlete repo exists and the cost curve is worth optimizing for real, not
before.

### 2. Sequential-smaller-calls vs. wide-schema for closing turns

Mode-narrowing (#446) reduced the property surface for greeting/ordinary but closing still asks
for everything a close might report in one call. Whether that's still too wide is an empirical
question — worth watching `close-trace` failure rates (see `coach-commit-mvp.md`'s close-trace
logging) rather than deciding this from first principles. No action needed unless real failure
data shows up.

### 3. Retry-with-repair for JSON truncation

Still a small, isolated, low-risk change to `finishGeminiResponse`'s error handling in
`geminiClient.ts` — re-ask with the malformed output plus "fix this, keep it short" instead of
blindly replaying the same request, specifically for the JSON-truncation failure mode ("Unterminated
string in JSON"). Doesn't touch the schema. Good P2 pickup whenever someone's in this file for
another reason.

## Recommendations still standing from the original research (not yet acted on, no new evidence either way)

- Don't split `buildDynamicText`'s mode branches into separate per-mode instruction files — now
  even less pressing after #446/#447/#448's schema/turn-stage decomposition did the organizational
  work a different way (`coachTurn.ts` + `turnWrites/*.ts` + mode-specific schema functions).
  Splitting the prompt-text builder further would be reorganizing for its own sake.
- `MAX_HISTORY_MESSAGES` hard window (no summarization) — still the right call for a daily
  check-in/close-out pattern; no evidence of real sessions hitting the cap.
- Prompt-injection defense against the athlete's own message — still considered-and-rejected, not
  overlooked; single-user chat, no shared prompt, no tool-calling to exploit.
- Self-consistency/verification passes on the model's own output — still not worth it until a
  simple field shows a real unreliability rate that justifies the added complexity and cost.

## Done when

Nothing here is a build task by itself — this is a research doc, same as the original. Items 1
and 3 above ("Open items carried forward") are the two real candidates for a future small PR;
neither is scoped to fire automatically. Pick one up when there's a concrete trigger (a third
athlete repo for #1, a live JSON-truncation incident for #3), not speculatively.
