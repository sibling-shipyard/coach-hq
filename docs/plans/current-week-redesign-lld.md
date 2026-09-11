# Current Week: evidence

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-11 · Issue: #973
>
> Drill-down for [`current-week-redesign.md`](current-week-redesign.md). Every claim checked
> against `main` at 94f0965 on 2026-09-11.

## Findings

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
| 9 | Correction (PR2 of this stack): re-checked directly, and this is not drift. The golden dataset file is pre-shaped as the web widget's `CurrentWeekContract` (`goldenDataset.ts:22` casts it directly), a different, intentionally separate type from the engine's raw `CurrentWeek`. It's never run through `parseCurrentWeek`. The actual seeded file - `carve-skeleton.mjs`'s `CURRENT_WEEK_TEMPLATE`, what a real new athlete repo gets - was already in contract, verified clean against `parseCurrentWeek` directly. | `ui/client/src/lib/goldenDataset.ts:22`, `platform/scripts/carve-skeleton.mjs:130-155` |
| 10 | A dead instruction. The soul tells the model to read `propagated/docs/current-week-contract.md`, but the hosted model has no file access | `platform/SOUL.chat.md:175` |
| 11 | UI internals leak into the prompt to justify reconciling | `platform/soul/B_engine.md:294` |
| 12 | iOS renders no week. `grep current_week ios/` returns nothing | `ios/` |

Finding 7 is also why Home widgets are not sport-agnostic (#314).

## Reconciliation rules (adapted from Akash's workouts plan, §5, for this file)

| Situation | Result |
|---|---|
| Activity on a planned day, type matches | `done`, completion id appended |
| Planned day passes, no matching activity | `missed` - not `skipped`, skipping is a decision |
| Activity with no planned match | attached to the day as unplanned |
| Two candidates, or an activity a day either side | stays `planned`, flagged to Coach |

Coach sees only the flagged rows. A self-adjustment (athlete moves Tuesday to Thursday without
saying so) reads as a missed anchor plus an orphan unless Coach sets `original_date` on the one
real moved session.

## Consumer audit (gates the field drops in ADR 0042)

Checked against `main` at 94f0965, real consumers only (`node_modules` excluded).

| Field | Every consumer | Verdict |
|---|---|---|
| `planned_load` | Written `null` at plan time (`coachWeekFiles.ts:208`, comment: "computed later from actual completions"). `applySessionReconcile` and `applyPlanEdit` never touch it - grepped both functions, no assignment. `currentWeekAdapter.ts:154` reads it straight through to the UI type. `liveWeekContract.ts:86` writes a placeholder `null`. No path ever computes the "later" the comment promises. | **Drop.** No writer sets it to a real value anywhere in the pipeline; the promised completion-time computation was never built. |
| `coach_comments` | `coachWeekFiles.ts:249` writes `[]` on every `week_plan`, with its own comment: "Dropped from the write path entirely per the plan's explicit go-ahead." `applySessionReconcile` spreads the array through unchanged. `currentWeekAdapter.ts:127-257` still maps it to a UI `CoachComment` type, and `warmHomeModel.ts:195-197` still has a lookup function for it. | **Drop the schema field and the write-side type.** The array can never hold anything after `week_plan` writes it once. Keep the read-side UI type only if a future non-hosted writer needs it - none does today, so drop both. |
| `data_status: "draft"` | `coachWeekFiles.ts:131-139` documents this is deliberate, not an oversight: the pipeline has no multi-turn confirm flow, so `draft` is structurally unreachable from any writer. `current-week.mts:550-551` and `B_engine.md:13` both still branch on it as a real state (placeholder-style "not yet available" messaging). `carve-skeleton.mjs` seeds `placeholder`, not `draft`, at signup. | **Drop `draft` from the writable enum, keep `placeholder` and `live`.** `placeholder`/`live` are both real, reachable states (carve seeds `placeholder`, the model writes `live`); `draft` has zero writers and exists only as unreachable enum surface plus one soul branch and one availability-machine branch that never fire. |

None of the three needed a schema migration for existing data. `planned_load` and `coach_comments`
are already always their zero value (`null` / `[]`) in every live athlete's file, and no live file
has ever reached `data_status: "draft"` since a writer never emits it. Removing them from the type
changes no stored value, only what future writes are allowed to contain.

## Files touched

| File | Why |
|---|---|
| `engine/lib/current-week.mts` | Strict parser and availability machine. Becomes the single schema authority. |
| `docs/ref-docs/current-week-contract.md` | The second authority today. Generate it from the type, or delete it. |
| `engine/scripts/validate-current-week` | The coach-write gate. |
| `ui/api/coach-chat/_lib/gemini/coachReplySchema.ts` | The three week actions collapse into `week_update`. |
| `ui/api/coach-chat/_lib/gemini/coachPromptText.ts` | The routing prose that teaches the two-action combo. |
| `ui/api/coach-chat/_lib/decide/coachWeekFiles.ts` | `applyWeekPlan`, `applySessionReconcile`, `applyPlanEdit` merge into one applier. |
| `ui/api/coach-chat/_lib/decide/turnWrites/weekWrite.ts` | The silent-drop collision. |
| `ui/api/coach-chat/_lib/decide/turnWrites/validateActions.ts` | The established home for pre-write invariant checks, reuse it. |
| `platform/soul/B_engine.md` | Weekly Kick-off Ritual, Weekly Contract Safety, the `draft`/`live` instruction. Compose with `platform/scripts/compose-soul.mjs`, commit the layer and both builds, add a `SOUL_HISTORY.md` entry. Never hand-edit a composed build. |
| `ui/client/src/components/home-warm/currentWeekAdapter.ts` | The substring ladder. |
| `ui/client/src/components/home-warm/liveWeekContract.ts`, `warmHomeModel.ts` | Consumers of the adapter output. |
| `platform/scripts/carve-skeleton.mjs` | Already in contract (finding 9 correction); drop `coach_comments` from `CURRENT_WEEK_TEMPLATE` to match the trimmed schema. |
| new: a sync-pipeline job | The scheduled rollover. |

## Validation

- Consumer audit: done, see above, ADR 0042.
- Unit tests on `current-week.mts` for the merged `week_update` applier and the closed enum.
- Reconciliation: every row of the table above covered by a test that fails when violated.
- Replay one athlete's real kick-off, sync, and a missed day through the new path offline; check
  against what actually happened.
- Live-test on `test/close-verification` in `coach-skanda-2003` before calling any chat change
  done.
- `npm run eval:coach-chat` once after the soul change, not per PR (ADR 0024).
- `bash platform/scripts/check.sh --quiet` after committing - the prose gates read the committed
  diff.
