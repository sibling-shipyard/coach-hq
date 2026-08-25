# Coach-chat redesign — real end-to-end testing

> Status: Current · Owner: Tech Lead · Verified: 2026-08-21

## Context

Skanda's call, 2026-08-21: "nothing is tested properly" since the redesign stack (#437, #439,
#443, #445, #446, #447, #448) shipped. That's accurate. What exists today is unit coverage only —
15 test files under `ui/api/coach-chat/_tests/`, each testing one module in isolation
(`coachTurn.test.ts`, `fspWrites.test.ts`, `renderCoachContext.test.ts`, etc.), plus 15 golden
transcripts under `_tests/coach-chat-eval/transcripts/` that exercise the schema/write-mapping
logic against fixture data. None of it has run against a real athlete repo through the actual
hosted API since this stack landed. `docs/eng-docs/coach-chat-daily.md` and
`docs/eng-docs/coach-chat-fsp.md` (written this session) describe what the code does — neither
has been verified against a live conversation.

This absorbs and supersedes a "Stack-wide real end-to-end verification" checklist that used to sit
in the coach-chat open-items doc (since removed) — same content, promoted to its own file because
it's the biggest single piece of remaining risk in this whole redesign, not a minor list item.

## Why this matters more than it looks

Every fix in this stack has been verified by reading code and running `tsc --noEmit` / unit
tests / `compose-soul.mjs --check`. None of that catches: a Gemini call that actually returns a
shape the schema didn't anticipate, a GitHub commit that silently fails on real auth, a prompt
that reads fine in review but produces a bad reply against a real athlete's real history, or a
frontend that renders a blank widget against real generated data instead of a fixture. Unit tests
by construction test the code against inputs someone already thought of.

## Plan

Any step below that says "via the hosted API" or "pull the real committed file" can now be
driven and logged in one shot with `npm run test:coach-chat-manual`
(`ui/scripts/run-manual-coach-chat-test.ts`, see its header comment for usage). It's a manual,
on-demand tool, not CI - it costs real Gemini calls and writes real commits. No branch needs
cutting first: it names and creates its own scratch branch off the real default branch
automatically (or reuses one you name with `--branch`), and refuses outright to run against the
repo's default branch.

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
   "ordinary" (`profile_update`, `memory_update`, `injury_event`, at
   minimum) — run them through `npm run test:coach-chat-manual` and read the logged
   `filesChanged.diff` for each turn to confirm the write landed in the shape
   `coach-data-schema.md` documents, not just that a commit happened.
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

### Frontend

1. Open the webapp dashboard against a migrated repo (`coach-skanda` post-part-3) — confirm
   quest/season widgets render from the real split-ledger data, not just the
   `splitLedgerAsChallenge()` projection in isolation.
2. Open it against an unmigrated repo (`coach-akash` pre-part-3) — confirm the legacy
   `challenge_v2.json` path still renders correctly, since both shapes are live in production
   simultaneously right now.
3. Confirm the Fitness Snapshot section reads sensibly for a real athlete's real activity mix.
4. Confirm the day-count badge fix (once `ui-dashboard-rewiring-web.md` step 5 and
   `ui-dashboard-rewiring-ios.md` step 1 land) actually shows the right number on both platforms,
   both schema shapes.

## Automated test gap

Separate from the live-repo pass above: no test proves a real `athlete_insights.json` survives
`loadCoachContext()` -> `renderCoachContext()` -> the actual `handleGreet`/ordinary-turn handler
call sites together - today each layer is tested in isolation (`renderCoachContext.test.ts`,
`coachChatFiles.test.ts`, `activitySyncTurn.test.ts`), never chained. Add that chain test, plus a
multi-sport render case and one extreme-value case (a 0-day gap, a single-session sport).

## Done when

Every numbered step above has a real result recorded (pass, or a filed issue if it fails) —
not "looks fine," an actual observed commit/render/reply checked against what the doc claims
happens. Any mismatch between what `coach-chat-daily.md`/`coach-chat-fsp.md` say and what actually
happens gets fixed in the doc or the code, whichever is wrong, and logged in
`coach-chat-design-history.md`.

## Scope guard

This is verification, not a redesign. If a step surfaces a real bug, file an issue rather than
fixing it inline mid-test-pass — keep this pass focused on finding out what's actually true, not
on rebuilding anything discovered broken.
