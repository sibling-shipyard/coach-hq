# Workouts: catalog, compiler, and the three-band UI

> Status: Current · Owner: Tech Lead · Verified: 2026-09-14

## Context

#727 replaced "Coach picks from a frozen per-athlete template" with catalog-based routine
creation: Coach names movements from a shared exercise catalog, doses them per athlete, and a
pure compiler fills in the timer physics neither Coach nor the athlete should have to state by
hand. This doc covers how that compiler works, why there are two separate entry points into it,
and how the resulting session files reach the three-band Workouts UI. Schema/field reference
(catalog entry shape, compiled `Workout`/`Phase`/`Exercise` shape) lives in
`docs/eng-docs/coach-data-schema.md` - this doc is the mechanics, not the field list.

## The compiler (`engine/lib/compileWorkout.mts`)

A pure function, `compileWorkout(spec: WorkoutSpec, opts?) -> Workout`. Coach, or the hosted
benchmark path, supplies a minimal spec: which exercises, what type, how many sets, the coaching
prose. The compiler fills in everything else - prep countdowns, rest between sets, rest after each
exercise, and the phase/workout duration estimate.

**Override rule, three levels deep, most specific wins:** a value already present on the spec's
own exercise entry is never recomputed (`hasOwn()` check, never falls through to a default). A
per-call `CompileOpts.defaults` override, if given, wins over the hardcoded table. Otherwise the
table below applies.

**Defaults table** (`compileWorkout.mts`'s `TABLE` constant):

| Field | Default | Applies to |
|---|---:|---|
| `prep_secs_timed` | 5s | A `timed` exercise with no explicit `prep_secs` |
| `rest_between_sets_reps` | 60s | A `reps` exercise with `sets > 1` and no explicit rest |
| `rest_between_sets_timed` | 45s | A `timed` exercise with `sets > 1` and no explicit rest |
| `rest_after_exercise_secs` | 30s | Any exercise, unless it's the very last one of the last phase |
| `rest_after_last_secs` | 0s | The last exercise of the last phase only |
| `default_rest_secs` | 30s | A phase's own `default_rest_secs`, when the spec doesn't set one |
| `secs_per_rep` | 3s | Used only to estimate a `reps`-type exercise's work time for duration math |

A `reps` exercise with exactly one set gets no `rest_between_sets_secs` at all - there's nothing to
rest between. Total workout duration is the sum of every exercise's work time, between-set rest,
and after-exercise rest, rounded up to the nearest minute per phase.

`progression_id` is spec-only (a pointer into the athlete's `progressions.json`, so Coach can dose
this exercise's next set from real history) and is dropped on emit - it's not a `Workout` field.

## Two entry points, one compiler

**BYOB Claude Code:** `engine/scripts/compile-workout-cli.mts`, a thin CLI wrapper -
`npx tsx engine/scripts/compile-workout-cli.mts <spec.json>`, reads a `WorkoutSpec` JSON file,
prints the compiled `Workout` JSON to stdout, writes nothing. Claude Code has no JS import
boundary to cross the way a TypeScript module does, so it needs a plain CLI rather than an
import. Saving the result to a session or template file is still Coach's call, same as any other
write - the CLI's job stops at compiling.

**Hosted web/iOS (`workout_create`):** the coach-chat backend needs the same compiler
server-side. But `engine/` and `ui/` are different top-level monorepo bands, and Vercel's build
for `api/*.ts` serverless functions only traces `ui/` - a raw cross-band `.mts` import would be
missing from the deployed Lambda. `ui/scripts/build/bundle-compile-workout-api.mjs` pre-builds a small
esbuild bundle instead: `ui/api/coach-chat/_lib/compile-workout.bundle.js` re-exports the same
`compileWorkout` from `engine/lib/compileWorkout.mts`, the same fix shape
`bundle-current-week-api.mjs` uses for `current-week.mts`. `coachWorkoutFiles.ts`'s
`applyWorkoutCreate` imports the bundle, not the raw `.mts` file.

Both paths run the identical compiler function - the split exists purely because of where each
caller runs, not because the logic differs.

## The exercise catalog is the input, not the output

`shared/workout-library/exercises.json` is what Coach picks movements *from* - a catalog of
individual exercises by muscle group, sport, and equipment, with no sets/reps/weight on any
entry (see `coach-data-schema.md` for the entry shape). Coach doses every set/rep/weight per
athlete at spec-build time, before ever calling the compiler. The catalog fixes vocabulary so
Coach never invents an unsafe-sounding movement from nothing; dosing stays computed per athlete
every time, never read off the catalog file itself.

Only the BYOB path reads this file from the athlete repo (`carve-skeleton.mjs` carves
`shared/workout-library/` whole). The hosted web/iOS path never needs a repo copy - it reads its
own HQ-local copy at request time instead (`coachFirstSessionBenchmark.ts`'s `EXERCISES_PATH`).
One more reason the two entry points above stay separate rather than sharing a single path.

## From compiled session to the three-band Workouts UI

A compiled `Workout`, saved as a session file (`user_data/activities/workout_plans/sessions/
YYYY-MM-DD_<id>.json`) or a template, is what the Workouts page renders. Both web and iOS derive
the same three bands - **today**, **this week**, **library** - from the same three inputs:
`current_week.json`'s parsed runtime, synced activities, and the athlete's workout library.

- Web: `ui/client/src/lib/workoutsPageSelector.ts` - pure selector functions, no new storage, no
  state machine. "This week" deliberately reuses the exact live-week contract Home already
  builds (`adaptCurrentWeek`/`buildLiveWeekContract`) rather than re-deriving day rows from
  activities a second time. Rendered by `ui/client/src/pages/Workouts.tsx`.
- iOS: `WorkoutsPageSelector.swift` mirrors the web selector's logic; `WorkoutTimerEngine.swift` +
  `WorkoutTimerView.swift` run the native timer against a session file's compiled fields. See
  `docs/ref-docs/timer-state-machine.md` for the timer's own state machine, which consumes the
  same `rest_between_sets_secs`/`rest_after_exercise_secs`/`prep_secs` fields this compiler
  produces.

"Library" groups every template plus any standalone session with no matching template, by
`workout_type`.
