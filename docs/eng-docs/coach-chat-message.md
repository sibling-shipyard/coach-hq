# Coach message — proactive post-sync generation

> Status: Current · Owner: Tech Lead · Verified: 2026-09-16

The one Coach-authored message the athlete gets without asking for it: written right after an
activity syncs, stored as the athlete's single current notification, and seeded into a chat
thread. This is the reference for how it's built. For day-to-day ordinary chat turns, see
[`coach-chat-daily.md`](coach-chat-daily.md); for every file Coach reads or writes, see
[`coach-data-schema.md`](coach-data-schema.md); for Gemini call mechanics, see
[`gemini-flow.md`](gemini-flow.md).

## Trigger (ADR 0040 - one generator, deduped)

Two callers can each be first to generate a given sync batch's message; whichever runs first
mints the reply and the chat thread, the other reuses both:

1. **Common path:** `handleActivitySync` (`ui/api/coach-chat/_lib/commit/activitySyncTurn.ts`),
   fired as an ordinary `POST {action: "activity_sync"}` chat request right after a sync, while
   the athlete has the app open.
2. **Backgrounded fallback:** `ui/api/coach-message.ts`'s `POST` route, for a sync with no open
   chat (e.g. an iOS background upload).

Both converge on `generateAndStoreCoachMessage` in
`ui/api/coach-message/_lib/coachMessage.ts`. Dedupe key is `activitySyncBatchId` (first 16 hex of
sha256 of the sorted unique activity ids) - the second caller for the same batch finds the
existing thread via `findThreadForActivitySyncBatch` and skips the LLM call entirely.

## Input (`loadProactiveContext`)

Assembled in parallel, all read fresh from the athlete's repo.

- The synced activity(ies) and their HR stream, projected down (sport, timing, HR zones,
  `vs_usual`, effort shape, and the athlete's free-text `description` if present at generation
  time - see the gap below).
- `coach/profile.json` + `coach/memory.json` - name, sports, coaching priorities, learned
  patterns.
- `gen/athlete_insights.json` - session cadence/gap stats.
- `ledger/current_week.json` - only included if `data_status === "live"`.
- `coach/injuries.json` - filtered to active flags only.
- `coach/coach_log.json` - last 5 rows, for continuity.
- `coach/latest_message.json` - the previous proactive message, passed in only so the model
  doesn't repeat phrasing, never as a send gate.

## Prompt and output (`buildProactivePrompt`, `generateProactiveBody`)

The SOUL system prompt, proactive-turn tone rules (one grounded message, 1-3 short sentences, no
invented causes, no summed multi-activity durations, no em dash), a set of weighted few-shot
examples, then the assembled context above as JSON inside `<athlete_context>` tags. Sent as a
single user turn via `LlmAdapter.generate()` with a strict `responseSchema`:
`{ body: string }` (`PROACTIVE_RESPONSE_SCHEMA`). `validateGeneratedBody` then enforces 1-360
chars, no newlines, no em dash, 1-3 sentences each under 180 chars.

## Storage

Two atomic writes, chat thread first then the message, in that order via `commitFilesAtomic`
(`ui/api/_lib/githubGitData.ts`) - so the message's seed-thread id reflects any concurrent-write
winner.

- **Chat thread** - `chat_history.json`, one Coach message carrying a `synced_activity_list`
  attachment (`batch_id` + the batch's activity rows).
- **`user_data/coach/latest_message.json`** - the athlete's single current-message record (ADR
  0029). A newer sync batch replaces it; a failed generation or write leaves it untouched. Full
  schema in [`coach-data-schema.md`](coach-data-schema.md#user_datacoachlatest_messagejson).

## Reply-turn notes gap, and the fix

Generation fires immediately after sync - before the athlete has usually opened the activity and
written a note in its `description` field. So even though `projectActivity` reads that field, it's
typically empty at generation time. Worse: when the athlete then replies inside the seeded thread,
that reply goes through the *ordinary* chat-turn pipeline (`loadTurnState` in
`ui/api/coach-chat/_lib/turnRequest.ts`), which never re-reads activity files at all - only chat
history plus profile/memory/injuries/insights. A note written after sync, even several replies
into the conversation, never reached the coach in either place.

The fix lives in `ui/api/coach-chat/_lib/decide/todayActivityNotes.ts`. On every ordinary reply
turn, it scans the `synced_activity_list` attachment(s) already sitting in the client-echoed
`priorMessages`. It keeps only rows synced on the athlete's current calendar day
(`coachDay.ts`'s `todayDateString` against `profile.timezone`), then re-reads each matching
activity's current `description` fresh. This happens every turn, never cached, so a note added
mid-conversation shows up starting the very next reply.

Both GitHub reads this needs are soft reads: a 404 (file genuinely doesn't exist yet) stays quiet,
any other fault captures once via `captureServerException` (ADR 0032) and degrades to no note,
rather than breaking the reply turn. No injection when there's no matching attachment, no
today's-activity match, or the note is empty - a strict no-op for ordinary chat outside a same-day
sync thread. The original proactive message itself is never touched or regenerated.
