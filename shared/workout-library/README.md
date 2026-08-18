# Workout library

Generic, athlete-agnostic workout templates. Seed content for the post-first-session
template generation flow (`coach-redesign-part5-wiring-plan.md` section 1/2): once an athlete
finishes onboarding, backend logic picks a handful of these by tag, then a light Gemini pass
tunes load/reps to the athlete and swaps out anything they lack equipment for. Selection logic
itself isn't built yet — this is just the raw material.

## What's here

`templates/*.json` — one `Workout` object per file, same schema as
`ui/client/src/lib/workouts.ts` (`Workout`/`Phase`/`Exercise`). Written in the same voice as the
real per-athlete templates in `coach-skanda`/`coach-akash`'s `user_data/` — real form cues and
`why` rationale, not filler. These are never read directly by an athlete; they get copied and
adapted into an athlete's own `templates/` on first-session close.

`index.json` — one entry per template file, selection metadata that isn't part of the `Workout`
type itself:

```json
{ "id": "strength_dumbbells_intermediate", "sport_tags": ["general_fitness"], "equipment": ["dumbbells"], "goal_tags": ["build_strength"], "level": "intermediate" }
```

- `id` must match the template file's own `id` field exactly.
- `equipment` is what's actually required to run the workout as written (`bodyweight`,
  `dumbbells`, `resistance_band`, `full_gym`, `pull_up_bar`, `parallettes` — combine as needed).
- `sport_tags` / `goal_tags` are free-form but keep them to the existing vocabulary in the file
  where possible, so selection logic doesn't have to fuzzy-match synonyms.
- `level` is `beginner` | `intermediate` | `advanced`.

## Adding a template

1. Write the `Workout` JSON in `templates/`, matching the real schema exactly — check
   `ui/client/src/lib/workouts.ts` for required vs. optional fields.
2. Add one matching entry to `index.json`.
3. `ui/api/coach-chat/_tests/workoutLibrary.test.ts` validates both — schema conformance and
   that `index.json` and `templates/` stay in exact 1:1 correspondence. Run it before committing.
