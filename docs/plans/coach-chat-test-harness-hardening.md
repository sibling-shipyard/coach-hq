# Plan: fix coach-chat test scripts/scenarios, fix the rollover gap, then re-run live

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16

## Context

Yesterday's live-testing pass fixed 4 real coaching bugs and 1 process bug. Three research
passes today looked deeper: the full action-field coverage matrix, every finding plus a
test-harness script audit, and the 5 real athlete repos' actual data state. They found a problem
underneath all of that: none of the test scripts check whether a target repo's data actually
supports the scenario being run.
A scenario can "pass" via an unintended fallback write and stay marked covered indefinitely.

Separately, one of yesterday's false-positives has a real root cause behind it. All 5 real repos
have an empty week plan, and 2 of the 5 haven't even had their week frame rolled to the current
ISO week. That's a real production gap, not a testing artifact: `rollover-current-week.mjs` only
runs as a side effect of the iOS activity-sync workflow. An athlete who hasn't synced recently
gets no rollover at all.

Fixing both - the scripts and the rollover gap - has to happen before a second live round.
Otherwise the round just re-discovers the same blind spots. Nothing in this plan is deferred to
backlog; all of it ships in this initiative.

## Phase 1 - fix the scripts

1. **Repo data-profile check** - new `ui/scripts/lib/repoDataProfile.ts`. Given a local athlete
   repo path, read `current_week.json`, `injuries.json`, `quests.json`, `memory.json`, and the
   workout template directory. Return a structured profile: week `data_status` + session count,
   active/resolved injury counts, quest count + whether a daily-streak habit quest exists,
   `coaching_style`, template count. Pure read, no network. This is what lets a scenario declare
   what it needs and get checked against reality, instead of relying on a human to read 5 repos
   by hand before every run.
2. **Scenario preconditions** - extend the `Scenario` type in `run-simulation-suite.ts` with an
   optional `preconditions` field (e.g. `{ currentWeekHasSessions: true }`,
   `{ injuryFlags: "any" | "none" }`, `{ hasHabitQuest: true }`). Before running a scenario,
   check its target repo's profile against this. If unmet, record a new `"skipped-precondition"`
   status in `coverage-index.json` - distinct from pass/fail - with the reason, instead of
   letting an unintended fallback silently score a pass. Wire the same check into
   `run-manual-coach-chat-test.ts` so ad hoc runs get the same guard.
3. **Formalize the all-5 run path** - yesterday's "Group B" pass against all 5 repos called
   `run-manual-coach-chat-test.ts` directly per repo, bypassing `run-simulation-suite.ts`
   entirely. Those runs never got scored or written to `coverage-index.json`. Add a
   `--repo <shortcut>` / `--all-repos` override to `run-simulation-suite.ts` so a scenario can be
   pointed at any/all of the 5 real repos and still go through normal scoring and bookkeeping.
4. **Coverage-index reconciliation** - `writeCoverageEntry`'s per-key read-merge-write (fixed in
   #1076/#1077) still isn't atomic across processes for the *same* key. Add a small
   reconciliation script that diffs `coverage-index.json` against the raw run logs under
   `test-results/raw/<date>/manual/` and flags any run with no matching index entry. This is
   what would have caught F5 automatically, instead of a human noticing.
5. **Doc drift** - `docs/eng-docs/coach-chat-testing.md` only names 2 of the 5 real athlete repos
   in prose; add the full roster (matches `ATHLETE_REPOS` in `run-manual-coach-chat-test.ts`).
   Fix the stale ADR citation in `engine/.github/workflows/sync.user.yml`, which cites ADR 0039,
   an unrelated iOS ADR - the real decision is ADR 0042. Fix the same citation in
   `docs/ref-docs/current-week-contract.md` if it repeats it.

## Phase 2 - fix every scenario gap (nothing deferred)

1. Add a `filesChangedInclude: ["coach_log.json"]` assertion to one existing simulation scenario
   to close the one acknowledged `coach_note` gap (no dedicated file-write assertion today).
