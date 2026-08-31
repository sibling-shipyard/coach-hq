# Coach-chat redesign — real end-to-end testing

> Status: Current · Owner: Tech Lead · Verified: 2026-08-25

## Context

Skanda's call, 2026-08-21: "nothing is tested properly." That's accurate, and it's been true since
the redesign stack shipped (#437, #439, #443, #445, #446, #447, #448). What exists today is unit
coverage only. That's
15 test files under `ui/api/coach-chat/_tests/`, each testing one module in isolation
(`coachTurn.test.ts`, `fspWrites.test.ts`, `renderCoachContext.test.ts`, etc.), plus 15 golden
transcripts under `_tests/coach-chat-eval/transcripts/` that exercise the schema/write-mapping
logic against fixture data. None of it has run against a real athlete repo through the actual
hosted API since this stack landed. `docs/eng-docs/coach-chat-daily.md` and
`docs/eng-docs/coach-chat-fsp.md` (written this session) describe what the code does — neither
has been verified against a live conversation.

This absorbs and supersedes a "Stack-wide real end-to-end verification" checklist that used to sit
in the coach-chat open-items doc (since removed) — same content, promoted to its own file. It's
the biggest single piece of remaining risk in this whole redesign, not a minor list item.

## Why this matters more than it looks

Every fix in this stack has been verified by reading code and running `tsc --noEmit` / unit
tests / `compose-soul.mjs --check`. None of that catches a Gemini call that actually returns a
shape the schema didn't anticipate, or a GitHub commit that silently fails on real auth. Nor does
it catch a prompt that reads fine in review but produces a bad reply against a real athlete's
real history, or a frontend that renders a blank widget against real generated data instead of a
fixture. Unit tests by construction test the code against inputs someone already thought of.

## Re-verified 2026-08-25 — what's already done

Re-checked every step below against current code before touching this doc again (not carried
forward from the 2026-08-21 write-up). Two things landed since and close out most of Frontend:

- **The legacy `challenge_v2` render path is gone, not just fixed.** #569/#571 (2026-08-24,
  Akash) dropped `challenge_v2` from the dashboard-snapshot generator entirely and purged the
  remaining mocks - `splitLedgerAsChallenge()` / `splitLedgerChallenge.ts` no longer exist in
  `ui/client/src`. There is no second shape left to render, so **Frontend step 2 is moot**, not
  "passing" - the thing it asked to verify doesn't exist to check anymore.
- **The day-count badge regression is fixed on both platforms.** #562 (web, 2026-08-24) rewired
  `challengeDayNumber()` to read `profile?.coach_since` directly
  (`ui/client/src/components/coach-chat/coachChatModel.ts:197`); iOS's `readCoachDayAnchorDate()`
  already read `profile.coachSince` from `profile.json`
  (`ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift:209`). Code-verified directly, not via a
  live render - **Frontend steps 1 and 4 are done.**
- **Frontend step 3 (Fitness Snapshot) isn't a frontend check at all** - `fitnessSnapshotSection()`
  lives in `coachContext.ts` and feeds Gemini's prompt; nothing in `ui/client/src` renders it.
  Folded into Daily flow below (verify via a real greet/ordinary-turn reply, not a widget).

Net: **Frontend section is closed** except the folded-in fitness-snapshot check.

## Re-verified 2026-08-27 — Daily flow and FSP steps 1-4 done

Real runs executed against `coach-skanda-2003`/`coach-akash-suresh` scratch branches via
`npm run test:coach-chat-manual`. Gemini's `gemini-flash-latest` endpoint was intermittently
503/504'ing throughout this pass (confirmed independently with a raw `curl` straight to
`generativelanguage.googleapis.com`, not a symptom of our code) - several turns needed a retry
before landing a clean result. Every claim below points at a real `tests/2026-08-27/manual/`
log, not a note in this doc.

