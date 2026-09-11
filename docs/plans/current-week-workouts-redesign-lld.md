# Current Week and Workouts: evidence

> Status: Options · Owner: Tech Lead · Created: 2026-09-11 · Issue: #727
>
> Drill-down for [`current-week-workouts-redesign.md`](current-week-workouts-redesign.md).
> Every claim here was checked against `main` at 94f0965 on 2026-09-11.

## 1. Current Week findings

| # | Finding | Evidence |
|---|---|---|
| 1 | Three week actions collide. `week_plan` firing with `session_reconcile` or `plan_edit` drops the others with a `console.warn` | `ui/api/coach-chat/_lib/decide/turnWrites/weekWrite.ts:32-46` |
| 2 | The prompt teaches a two-action combo. A swap is "normally TWO entries in the same turn" across two fields | `ui/api/coach-chat/_lib/gemini/coachPromptText.ts:213-221` |
| 3 | Moving a session needs a full week rewrite. `plan_edit` has no date field and `week_plan` is a seven-day replace | `ui/api/coach-chat/_lib/gemini/coachReplySchema.ts:251-337` |
| 4 | `draft` is never written. `applyWeekPlan` hardcodes `"live"`, yet the soul still instructs the model to use `draft` | `coachWeekFiles.ts:127-138`, `platform/soul/B_engine.md:240` |
| 5 | `planned_load` is always null. The contract specifies a zone-weighted formula, the response schema has no field for it | `docs/ref-docs/current-week-contract.md`, `coachReplySchema.ts:251-288` |
| 6 | `coach_comments` cannot be written by the hosted pipeline at all. Only the Claude Code coach can | `coachWeekFiles.ts`, `weekWrite.ts` |
| 7 | Free-text `discipline` is collapsed back onto a closed enum by fifteen substring checks, falling through to `"other"` | `ui/client/src/components/home-warm/currentWeekAdapter.ts:52-88` |
| 8 | Nothing but the model writes the week. One day of grace, then `stale` and unavailable | `engine/lib/current-week.mts:562-564` |
| 9 | Two schema authorities drifted. The golden dataset carries `week.status` and `days[].day`, which the contract removed, and omits the `timezone` it requires | `shared/golden-dataset/current_week.json` |
| 10 | A dead instruction. The soul tells the model to read `propagated/docs/current-week-contract.md`, but the hosted model has no file access | `platform/SOUL.chat.md:175` |
| 11 | UI internals leak into the prompt to justify reconciling | `platform/soul/B_engine.md:294` |
| 12 | iOS renders no week. `grep current_week ios/` returns nothing | `ios/` |