2. Add one new simulation scenario exercising two action fields *succeeding* together in the same
   turn - a week restructure plus a routine edit in one message. Every existing multi-field test
   only covers two fields failing together, never both landing correctly.
3. Add one new scenario probing the same compound-message shape that broke `memory_update`: a
   durable fact stated alongside an unrelated request in one message. Run it against
   `template_edit`/`session_plan`/`week_update`/`workout_create`, to check proactively whether the
   same narration-vs-action failure class exists elsewhere.
4. Add a `current_week.json` session using an unusual `discipline` enum value (e.g. `badminton`
   or `hike`) to an existing `week_update` eval transcript/scenario. Confirm an invalid value is
   rejected by `engine/lib/current-week.mts`'s validator, and write a small unit test for the
   invalid-value rejection if one doesn't already exist there.
5. Add a `timed`-type exercise to `coachTurn-workoutCreate.test.ts` (today only tests `reps`) and
   to eval transcript `17`. This exercises exercise-type handling end to end, not just at the
   `workoutSchema.ts` unit level.

## Phase 3 - fix the rollover gap for real

**The mechanism, based on today's investigation:** `rollover-current-week.mjs`'s actual decision
logic (`needsRollover`) is a pure, cheap date comparison against `current_week.json`'s own
`end_date`/staleness. It doesn't need the local git checkout, only the file's content and today's
date. Its one real dependency, `parseCurrentWeek` (`engine/lib/current-week.mts`), is already
bundled and used inside the coach-chat Vercel function today
(`ui/api/coach-chat/_lib/current-week.bundle.js`, imported by `coachWeekFiles.ts`).

This repo already has a proven pattern for exactly this shape of problem: `coach_since` (ADR
0018). `injectCoachSinceIfNeeded` (`coachSinceStamp.ts`) is *checked* every turn, but it only
ever *writes* once. A guard (`if (parsed.coach_since) return`) makes it a permanent no-op the
moment it's set. In practice it stamps exactly once, the day the athlete's profile flips from
incomplete to complete (FSP finishing), and never touches anything again after that. There's no
stored "has this run yet" job state, no cron - the transition is derived fresh from that turn's
own before/after data, and the one real write folds into that same turn's existing commit.

**The fix:** add a lazy, same-turn rollover check to `coachTurn.ts`'s turn pipeline, modeled
directly on `coach_since`. At turn start, `today`/`timezone` are already resolved in
`loadTurnState`. Read `current_week.json` fresh there, and run the ported `needsRollover`/
`buildRolloverPlaceholder` logic from `rollover-current-week.mjs`. If the week has aged out, fold
the fresh placeholder into that turn's outgoing write set through the existing
`commitFilesAtomic` call - the same commit primitive already used for every other turn write, no
new infrastructure.

This directly answers "when should this happen": the first message an athlete sends after their
week has aged out, whether that's chat, greeting, or any other turn. It's not tied to a login
event that doesn't otherwise exist in this app's model, and it doesn't wait on iOS activity sync
at all. It's the same shape as `coach_since`, with one difference: `coach_since` fires once ever,
because the transition it watches for only happens once per athlete. This fires once per week
boundary instead. It's cheap to check every turn, but it only ever writes on the turn where the
date has actually rolled past the stored week's end - at most one turn every seven days.

**What stays CI-only:** `reconcile-current-week.mjs` (matching real activities against planned
sessions) needs to walk the entire `user_data/activities/hist/` directory. There's no equivalent
read path in coach-chat today - it's a local `fs` walk. Porting that is a heavier lift than this
plan's scope, so the CI-triggered reconcile step stays as-is, still running before rollover in
`sync.user.yml` whenever an activity sync happens. The lazy in-turn rollover is a backstop: it
guarantees the week *frame* itself is never more than one message stale, independent of whether
the athlete's phone has synced recently. It does not replace reconciliation.

