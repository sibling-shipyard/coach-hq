# Plan: harden the coach-chat test harness against unverified repo state

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16 · Tracking: #1105

## Context

None of the coach-chat test scripts (`ui/scripts/run-simulation-suite.ts`,
`ui/scripts/run-manual-coach-chat-test.ts`, `ui/scripts/lib/coverageIndex.ts`) check whether a
target athlete repo's data actually supports the scenario being run. A scenario's `expect` block
only checks *which files changed*, never whether the right precondition existed to change them
for the right reason. This has already produced a real false positive. The
`ambiguous-contradiction` scenario needs a real planned session in `current_week.json` to
contradict, but all 5 real athlete repos have an empty (`data_status: "placeholder"`) week plan,
so the turn fell back to a different write. That write satisfied a generic `expect` check and
would have scored a clean `pass` if a human hadn't manually read the diff.

Separately, the reason all 5 repos have an empty week plan is a real production gap, not a
testing artifact. `rollover-current-week.mjs` only runs as a step inside
`engine/.github/workflows/sync.user.yml`, which is triggered by the iOS app's own activity-sync
push - never by any schedule. An athlete who hasn't synced recently gets no rollover at all. 2 of
the 5 real repos (`coach-date2022`, `coach-prateekdevaraju`) are currently a full ISO week behind
- their week *frame* hasn't advanced, not just its content.

This plan fixes both: the test scripts (so a future run can't silently under-report what it
covered) and the rollover gap (so there's real week data to test against). **This doc covers the
fix work only.** The second live-testing round that follows once this lands is a separate doc:
`docs/plans/coach-chat-live-test-round-2.md`. Do not mix the two - a fresh agent picking up either
doc should be able to work from it alone.

Tracking issue: **#1105** ("Core: harden coach-chat test harness against unverified repo state").
Every PR in this doc's stack uses `Refs: #1105` - none of them close it. The issue closes on the
round-2 doc's finishing PR instead, once a live pass has actually verified all of this working.

## How to work this doc

This is a stack of independent-ish PRs grouped into three tracks (script fixes, scenario-content
fixes, the rollover fix). Tracks can be worked in parallel by different agents; PRs *within* a
track stack in the given order (branch off the previous PR in that track, not off `main`, per
`AGENTS.md` § Stacked PRs). A PR not marked "stacks on" branches directly off `main`. Every PR:
cut a worktree per `AGENTS.md` § Monorepo-Specific Rules, implement, `bash platform/scripts/check.sh
--quiet`, push, open PR with `Refs: #1105`, wait for green CI. Branch prefixes follow
`.github/CONVENTIONS.md` (`fix:`/`feat:` for Bob, `core:` for Tech Lead-owned pieces like the ADR
and doc drift).

## Track A - script fixes (repo data-readiness)

**A1 - `fix/1105-repo-data-profile`** (off `main`)
New `ui/scripts/lib/repoDataProfile.ts`. Given a local athlete repo path, read
`user_data/ledger/current_week.json`, `user_data/coach/injuries.json`,
`user_data/ledger/quests.json`, `user_data/coach/memory.json`, and the workout template
directory. Return a structured profile:
```ts
interface RepoDataProfile {
  currentWeek: { dataStatus: "placeholder" | "live"; sessionCount: number };
  injuries: { activeCount: number; resolvedCount: number };
  quests: { count: number; hasHabitQuest: boolean };
  coachingStyle: string | null;
  templateCount: number;
}
```
Pure read, no network calls, no git operations. Add `repoDataProfile.test.ts` covering: a
placeholder week (0 sessions), a live week with sessions, zero/one/many injury flags, and a repo
missing one of the input files entirely (should not throw - return the field's empty/null shape).

**A2 - `feat/1105-scenario-preconditions`** (stacks on A1)
In `ui/scripts/run-simulation-suite.ts`, extend the `Scenario` type with an optional
`preconditions` field, e.g.:
```ts
preconditions?: {
  currentWeekHasSessions?: boolean;
  injuryFlags?: "any" | "none";
  hasHabitQuest?: boolean;
};
```
Before running a scenario, call `repoDataProfile.ts` (from A1) against the scenario's target
repo and check its profile against `preconditions`. If unmet, do not call the model - record a
new `"skipped-precondition"` status in `coverage-index.json` (a status distinct from
`"pass"`/`"fail"`, alongside a `reason` string) via `writeCoverageEntry`. Apply the same check in
`run-manual-coach-chat-test.ts` before it sends any turn, so ad hoc/manual runs get the same
guard, not just the scenario-suite path. Add the `ambiguous-contradiction`,
`workout-lifecycle`/`template-edit-permanent` (injury-related), `quest-event`, and
`pattern-style-sport` scenarios' real preconditions now that the field exists (these are the
ones yesterday's pass found broken by unmet preconditions - see `test-results/2026-09-15.md` F1,
B1, B2).

**A3 - `feat/1105-all-repos-runner`** (stacks on A2)
Add `--repo <shortcut>` and `--all-repos` CLI flags to `run-simulation-suite.ts` (currently only
`--list`, `--only`, `--dry-run`, `--force`, `--branch` exist). `--repo` overrides a scenario's
hardcoded target repo for that invocation; `--all-repos` runs every scenario against all 5 real
athlete repos in `ATHLETE_REPOS` (from `run-manual-coach-chat-test.ts`), still going through
normal scoring and `coverage-index.json` bookkeeping. This replaces the ad hoc pattern used in
the 2026-09-15 pass, where the all-5 "Group B" run called `run-manual-coach-chat-test.ts`
directly per repo and never got scored or recorded.

**A4 - `fix/1105-coverage-index-reconciliation`** (off `main`, independent of A1-A3).
New script (e.g. `ui/scripts/check-coverage-reconciliation.ts`) that diffs
`test-results/coverage-index.json` against the raw run logs under
`test-results/raw/<date>/manual/` for a given date, and flags any run present in the raw logs
with no matching (or a stale) `coverage-index.json` entry. This is what would have caught the
2026-09-15 pass's F5 finding (3 lost coverage entries from a concurrent-write race) automatically
instead of a human noticing by hand. `writeCoverageEntry`'s per-key read-merge-write (already
fixed in #1076/#1077) stays as-is - this is a detection tool, not a new locking mechanism.

**A5 - `core/1105-doc-drift`** (off `main`, independent, Tech Lead-owned).
`docs/eng-docs/coach-chat-testing.md` names only 2 of the 5 real athlete repos in prose (`skanda`,
`akash`) - add the full roster, matching `ATHLETE_REPOS` in `run-manual-coach-chat-test.ts`
(`skanda`, `akash`, `date2022`, `prateek`, `shreyas`). Fix the ADR citation in
`engine/.github/workflows/sync.user.yml`'s header comment - it currently cites ADR 0039 (an
unrelated iOS ADR); the rollover/reconcile decision is actually ADR 0042. Check
`docs/ref-docs/current-week-contract.md` for the same wrong citation and fix it there too if
present.

