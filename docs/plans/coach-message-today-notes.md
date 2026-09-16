# Plan: carry today's activity notes into the coach-message reply

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16

## Context

The coach message is generated right after an activity syncs (`ui/api/coach-message/_lib/coachMessage.ts`,
`loadProactiveContext` -> `buildProactivePrompt`). Its `projectActivity` already reads the activity's
`description` field (the free-text note the athlete types on the iOS activity detail screen -
`DescriptionEditorSheet` in `ios/CoachHQ/CoachHQ/Views/ActivityDetailView.swift`). But generation fires
*before* the athlete has usually had a chance to open the activity and write anything.

When the athlete then replies inside that seeded thread, the reply is an ordinary chat turn
(`ui/api/coach-chat.ts:210-218`, `loadTurnState` in `coachTurn.ts:328`). That path never re-reads
`user_data/activities/hist/*.json` - its context is chat history plus profile/memory/injuries/coach_log/
quests/seasons and the precomputed `athleteInsights` aggregate only. So a note written after sync never
reaches the coach, in the original message or in any reply, even several messages into the same
conversation. This is what prompted the request: an athlete writes a note about today's session (e.g.
opponent details on a badminton match) after the coach has already opened the conversation. They want the
coach to pick it up in later replies within that same thread.

No existing eng-doc owns the coach-message pipeline end to end - it's split across `coach-chat-daily.md`
§2a (thread seeding) and `coach-data-schema.md` (the `latest_message.json` schema).

## Approach

**Scope, exactly as discussed:** only the activity that seeded *this* thread, only if synced today (the
athlete's local calendar day), only within that same conversation. No regeneration of the original
message, no older-activity backfill. It stops applying once the athlete leaves the thread or the day
rolls over.

Mechanism:
1. The client already echoes the `synced_activity_list` attachment (`chatThreads.ts:36-41`, has `batch_id`
   + `activities[]` with `id`/`start`) back in `priorMessages` on every turn. `loadTurnState` never
   re-reads `chat_history.json` server-side, so this attachment sitting in the request body is the only
   cheap way to know which activities seeded the thread.
2. In the ordinary-turn context builder (`ui/api/coach-chat/_lib/decide/coachContext.ts`, called from
   `coachTurn.ts:393`), add a small step: scan `priorMessages` for a `synced_activity_list` attachment,
   filter its `activities[]` to rows whose `start` falls on the athlete's current calendar day. Reuse
   `todayDateString`/`computeDayOffset` from `coachDay.ts` with `profile.timezone` - don't invent new
   date logic.
3. For matched activity ids, re-read the current `user_data/activities/hist/*.json` freshly, on every
   turn (not just the first). This is what makes it work even if the athlete writes the note several
   messages into the conversation. Reuse the id-matching helpers already in `coachMessage.ts`
   (`candidateFile`/`activityMatches`) by extracting them to a shared module rather than duplicating -
   both the proactive generator and this new step need "find hist file by activity id."
4. If `description` is non-empty, add it to the turn context as a small
   `today_activity_notes: [{ activity_id, title, note }]` block, alongside the existing
   profile/memory/injuries sections.
5. No injection when the thread wasn't seeded by a sync, or the note is empty - zero behavior change for
   ordinary chat.

**Critical files:**
- `ui/api/coach-chat/_lib/decide/coachContext.ts` - add the new context section
- `ui/api/coach-chat/_lib/coachTurn.ts:328-417` - wire it into `loadTurnState`/context assembly
- `ui/api/coach-chat/_lib/decide/coachDay.ts` - reuse `todayDateString`/`computeDayOffset`
- `ui/api/coach-message/_lib/coachMessage.ts` - extract `candidateFile`/`activityMatches` to share, not
  duplicate
- `ui/api/coach-chat/_lib/chatThreads.ts:36-41` - `SyncedActivityListAttachment` shape being read

## Part 1 - new eng-doc

`docs/eng-docs/chat-coach-message.md` (naming per `docs/eng-docs/README.md`), one page, front matter
`Status: Current · Owner: Tech Lead · Verified: 2026-09-16`. Covers, end to end:
- Trigger: `handleActivitySync` (in-thread, common case) vs `/api/coach-message` (backgrounded fallback) -
  ADR 0040 dedupe by `activitySyncBatchId`.
- Input: activity + HR stream projection, profile/memory, `athlete_insights.json`, `current_week.json`,
  active injuries, last 5 `coach_log` rows, previous message (anti-repeat only).
- Output: `{ body: string }`, validated 1-3 short sentences, no em dash.
- Storage: `latest_message.json` (ADR 0029) + seeded chat thread, committed atomically.
- New section: "Reply-turn notes gap" documenting the fix below.

Trim `coach-chat-daily.md` §2a down to a pointer at this new doc instead of duplicating; leave
`coach-data-schema.md`'s schema listing as-is (different concern, no overlap to cut).

## Verification

- Unit test the new context step: synced-today activity with a note appears; synced-today with an empty
  note is omitted; an older-day activity in the same attachment is omitted; a non-sync thread is a no-op.
  A note added mid-conversation, after several replies, appears from that turn onward.
- Manual: on a scratch/test athlete repo, sync an activity, exchange a few chat replies, then write a note
  on iOS, then reply again - confirm the coach's next reply reflects the note content.
- `bash platform/scripts/check.sh --quiet` before first push.

## Doc upkeep

- New eng-doc passes the naming/front-matter rules in `docs/eng-docs/README.md`.
- `coach-chat-daily.md` §2a trimmed to a pointer, `Verified:` bumped.
- No ADR needed - this doesn't change generation ownership (ADR 0040) or the single-record store
  (ADR 0029), only what an ordinary reply turn reads.
