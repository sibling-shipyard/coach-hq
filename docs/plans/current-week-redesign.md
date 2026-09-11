# Current Week: redesign

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-11 · Issue: #973
>
> Evidence and file references live in
> [`current-week-redesign-lld.md`](current-week-redesign-lld.md).

## Context

The model writes `current_week.json` through three separate actions that silently drop each
other, owns a lifecycle it never actually uses, and is the only thing that ever refreshes the
file. Miss a day of chat and the week goes dark. Full findings in the LLD.

## Recommendation: code owns the frame, Coach owns intent and exceptions

**One action instead of three.** Replace `week_plan` / `session_reconcile` / `plan_edit` with a
single `week_update` the model sends as a sparse patch: only the days or sessions that changed.
"Swap tomorrow's badminton for football" becomes one entry with a date, not two actions racing to
overwrite each other. Code fills in everything mechanical: session ids, week bounds, `status`
defaults.

**A closed set of sports, not free text.** The model writes any string it wants for `discipline`
today. The UI fuzzy-matches it back onto a fixed list with fifteen substring checks, falling
through to `"other"` when nothing matches. Constrain the model to the athlete's own sports plus a
fixed set. This also unblocks sport-agnostic Home widgets (#314).

**Reconciliation moves to code.** Rules run automatically when an activity syncs: a match to a
planned day marks it done, a planned day with nothing logged becomes missed, an unmatched activity
attaches as unplanned. Coach only gets asked when two sessions could plausibly match, or an
activity landed a day off from plan - the ambiguous cases, not every sync.

**A scheduled rollover, not a chat-triggered one.** A job in the sync pipeline advances the week
on its own. An athlete who doesn't chat on Monday still has a real week Tuesday morning.

**Drop the fields nothing uses.** The consumer audit in the LLD is done. `planned_load` has no
writer anywhere that ever sets it to a real value. `coach_comments` is written `[]` on every plan
and never touched again. `draft` is structurally unreachable, since this pipeline has no
multi-turn confirm flow to put it in. `placeholder` and `live` stay - both are real, reachable
states.

**One schema authority.** `engine/lib/current-week.mts` becomes the only source of truth. The
separate contract doc is generated from it or retired - the two have already drifted once.

This is a locked-decision change, so it's recorded as ADR 0042, not just this plan.

## Done when

- `week_update` replaces the three actions, and a same-turn combo (mark done + edit tomorrow) is
  one call, not two.
- `discipline` is a closed enum end to end; `currentWeekAdapter.ts`'s substring matching is
  deleted.
- Every §5-style reconciliation rule (`workouts-redesign-lld.md`) has a test that fails when
  violated.
- A quiet week with no chat still shows a real plan the next morning.
- Every dropped field has a written consumer audit before removal - done, see the LLD.
- Full local gate green, `test/close-verification` in `coach-skanda-2003` live-tested before this
  is called done.

## Alternatives considered

**Shrink the model's surface, leave the file alone.** Same action collapse and reconciliation
move, same rollover job, but no changes to stored fields. Cheapest and fully reversible - no
consumer audit, no migration. Leaves the dead fields, the drifted contract doc, and the free-text
discipline in place for a later pass. Worth taking if the schema cleanup needs to be a separate,
later landing.

**Code compiles the week outright.** The model sets only weekly focus and exceptions ("no
badminton Thursday, traveling"); code builds the seven-day frame from season and block intent plus
a stored availability pattern. The smallest possible model surface, and the natural destination -
the sparse `week_update` patch above is exactly how exceptions get expressed once this lands. Not
recommended as the first move: it depends on training blocks existing in `seasons.json`, which
don't yet.

## Deferred

- Training blocks in `seasons.json` - needed for the "code compiles the week" alternative above.
- iOS rendering of Current Week at all - nothing reads it there today; this lands on web first.