## Track B - scenario-content fixes

Each of these is small and independent of the others; B1-B3 lightly depend on A2's
`preconditions` field existing if the new scenario needs to declare one, so stack B1-B3 on A2 if
A2 hasn't merged yet, otherwise off `main`. B4-B5 are fully independent of everything in Track A.

**B1 - `feat/1105-coach-note-assertion`**
Every action field except `coach_note` has a simulation scenario asserting its target file
actually changed. Add a `filesChangedInclude: ["user_data/coach/coach_log.json"]` assertion to
one existing ordinary-turn scenario in `run-simulation-suite.ts` that already exercises
`coach_note` implicitly (e.g. `daily-basic`), closing the one acknowledged gap in the coverage
matrix (`docs/eng-docs/coach-chat-test-scenarios.md` L148-152).

**B2 - `feat/1105-multi-field-success-scenario`**.
Add one new simulation scenario where two action fields succeed together in the same turn - e.g.
a message that both restructures the week (`week_update`) and edits an existing routine
(`template_edit`) in one go. Every existing multi-field integration test
(`fullTurnPipeline.test.ts`) only covers two fields *failing* together (a hallucinated
`template_id` alongside a valid write); nothing today proves two fields can both land correctly
in one commit.

**B3 - `feat/1105-compound-message-narration-probe`**
Add one new scenario using the same compound-message shape that broke `memory_update` (a durable
fact stated alongside an unrelated request, in one message) - but aimed at `template_edit`,
`session_plan`, `week_update`, and `workout_create` instead. `memory_update`'s drop on this shape
is an accepted known gap (issue tracked separately, not reopened here); this scenario checks
proactively whether the same narration-vs-action failure class exists on these four fields before
it's found live by accident.

**B4 - `fix/1105-discipline-enum-validation`**
No test (unit, integration, or eval) exercises `current_week.json`'s `discipline` enum
(`engine/lib/current-week.mts`) beyond one or two generic values (`"run"`). Add a unit test
confirming an unusual-but-valid value (`"badminton"`, `"hike"`) is accepted and an invalid value
is rejected by the schema validator. If the validator doesn't already reject invalid values,
that's a real bug to fix in the same PR, not just a missing test.

**B5 - `fix/1105-timed-exercise-coverage`**
`coachTurn-workoutCreate.test.ts` and eval transcript `17` only ever use a `reps`-type exercise.
Add a `timed`-type exercise (with `duration_secs`) to both, so exercise-type handling is
exercised end to end through the integration/eval path, not just at the `workoutSchema.ts` unit
level (`exerciseTypeFieldViolation`).

## Track C - the rollover fix

This is the one behavior change with real production impact, and the one track that must stay
strictly sequential - each PR depends on the previous one.

