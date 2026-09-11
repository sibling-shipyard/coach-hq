# Current Week: evidence

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-11 · Issue: #727
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
| 9 | Two schema authorities drifted. The golden dataset carries `week.status` and `days[].day`, removed by the contract, and omits the `timezone` it requires | `shared/golden-dataset/current_week.json` |
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
| `platform/scripts/carve-skeleton.mjs` | The seeded placeholder week - bring it into contract (finding 9). |
| `shared/golden-dataset/current_week.json` | Currently out of contract - fix alongside the schema change. |
| new: a sync-pipeline job | The scheduled rollover. |

## Validation

- Consumer audit before any field drop: a written list naming every reader of `planned_load`,
  `coach_comments`, and the `draft` status, checked against the files above.
- Unit tests on `current-week.mts` for the merged `week_update` applier and the closed enum.
- Reconciliation: every row of the table above covered by a test that fails when violated.
- Replay one athlete's real kick-off, sync, and a missed day through the new path offline; check
  against what actually happened.
- Live-test on `test/close-verification` in `coach-skanda-2003` before calling any chat change
  done.
- `npm run eval:coach-chat` once after the soul change, not per PR (ADR 0024).
- `bash platform/scripts/check.sh --quiet` after committing - the prose gates read the committed
  diff.
