# 0042 — `current_week.json` collapses to one write action, code owns reconciliation and rollover

- **Status:** Accepted · 2026-09-11 · Tech Lead
- **Area:** cross-cutting (coach-chat backend, SOUL, web)
- **Context:** `current_week.json` is written through three action fields -
  `week_plan`, `session_reconcile`, `plan_edit` - that don't know about each other.
  `weekWrite.ts:32-46` drops the second and third silently with a `console.warn` when
  they fire in the same turn as `week_plan`. So the prompt teaches the model to split
  an ordinary edit like "swap tomorrow's badminton for football" into two separate
  action-field entries (`coachPromptText.ts:213-221`) instead of writing one. The file
  also only ever refreshes when the model writes it - miss a day of chat and the week
  goes `stale` after one grace day (`current-week.mts:562-564`). Full findings in
  `docs/plans/current-week-redesign-lld.md`.
- **Decision:** Replace the three action fields with one, `week_update`, sent as a
  sparse per-day/per-session patch. Code fills in every mechanical field. Move
  reconciliation (matching a synced activity to a planned session) out of the model
  into a deterministic rules pass that only asks Coach about genuinely ambiguous rows.
  Add a scheduled rollover job to the sync pipeline so the week advances on its own.
  Drop `planned_load`, `coach_comments`, and the `draft` half of `data_status` from the
  schema once each clears the consumer audit in the LLD.
- **Why:** This is the same principle already proven for workouts, applied to the
  week. `docs/plans/workouts-redesign.md` calls it "Coach writes exercises, code
  writes timer physics." The model should express intent and exceptions, not own
  routing between competing write paths or drive a lifecycle nothing else reads.
- **Rejected:** Leave the three actions and only add validation to stop the silent
  drop → treats the symptom, the routing puzzle itself is the defect. Keep `draft` and
  teach the model to use it → no second confirmation turn exists in this pipeline's
  single-turn action-field shape, so a genuine draft state is unreachable regardless.
- **Enforces:** Any future action field touching `current_week.json` extends
  `week_update`'s patch shape rather than adding a fourth competing action. A field
  reintroduced into the schema later needs a wired writer in the same PR, not a
  contract entry nothing populates - see 0038 for the same rule applied to
  `coaching_style`.