**Coordination:** this adds a third writer of `current_week.json` - chat commits, CI reconciler,
CI rollover, and now lazy in-turn rollover. `needsRollover`'s check is idempotent (it compares
dates, it doesn't toggle a flag). Coach-chat's existing `commitFilesAtomic` already reads the
current HEAD fresh immediately before committing, and retries on a conflicting ref update - the
same safety property the CI job's own reset-and-rerun retry loop relies on. No locking is needed:
a race just means whichever writer's commit lands second reads the already-rolled-over file and
finds `needsRollover` false, so it's a no-op. This needs a new ADR
(`kdb/decisions/00XX-lazy-week-rollover-from-coach-chat.md`) narrowing ADR 0042. Keep 0042
Accepted - its "single write action" clause is specifically about the model-facing action-field
contract, and isn't violated here. Record this as the second/lazy writer, with its idempotency
argument written down, so nobody re-litigates the coordination question later.

## Phase 4 - second live-testing round (nothing deferred to a later pass)

1. Re-run the full simulation suite plus the Group-B all-5 pass, through the new `--all-repos`
   path with precondition checks active, against all 5 real repos.
2. The Phase 3 fix means any repo's week frame self-heals on its next turn - but frame is not the
   same as content. Have one real Weekly Kick-off Ritual conversation with Coach Phelps in a
   scratch branch on at least one real repo before this round. That gives
   `ambiguous-contradiction`'s reconcile scenario real planned sessions to contradict, the honest
   way, through the real pipeline, not synthetic seeding.
3. Confirm the new `"skipped-precondition"` status fires where expected - e.g. `quest-event` on
   `prateek`/`date2022`, which have no real habit quest, should skip cleanly with a reason.
4. Confirm the Phase 3 rollover fix live: pick a real repo, verify its week frame is stale first,
   send one ordinary turn, confirm `current_week.json`'s frame advanced in that turn's commit.
5. Produce a new day-doc (`test-results/<date>.md`) in house style, same as 2026-09-15's.

## Files touched

- New: `ui/scripts/lib/repoDataProfile.ts` + test.
- `ui/scripts/run-simulation-suite.ts` - preconditions, `--repo`/`--all-repos`, new scenarios.
- `ui/scripts/run-manual-coach-chat-test.ts` - precondition guard.
- New: coverage-index reconciliation script.
- `docs/eng-docs/coach-chat-testing.md`, `docs/eng-docs/coach-chat-test-scenarios.md`.
- `ui/api/coach-chat/_lib/coachTurn.ts` - lazy rollover check + write fold-in.
- New: a rollover decision-logic module shared between `rollover-current-week.mjs` and
  `coachTurn.ts`. Don't duplicate `needsRollover`/`buildRolloverPlaceholder` - extract them to a
  shared location both can import, likely alongside `engine/lib/current-week.mts`.
- `engine/.github/workflows/sync.user.yml`, `docs/ref-docs/current-week-contract.md` - ADR
  citation fix.
- New ADR: `kdb/decisions/00XX-lazy-week-rollover-from-coach-chat.md`.
- `ui/api/coach-chat/_tests/integration/coachTurn-workoutCreate.test.ts`, eval transcript `17`
  (timed-type exercise). A companion test for `engine/lib/current-week.mts` too (discipline enum
  rejection).

## Verification

- Unit tests for `repoDataProfile.ts` against fixture JSON shapes (placeholder vs populated week,
  0/1/many injury flags), and for the shared rollover decision-logic module (date-boundary
  cases).
- Dry-run `run-simulation-suite.ts --dry-run --all-repos` to confirm precondition skip logic
  fires without spending real API calls.
- Live-verify Phase 3's rollover fix and Phase 4's full run against real repos: read every
  non-obvious result by hand, don't trust the harness's own pass/fail alone. Same standard as
  2026-09-15.
- New day-doc reviewed against `kdb/test-doc-style.md` before merge.
