# Workouts: evidence

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-11 · Issue: #727
>
> Drill-down for [`workouts-redesign.md`](workouts-redesign.md). Every claim checked against
> `main` at 94f0965 on 2026-09-11. `workouts-season-model.md` (Akash's plan) is read and critiqued
> here, never edited.

## First Session findings

- **No week is written.** First Session's closing step only asks whether the athlete wants a week
  plan or just to talk (`platform/soul/B_engine.md`, `s10_first_session_transition`). The only
  week writer is `buildCurrentWeekWrite`, driven by a later conversation.
- **The template dump is automatic.** On the profile-complete transition,
  `generateTemplatesAfterCompletion` calls `generateInitialTemplates`, which scores 4-6 library
  entries and commits them (`ui/api/coach-chat/_lib/coachTurn.ts:1270-1300`,
  `decide/coachWorkoutFiles.ts:404-467`). This is bug 1.
- **The carved templates are orphaned.** Carve ships `foundation.json` and `strength_a.json`
  (`platform/scripts/carve-skeleton.mjs`), but `_manifest.json` doesn't list them, and the
  manifest is what every write path validates against (`validTemplateIdsFromManifest`). They're
  invisible to `template_edit` and `session_plan`.
- **No structured availability.** `MEMORY_NOTE_LABELS` has no frequency or schedule field
  (`decide/coachMemoryFiles.ts:28-35`). Intake asks how often they train; the answer lands as prose
  in `fitness_baseline`.

What a first-week compiler needs, and where it already is:

| Input | Source today |
|---|---|
| Sports | `memory.json.sports[]` |
| Injuries | `injuries.json` flags |
| Goal and shape | `seasons.json` plus `quests.json.main_quest` (`type`, `target`) |
| Workouts to draw from | `shared/workout-library/index.json`, tagged by sport, equipment, goal, level |
| Recent volume | `gen/athlete_insights.json`, history-only |
| Days per week and which days | **Missing** |

## Defects in `workouts-season-model.md` (not edited, only read)

| Defect | Why it matters |
|---|---|
| The HLD §8 table and its commit-rule paragraph mandate an own `commitFilesAtomic` and cite a retracted argument. The LLD §4 explicitly retracts both | Highest risk in the pair - an agent is told to read both, and §8 is the row it's pointed at |
| "No `isPluginEnabled` reader exists, grepped the whole repo" is false. It's at `engine/lib/plugins.mjs:28`, and line 51 already calls it for badminton | Invents Stack B work, undercuts the other verification claims |
| iOS paths omit the doubled directory. Real paths are `ios/CoachHQ/CoachHQ/Services/WorkoutService.swift` and `.../Views/WorkoutListView.swift` | An agent following §2b won't find the files |
| `B_engine.md:36` no longer points at the season-shape sentence the storage argument rests on | The §4 citation doesn't resolve |
| §4 refuses to slim `current_week.json` | Blocks the Current Week redesign directly |
| The reconciler (B3) and the non-chat week roll (B4) sit behind the Stack B gate | Neither depends on the churn question that gates B, and B4 fixes the dark week |
| #727's done-when requires a widget both stacks explicitly cut | The issue can't close as written |
| `scaling-plan.md` is cited without a path. It's in `docs/eng-docs/`, not `docs/plans/` | A reader assumes a sibling |

**What to keep, unedited.** §2 ("Coach writes exercises, code writes timer physics"), §5 ("Rules
always, Coach only on a flagged row"), §7 (the invariant table). Reused as guidance here, not
changed in his file.

## PR triage detail

Checked directly with `gh pr view`/`gh pr diff` and a scratch three-way merge against `main`, not
by title or by the plan's own claims.

**#732 - `feat/727-compile-workout`.** 10 files, +812/-3. Touches only
`engine/lib/compileWorkout.mts` (+tests, golden fixtures), `engine/scripts/compile-dryrun.mts`,
and CI wiring (`ui/vitest.config.ts`, `.github/workflows/ui-tests.yml` path filter). The only
conflict against current `main` is 7 lines in `workouts-stack-a-lld.md`, a table-row edit on both
sides. No dependency on `current_week.json` anywhere in the diff. **Rebase, keep.**

**#733 - `feat/727-workouts-day-view`.** 7 files, +1390/-105. Adds `ui/client/src/lib/
workoutPage.ts` and rewrites `ui/client/src/pages/Workouts.tsx` into the three-band layout. Both
new files import `parseCurrentWeek` and read `CurrentWeekSession` fields directly - checked in the
PR's diff, not against `main`, since the file doesn't exist there yet. Conflict against `main` is
37 lines across two hunks in `Workouts.tsx`, from unrelated
changes landing there since Aug 31 - mechanical, not a design clash, but real. **Close as a merge
candidate, keep the branch as reference** for the selector shape and CSS once the new week
contract lands.

**#734 - `feat/ios-727-workouts-day-view`.** 3 files, +763/-38, mergeable with no conflict. Adds a
hand-rolled Swift `parseCurrentWeek` in `WorkoutService.swift` that reads the same fields as #733.
**Close as a merge candidate, keep as reference** - same schema dependency, and iOS is sequenced
after web regardless.

## Files touched

| File | Why |
|---|---|
| `engine/lib/compileWorkout.mts` (from #732, rebased) | The compiler - spec in, timer-ready JSON out |
| `ui/api/coach-chat/_lib/gemini/coachReplySchema.ts` | New `workout_create` action |
| `ui/api/coach-chat/_lib/gemini/coachPromptText.ts` | Prompt text for the create path |
| `ui/api/coach-chat/_lib/decide/coachWorkoutFiles.ts` | `generateInitialTemplates` → benchmark generation; new applier for `workout_create` |
| `ui/api/coach-chat/_lib/decide/turnWrites/validateActions.ts` | Invariant checks: progression id exists, dose within benchmark, injury flags addressed |
| `platform/soul/B_engine.md` | First Session benchmark step; compose + both builds + `SOUL_HISTORY.md` entry, never hand-edit a composed build |
| `platform/scripts/carve-skeleton.mjs` | Fix the orphaned-template manifest gap |
| `shared/workout-library/index.json` | Already tagged by sport, equipment, goal, level - the input the benchmark selector reads |

## Validation

| Stage | Evidence required |
|---|---|
| Compiler | Byte-identical golden fixture, plus a dry run across all four live repos with every diff explainable line by line |
| Reconciler | Every row of the reconciliation table (see `current-week-redesign-lld.md`) covered by a test that fails when violated |
| First Session | Carve a scratch repo, complete First Session, confirm a benchmark and a compiled first week, no template dump |
| Web | `ui-tests.yml` green |
| iOS | `ios-build.yml` green, once web lands |

Cross-cutting: live-test on `test/close-verification` in `coach-skanda-2003` before calling any
chat change done. `npm run eval:coach-chat` once after the soul change, not per PR (ADR 0024).
`bash platform/scripts/check.sh --quiet` after committing.