**Daily flow — closed.**
- Step 6 (cross-device staleness): confirmed both directions via a small one-off script
  (`handle()` called directly with a controlled `knownSha`, since the manual harness itself
  doesn't send one). A stale `knownSha` on an ordinary turn returns `stale: true`; a fresh one
  doesn't. Also checked the closing-turn response never carries `stale` at all - not a bug,
  `CoachChat.tsx:515-527` returns before ever reading `result.stale` on a closed turn, so nothing
  client-side depends on it there.
- Step 7 (close-session detection, both directions): `tests/2026-08-27/manual/manual-coach-chat-log-11-10-56.json`
  turn 1 - "What's my next session going to be?" → `closed: false` (no false positive).
  `tests/2026-08-27/manual/manual-coach-chat-log-11-11-50.json` - "wrap this session" → `closed: true`,
  real commit landed (`chat_history.json`, `coach_log.json`).
- Step 5 (closing turn / `template_edit`): re-confirmed the 2026-08-26 finding is real and filed
  as **issue #609** - Gemini emitting `template_edit: { template_id: "none" }` instead of omitting
  the optional field crashes the whole closing-turn commit. Not fixed per this doc's scope guard.

**FSP — steps 1-4 done, steps 5-6 can't run through this harness.**
- Step 2 (incremental writes land turn-by-turn): `tests/2026-08-27/manual/manual-coach-chat-log-11-16-10.json` -
  turn 1 ("My name is Skanda.") commits `profile.json` immediately; turn 3 ("born June 5th 2003")
  commits `profile.json` again, both mid-conversation, before any close.
- Step 3 (`coach_since` stamps exactly once, server-side, at real completion):
  `tests/2026-08-27/manual/manual-coach-chat-log-11-20-04.json` turn 4 (the close) - real diff shows
  `coach_since: null` → `"2026-08-27"` in one atomic commit alongside the chat/coach_log writes.
- Step 4 (end-conversation-without-guessing): same log, turn 2 - given the ambiguous "I'm not
  totally sure, sometime in June I think", Coach's real reply asked a follow-up instead of
  committing a guessed date; no `profile.json` write happened on that turn. Only committed once
  given the exact date.
- Step 5 (resumability) and step 6 (BYOB) are **not executable through this harness.** Resumability
  is a client-only mechanism (`CoachChatLocalCache.swift` / `coachChatModel.ts`'s
  `localStorage` helpers) — it never touches the server's `handle()` at all. BYOB means a real
  Claude Code session against `SOUL.claude.md`, a different runtime entirely. Both still open,
  need a different test method than `npm run test:coach-chat-manual`.

**Scratch branches used this pass** (left in place, per this doc's own tracking convention - not
cleaned up). `coach-skanda-2003`: `test/fsp-clean-1787829206`, `test/fsp-clean-1787829390-b`
(both real FSP runs, one hit closes successfully), plus assorted `test/manual-*` /
`test/staleness-*` branches from the Daily-flow and cross-device runs. `coach-akash-suresh`:
`test/manual-*` branches from its Daily-flow runs.

**Tracking:** every real run from this pass writes to the committed `tests/<YYYY-MM-DD>/` folder
(added in #584) - `tests/<date>/manual/` for `test:coach-chat-manual` runs, `tests/<date>/eval/`
for `eval:coach-chat`. That's the durable record for each step below: don't just note "pass" in
this doc, point at the log file. That's also the raw material for a later artifact - real
input/output/diff per run, not a summary written after the fact.

## Plan

Any step below that says "via the hosted API" or "pull the real committed file" can now be
driven and logged in one shot with `npm run test:coach-chat-manual`
(`ui/scripts/run-manual-coach-chat-test.ts`, see its header comment for usage). It's a manual,
on-demand tool, not CI - it costs real Gemini calls and writes real commits. No branch needs
cutting first: it names and creates its own scratch branch off the real default branch
automatically (or reuses one you name with `--branch`), and refuses outright to run against the
repo's default branch. Every run is logged to `tests/<date>/manual/` - see
`docs/eng-docs/coach-chat-testing.md`.

**Branch:** both `coach-skanda` and `coach-akash` are already migrated, so the split-ledger path
can be tested for real against either.

### Daily flow (`coach-chat-daily.md`)

1. Fresh scratch branch off a real athlete repo (both `coach-skanda` post-part-3 and
   `coach-akash` pre-part-3, so both schema shapes get exercised).
2. Run the sync/generator pipeline for real, so `gen/dashboard_snapshot.json` and
   `gen/athlete_insights.json` are genuinely generated, not synthetic fixtures.
3. A greeting turn via the hosted API — confirm the actual reply, confirm no file writes fire
   (greeting shouldn't write).
4. A handful of ordinary turns covering each action field the mode-specific schema exposes for
   "ordinary" (`profile_update`, `memory_update`, `injury_flag`, `injury_event`, at
   minimum). Run them through `npm run test:coach-chat-manual` and read the logged
   `filesChanged.diff` for each turn to confirm the write landed in the shape
   `coach-data-schema.md` documents, not just that a commit happened. While here, read the
   greet/ordinary reply itself for whether the Fitness Snapshot context
   (`coachContext.ts`'s `fitnessSnapshotSection()`) reads sensibly against that repo's real
   activity mix. Moved from the old Frontend step 3 — this is a prompt-context check, not a
   render check.
5. A closing turn — confirm `coach_note` appends to `coach_log.json`, confirm any quest/session
   fields close correctly, confirm one atomic commit per ADR 0012 (not multiple).
6. Cross-device staleness: open a second "device" (a second scratch conversation) mid-thread,
   confirm the behavior `coach-chat-daily.md`'s staleness section describes actually happens.
7. Close-session detection: confirm `CLOSE_SESSION_PATTERN` actually fires on a real athlete
   message that should close, and doesn't fire on one that shouldn't (test both directions, not
   just the positive case).

### First Session Protocol (`coach-chat-fsp.md`)

1. A brand-new scratch repo (or a repo with `profile.json` wiped) — run through onboarding start
   to finish via the real hosted API, not a fixture-driven test.
2. Confirm incremental writes actually land turn-by-turn as facts are given, not batched at the
   end — pull the real file after each turn, not just at completion.
3. Confirm `coach_since` stamps exactly once, server-side, at the real completion transition
   (ADR 0018) — check it isn't stamped early, isn't stamped twice, isn't skippable by a
   conversational dead-end.
4. Confirm the end-conversation-without-guessing behavior: deliberately give an ambiguous or
   incomplete answer partway through and confirm Coach asks rather than fabricates a value.
5. Resumability: abandon an FSP conversation partway through, start a new thread, confirm it
   resumes from the real partial state rather than restarting from scratch or losing what was
   already written.
6. BYOB, separately: a first session and a few turns of ordinary chat via Claude Code against
   `SOUL.claude.md`, confirming the terminal runtime's prompt (not just the hosted app's) actually
   produces sane behavior — this runtime has zero automated coverage today.

### Frontend — closed 2026-08-25

Steps 1, 2, and 4 are done or moot per the re-verification above. Split-ledger is the only shape
left in production (`challenge_v2` fully removed by #569/#571), and the day-count badge reads
`coach_since` correctly on both web (#562) and iOS, code-verified directly. Nothing left to run
here.

Step 3 (Fitness Snapshot) moved to Daily flow step 4 below - it's a prompt-context check, not a
render check.

## Automated test gap

Separate from the live-repo pass above: no test proves a real `athlete_insights.json` survives
`loadCoachContext()` -> `renderCoachContext()` -> the actual `handleGreet`/ordinary-turn handler
call sites together. Today each layer is tested in isolation (`renderCoachContext.test.ts`,
`coachChatFiles.test.ts`, `activitySyncTurn.test.ts`), never chained. Add that chain test, plus a
multi-sport render case and one extreme-value case (a 0-day gap, a single-session sport).

## Done when

Every numbered step above has a real result recorded (pass, or a filed issue if it fails) —
not "looks fine," an actual observed commit/render/reply checked against what the doc claims
happens. For Daily flow / FSP steps, "recorded" means a real `tests/<date>/manual/` log entry
exists for that step, not a note in this doc — this doc tracks which steps are done, the log
folder holds the evidence. Any mismatch between what `coach-chat-daily.md`/`coach-chat-fsp.md` say
and what actually happens gets fixed in the doc or the code, whichever is wrong, and logged in
`coach-chat-design-history.md`.

**Status as of 2026-08-27:** Frontend closed. Daily flow closed (steps 1-7, one real bug found -
issue #609). FSP steps 1-4 done. FSP steps 5 (resumability) and 6 (BYOB) still open - not
reachable through `npm run test:coach-chat-manual`, need a real client (browser/iOS) session and a
real Claude Code session against `SOUL.claude.md` respectively. The automated chain test (below)
is also still open. This doc isn't done-when-done yet - don't delete it until those three remain.

## Scope guard

This is verification, not a redesign. If a step surfaces a real bug, file an issue rather than
fixing it inline mid-test-pass — keep this pass focused on finding out what's actually true, not
on rebuilding anything discovered broken.