**C1 - `core/1105-rollover-shared-module`** (off `main`).
`rollover-current-week.mjs`'s decision logic - `needsRollover` (compares today's date against
`current_week.json`'s `end_date`/staleness) and `buildRolloverPlaceholder` (builds the fresh
empty-week frame) - is pure. It has no dependency on the local git checkout, only on the file's
parsed content and today's date. Extract both functions into a shared module importable from
both `engine/scripts/rollover-current-week.mjs` and (in C3) `ui/api/coach-chat/_lib/coachTurn.ts`.
Put it alongside `engine/lib/current-week.mts`, since that's where `parseCurrentWeek` already
lives and is already bundled for the Vercel function
(`ui/scripts/bundle-current-week-api.mjs` → `ui/api/coach-chat/_lib/current-week.bundle.js`).
Refactor `rollover-current-week.mjs` to import from the shared module instead of defining these
functions locally. Pure refactor - no behavior change. Verify by confirming the CI-run rollover
step still no-ops/rolls-over identically on the same test fixtures as before.

**C2 - `core/1105-lazy-rollover-adr`** (stacks on C1, Tech Lead-owned).
New ADR `kdb/decisions/00XX-lazy-week-rollover-from-coach-chat.md`, narrowing ADR 0042. Keep 0042
Accepted - its "single write action" clause is specifically about the model-facing action-field
contract, not about how many code paths may write the file. Record: this adds a third writer of
`current_week.json` - chat commits, CI reconciler, CI rollover, and now a lazy in-turn rollover
check. The coordination argument: `needsRollover` is idempotent (a date comparison, not a toggled
flag), and coach-chat's existing `commitFilesAtomic` (`ui/api/_lib/githubGitData.ts`) already
reads the current HEAD fresh immediately before committing, and retries on a conflicting ref
update. A race between the CI job and the lazy check just means whichever commit lands second
reads the already-rolled-over file and finds `needsRollover` false - a no-op, no locking needed.

**C3 - `feat/1105-lazy-rollover-in-turn`** (stacks on C2).
Add the lazy, same-turn rollover check to `ui/api/coach-chat/_lib/coachTurn.ts`, modeled directly
on the existing `coach_since` pattern (ADR 0018, `coachSinceStamp.ts`'s
`injectCoachSinceIfNeeded`). It's checked on every turn, but only ever writes on the real
transition turn, folding the write into that turn's existing `commitFilesAtomic` call rather than
opening a second write path. Concretely: in `loadTurnState` (where `today`/`timezone` are already
resolved), read `current_week.json` fresh, and run the shared module's `needsRollover` from C1.
If true, add the `buildRolloverPlaceholder` result to that turn's outgoing write set, the same
way `injectCoachSinceIfNeeded`'s result is folded in today (`coachTurn.ts` around L2096-2105). Add
unit tests for the date-boundary cases: week not yet stale, week exactly at `end_date`, week
several weeks stale, and malformed/unparseable `current_week.json` (should no-op, not throw,
matching `rollover-current-week.mjs`'s own existing no-op-on-invalid behavior).

## Files touched (by track)

- Track A: `ui/scripts/lib/repoDataProfile.ts` (new) + test, `ui/scripts/run-simulation-suite.ts`,
  `ui/scripts/run-manual-coach-chat-test.ts`, a new coverage-reconciliation script,
  `docs/eng-docs/coach-chat-testing.md`, `engine/.github/workflows/sync.user.yml`,
  `docs/ref-docs/current-week-contract.md`.
- Track B: `ui/scripts/run-simulation-suite.ts` (new scenarios),
  `ui/api/coach-chat/_tests/coach-chat-eval/transcripts/17-workout-create.json`,
  `ui/api/coach-chat/_tests/integration/coachTurn-workoutCreate.test.ts`,
  `engine/lib/current-week.mts` + a companion test.
- Track C: `engine/scripts/rollover-current-week.mjs`, a new shared rollover-logic module (likely
  under `engine/lib/`), `ui/api/coach-chat/_lib/coachTurn.ts`,
  `kdb/decisions/00XX-lazy-week-rollover-from-coach-chat.md`.

## Verification

- A1: unit tests against fixture JSON shapes (placeholder vs live week, 0/1/many injury flags,
  missing files).
- A2/A3: `run-simulation-suite.ts --dry-run --all-repos` confirms precondition-skip logic fires
  without spending real API calls.
- C1: confirm `rollover-current-week.mjs`'s existing behavior is unchanged against its current
  test fixtures after the extraction.
- C3: unit tests for every date-boundary case listed above; live-verify in the round-2 pass (see
  `docs/plans/coach-chat-live-test-round-2.md`) by picking a real repo with a stale week frame,
  sending one ordinary turn, and confirming the frame advances in that turn's commit.
- Every PR: `bash platform/scripts/check.sh --quiet` green before push, per `AGENTS.md`.
