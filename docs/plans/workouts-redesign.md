# Workouts: redesign

> Status: Proposal · Owner: Tech Lead · Created: 2026-09-11 · Issue: #727
>
> Evidence and file references live in
> [`workouts-redesign-lld.md`](workouts-redesign-lld.md).
>
> **`workouts-season-model.md` and its LLD are left untouched.** That plan is Akash's. This is a
> parallel review of it, not an edit - the two get reconciled once he's seen this.

## Context

There is no path for the model to create a new workout, only to edit or pick from ones that
already exist. Onboarding compensates by auto-picking 4-6 library templates for every new
athlete. Two of four live athletes filed bugs about this in one week. One got "a lot of random
workouts" they never asked for. The other was told Coach "could not" build an upper-body workout
because no template existed for it.

## Recommendation: keep the architecture, re-cut the stacks

Akash's plan gets the shape right and should stay the foundation:

- **Coach writes exercises, code writes timer physics.** The model sends a spec - exercise names,
  sets/reps, a form cue, why - and a compiler fills in rest times, numbering, and phase duration
  deterministically.
- **Rules always, Coach only on a flagged row** for reconciliation - the same pattern recommended
  for Current Week.
- **The invariant table** - a progression id must exist before it's referenced, a starting dose
  never exceeds the benchmark, an active injury flag must be addressed before a routine ships.
  Enforced in code, not asked of the model in prose.

Three changes to how it's sequenced:

1. **Pull the reconciler and the non-chat weekly roll out of the gated "Stack B."** Neither one
   depends on the open question Stack B is gated on: whether a routine holds steady week to week,
   or churns. The weekly roll is also the direct fix for Current Week going dark.
2. **Promote the First Session benchmark**, and add one new piece: a structured
   `memory.json.availability` field (`days_per_week`, `preferred_days`). Sports, injuries, the
   goal, and a tagged workout library are already captured at intake. Availability is the one
   missing input for compiling an athlete's real first week, not just a benchmark session.
3. **Fix the plan's own defects before anyone executes it** - see the LLD for the full list. The
   sharpest one: the high-level doc and its own low-level doc contradict each other on how the
   create action commits. An agent following the standard "read your PR's row" instruction lands
   on the stale half.

## What to do with #732, #733, #734

Three PRs from Aug 31 already exist against the old plan. I checked each directly rather than
going by title.

| PR | What it is | State | Verdict |
|---|---|---|---|
| #732 `feat/727-compile-workout` | The compiler itself, `engine/lib/compileWorkout.mts` | Conflicts with `main`, but only a 7-line clash in a doc's table row | **Keep and rebase.** Self-contained, zero dependency on the week schema or anything this redesign changes. The cleanest of the three. |
| #733 `feat/727-workouts-day-view` | Web three-band Workouts page | Conflicts with `main`, 37 lines in `Workouts.tsx` from unrelated changes since Aug 31 | **Close, keep as reference.** It hand-parses `current_week` fields directly (`parseCurrentWeek`, `CurrentWeekSession`) - once the week schema changes, its data layer needs rewriting anyway. The three-band layout and the `workoutPage.ts` selector shape are worth reading before rebuilding, not worth merging as-is. |
| #734 `feat/ios-727-workouts-day-view` | iOS three-band Workouts tab | Mergeable, no conflict | **Close, keep as reference.** Same reasoning as #733 - a hand-rolled Swift parser reads `current_week` fields directly. iOS also follows web in this sequencing, so it's premature regardless of the schema question. |

None of the three touch anything Akash's backend plan (`workout_create`, the compiler wiring into
`ui/api/`) would conflict with - they're all UI-layer or fully independent.

## Done when

- `workout_create` lands as one action, with the compiler as a pure `engine/` module.
- A returning athlete's mid-conversation request for a new workout writes a schema-valid routine
  in that turn.
- A new athlete finishes First Session with a benchmark and a compiled first week, not a template
  dump.
- Every invariant in the LLD's table has a test that fails when violated.
- A dry run of the compiler across all four live repos has every diff explainable line by line.
- All four live repos, BYO included, keep working throughout.

## Alternatives considered

**Execute Akash's plan exactly as written, in his stack order.** Lowest coordination cost, keeps
#732-734 meaningful without rebasing anything early. But the reconciler and the weekly roll stay
gated behind an unrelated open question, the First Session dump survives longest, and it leaves
Current Week's redesign untouched - which was the main ask.

**Skip the hotfix, go straight to the season-compiler version (Akash's "Stack B").** Not
recommended. It designs on the churn-vs-stable question the plan itself refuses to design on
without evidence, and both live bugs stay open for the whole build.

## Deferred

- Training blocks and periodization (Akash's Stack B) - stays gated until the churn question has
  real evidence.
- The rename from `templates/`/`sessions/` to `routines/`/`compiled/` - cosmetic, not urgent.
- A superseding ADR for the template/session model - files once an approach across both docs is
  locked in.