Finding 7 is also why Home widgets are not sport-agnostic (#314).

## 2. First Session findings

- **No week is written.** Step 5 only asks whether the athlete wants a week plan or just to talk
  (`platform/soul/B_engine.md`, `s10_first_session_transition`). The only week writer is
  `buildCurrentWeekWrite`, driven by a later conversation.
- **The template dump is automatic.** On the profile-complete transition,
  `generateTemplatesAfterCompletion` calls `generateInitialTemplates`, which scores 4-6 library
  entries and commits them (`ui/api/coach-chat/_lib/coachTurn.ts:1270-1300`,
  `decide/coachWorkoutFiles.ts:404-467`). This is bug 1.
- **The carved templates are orphaned.** Carve ships `foundation.json` and `strength_a.json`
  (`platform/scripts/carve-skeleton.mjs`), but `_manifest.json` does not list them, and
  the manifest is what every write path validates against (`validTemplateIdsFromManifest`). They
  are invisible to `template_edit` and `session_plan`.
- **No structured availability.** `MEMORY_NOTE_LABELS` has no frequency or schedule field
  (`decide/coachMemoryFiles.ts:28-35`). Intake asks how often they train; the answer lands as prose
  in `fitness_baseline`.

What a compiler would need, and where it already is:

| Input | Source today |
|---|---|
| Sports | `memory.json.sports[]` |
| Injuries | `injuries.json` flags |
| Goal and shape | `seasons.json` plus `quests.json.main_quest` (`type`, `target`) |
| Workouts to draw from | `shared/workout-library/index.json`, tagged by sport, equipment, goal, level |
| Recent volume | `gen/athlete_insights.json`, history-only |
| Days per week and which days | **Missing** |

## 3. Defects in `workouts-season-model.md`

| Defect | Why it matters |
|---|---|
| The HLD §8 table and its commit-rule paragraph mandate an own `commitFilesAtomic` and cite a retracted argument. The LLD §4 explicitly retracts both | Highest risk in the pair. An agent is told to read both, and §8 is the row it is pointed at |
| "No `isPluginEnabled` reader exists, grepped the whole repo" is false. It is at `engine/lib/plugins.mjs:28` and line 51 already calls it for badminton | Invents Stack B work, and undercuts the other verification claims |
| iOS paths omit the doubled directory. Real paths are `ios/CoachHQ/CoachHQ/Services/WorkoutService.swift` and `.../Views/WorkoutListView.swift` | An agent following §2b will not find the files |
| `B_engine.md:36` no longer points at the season-shape sentence the storage argument rests on | The §4 citation does not resolve |
| §4 refuses to slim `current_week.json` | Blocks the Current Week work directly |
| The reconciler (B3) and the non-chat week roll (B4) sit behind the Stack B gate | Neither depends on the churn question that gates B, and B4 fixes the dark week |
| #727's done-when requires a widget both stacks cut | The issue cannot close as written |
| `scaling-plan.md` is cited without a path. It is in `docs/eng-docs/`, not `docs/plans/` | A reader assumes a sibling |

**What to keep.** §2 ("Coach writes exercises, code writes timer physics"), §5 ("Rules always,
Coach only on a flagged row") and §7 (the invariant table) are right and should be adopted as
written. §5's reconciliation table is the model the week needs too.

**Execution state.** Nothing has landed. A repo-wide grep for `workout_create`, `compileWorkout`,
`buildWorkoutCreateWrite`, `applyWorkoutCreate`, `injury_ack` and `selectWorkoutsPage` hits only the
two plan documents. #732 and #733 conflict with `main`; #734 is mergeable. All three last moved
2026-08-31.

## 4. Files each milestone touches

**Week contract and validation**
- `engine/lib/current-week.mts` - strict parser and availability machine. The intended single authority.
- `docs/ref-docs/current-week-contract.md` - the second authority. Generate it or delete it.
- `engine/scripts/validate-current-week` - the coach-write gate.

**Backend write path**
| File | Why |
|---|---|
| `_lib/gemini/coachReplySchema.ts` | The three week actions. |
| `_lib/gemini/coachPromptText.ts` | The routing prose. |
| `_lib/decide/coachWeekFiles.ts` | `applyWeekPlan`, `applySessionReconcile`, `applyPlanEdit`. |
| `_lib/decide/turnWrites/weekWrite.ts` | The silent-drop collision. |
| `_lib/decide/turnWrites/validateActions.ts` | The established home for pre-write invariant checks. Reuse it. |
| `_lib/decide/coachWorkoutFiles.ts` | `generateInitialTemplates`, `selectTemplates`, the manifest. |

All six are under `ui/api/coach-chat/`.

**Soul.** `platform/soul/B_engine.md` holds the week rules, Timer Physics and First Session. Compose
with `platform/scripts/compose-soul.mjs`, commit the layer and both builds, add a `SOUL_HISTORY.md`
entry. Never hand-edit a composed build.

**Web.** `ui/client/src/components/home-warm/currentWeekAdapter.ts`, `liveWeekContract.ts`,
`warmHomeModel.ts`, `ui/client/src/pages/Workouts.tsx`.

**Seed and carve.** `platform/scripts/carve-skeleton.mjs`, `shared/workout-library/index.json`,
`shared/golden-dataset/current_week.json`.

## 5. How each milestone is validated

| Milestone | Evidence required |
|---|---|
| 0 audit | A written list naming every consumer of every field proposed for removal. No drop without it |
| 1 contract | `engine/lib/current-week.mts` tests; the golden dataset brought back into contract |
| 2 reconciler | Every row of `workouts-season-model.md` §5 covered by a test that fails when violated |
| 3 create path | A byte-identical golden fixture, plus a dry run across all four live repos with every diff explainable line by line |
| 4 first session | Carve a scratch repo, complete First Session, confirm a benchmark and a compiled first week with no template dump |
| 5 web | `ui-tests.yml` green |
| 6 iOS | `ios-build.yml` green |

Cross-cutting: replay one athlete's real kick-off, sync and missed day through the new path offline
and check against what actually happened. Live-test coach-chat on `test/close-verification` in
`coach-skanda-2003` before calling any chat change done. Run `npm run eval:coach-chat` once after
the soul change, not per PR (ADR 0024). Run `bash platform/scripts/check.sh --quiet` after
committing, since the prose gates read the committed diff.
