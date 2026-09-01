# A2 — Chat history retention — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for A2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Supersedes
ADR 0012's count-based retention.

## Problem

`chat_history.json` currently deletes every thread past the 7 most recent (`chatThreads.ts:138-142`,
`MAX_RETAINED_THREADS = 7`, `applyRetention()` is a hard `.slice(0, 7)` on write). The athlete wants
every conversation ever had with Coach retained permanently — it's real signal for understanding
how people actually talk to Coach — while web/iOS still only ever display the most recent 7.

## What's already correct, no change needed

- **Storage order**: already newest-first. `mergeThreadToFront` (`chatThreads.ts:131-133`) prepends
  new threads, specifically so a front-slice evicts the oldest — the "latest at the top" ordering
  the athlete wants already exists.
- **Prompt context sent to Gemini**: already fully decoupled from storage retention.
  `turn.priorMessages` (only the currently-open thread's own messages) is what gets sent, sourced
  from the client's request body — never other retained threads. Dropping the cap has **zero**
  effect on Gemini prompt size or cost.
- **Client display**: neither web nor iOS has its own cap — both just render whatever the API
  returns, because the API never returns more than 7 today. This is why the fix can live entirely
  server-side.

## Fix

Move the cap from **write time** (delete) to **response time** (slice, non-destructive):

1. `chatThreads.ts`: rename `applyRetention` → something like `pruneForResponse` (or keep
   `applyRetention` and just delete the write-time call site — implementer's call), stop calling it
   at write time in `turnWrites/chatWrite.ts:56` and `activitySync.ts:127`. The file keeps growing,
   unbounded, forever.
2. Add a display-slice applied at the two places threads get sent to a client:
   - GET-history endpoint (`handleHistory`, `coachTurn.ts:136-145`).
   - Ordinary/closing turn POST response's `threads` field (`coachChatModel.ts:532-536`'s
     server-side counterpart).
   Both should return `threads.slice(0, MAX_RETAINED_THREADS)` off the already-newest-first array —
   same constant, same number, just applied on the way out instead of the way in.
3. No client changes needed on web or iOS — confirmed neither has independent logic to update.

## New ADR required

Write `kdb/decisions/00XX-chat-history-full-retention.md` superseding 0012. Context: 0012 chose
count-based retention specifically to bound file size predictably. Decision: no longer deleting —
storage is unbounded, display stays capped at 7. Why: full history is valuable developer signal;
storage growth is small in practice (see below) and prompt cost is already unaffected by retention
(confirmed independently). Note this doesn't reopen ADR 0033 ("no archive tier") — there's still no
separate archive tier, just one file that no longer prunes itself.

## Known, accepted tradeoff — not a blocker

`chat_history.json` gets read and re-parsed on every turn (to merge the new message in), bounded by
7 threads today, unbounded after this change. Rough math: a single FSP thread (~9 messages) ran
~3-5KB; a full year of daily use is maybe ~1MB. Nowhere near GitHub's blob-size limits for years.
Not solving this preemptively — ADR 0033 already rejected an archive tier once; re-litigating that
needs its own ADR if growth ever becomes a real problem, not a speculative fix now.

## Tests

- `chatThreads.test.ts`: remove/replace any test asserting write-time pruning; add a test that
  appending an 8th, 9th, ... thread keeps all of them in storage.
- New test on the response-building slice: confirm exactly 7 returned when more exist in storage,
  newest-first.

## Done when

A scratch athlete repo with 10+ threads in `chat_history.json` still shows all 10 in the file, and
the API (both GET-history and a turn response) returns only the newest 7. `validate_kdb.py` passes
on the new ADR.
