# Workout library

`exercises.json` is the only shape here now - a catalog of individual movements, not premade
workouts. One entry per exercise: a name, the muscle group and movement pattern it trains, its
`type` (`reps` | `timed`), the equipment it needs, a real form cue, and a `why`. Tracked movements
also carry a `progression_id`. `workout_create`/`workout_remove` (A2) and the first-session
benchmark plus first-week compiler (A3) all read from this file.

The old shape - complete premade `Workout` files under `templates/` plus a selection `index.json`
- is gone (A3, #727). `coachWorkoutFiles.ts`'s automatic template-dump selector that read them on
signup is deleted too, since removing the selector is what made those files actually dead.

## Why a catalog of movements, not workouts

The old shape here is ~30 complete `Workout` files, picked automatically by tag at signup time.
The only fix that shape allowed was picking a different canned file - dosing still came from
whichever file matched an athlete's tags, never from their own benchmark or progressions. That's
the bug this catalog exists to close.

Coach names exercises from the catalog. Coach doses them from the athlete. Every workout spec, a
first-session benchmark, a first-week anchor session, or "give me an upper-body workout" months
later, picks movements from here by muscle group, sport, and available equipment. Sets, reps, and
weight are computed from that athlete's own `progressions.json` current value, `injuries.json`
active flags, and `profile.json` age, never read off this file. That's why no entry below carries
`sets`, `reps`, `duration_secs`, or a weight: a catalog entry describes what the movement is,
never how much of it.

## Schema

```json
{
  "id": "back_row_dumbbell",
  "name": "Single-arm dumbbell row",
  "muscle_group": "back",
  "movement_pattern": "pull",
  "type": "reps",
  "equipment": ["dumbbells"],
  "sport_tags": ["general_fitness", "strength_training"],
  "form_cue": "...",
  "why": "...",
  "progression_id": "row_dumbbell"
}
```

- `id` is unique across the file and used to reference the entry, never a filename.
- `muscle_group` / `movement_pattern` are how Coach and any selection logic filter the catalog -
  keep them to the existing vocabulary in the file rather than inventing new ones.
- `type` is `reps` or `timed`, the same split the compiler uses everywhere else.
- `equipment` is what the movement as written actually requires (`bodyweight`, `dumbbells`,
  `resistance_band`, `full_gym`, `pull_up_bar`, `bench`, combine as needed).
- `form_cue` and `why` are written in the same voice as the real per-athlete session files in
  `coach-skanda`/`coach-akash`'s `user_data/`, real cues and real rationale, not filler.
- `progression_id` is present only when the movement is worth tracking over time. A warm-up or
  mobility entry omits it. Where it's set, it should match the `progression_id` naming already in
  use in real `progressions.json` files so it resolves at write time. This file doesn't validate
  against any one athlete's ledger, only that the shape is a plausible identifier.

## Coverage

The catalog needs real entries across every movement pattern Coach reaches for: push, pull,
squat, hinge, core, and calves, plus the calisthenics skill families already tracked in real
`progressions.json` files (pull-up, handstand, front lever) and prehab entries for the injury
sites already on file (hip/glute, shoulder, posture). Thin coverage just pushes Coach back to
inventing exercises outside the catalog, which defeats the point, so don't add an entry without
also keeping the surrounding group covered.

## Adding an entry

1. Add one object to `exercises.json`, matching the schema above exactly.
2. Give it a real form cue and `why`, no placeholder text.
3. If it's a tracked movement, use a `progression_id` that matches the naming already in use in
   real athlete `progressions.json` files.
4. `ui/api/coach-chat/_tests/exerciseCatalog.test.ts` validates the schema, checks for duplicate
   `id`s, and checks that the coverage table still holds. Run it before committing.
