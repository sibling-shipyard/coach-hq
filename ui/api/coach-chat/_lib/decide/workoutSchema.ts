/**
 * Structural validation for the Workout/Phase/Exercise shape (ui/client/src/lib/workouts.ts).
 * Extracted out of _tests/workoutLibrary.test.ts's inline validator because applyTemplateEdit
 * needs the same check as a real runtime guard, not just a test assertion - a Gemini-produced
 * template edit that doesn't conform must never get committed (this pipeline's "never commit
 * invalid data" discipline, same spirit as every other applier in coachIntents.ts throwing
 * rather than writing something malformed). Throws with a descriptive message on the first
 * violation found rather than collecting every one - callers only need to know "reject this",
 * not a full report.
 */
import type { Workout } from "../../../../client/src/lib/workouts.js";

const WORKOUT_TYPES = new Set(["foundation", "strength", "recovery", "realign", "calisthenics"]);
const EXERCISE_TYPES = new Set(["timed", "reps"]);

function assertString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`workout schema: ${field} should be a non-empty string`);
  }
}

function assertNumber(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`workout schema: ${field} should be a finite number`);
  }
}

function validateExercise(ex: any, path_: string): void {
  assertNumber(ex.num, `${path_}.num`);
  assertString(ex.name, `${path_}.name`);
  if (!EXERCISE_TYPES.has(ex.type)) {
    throw new Error(`workout schema: ${path_}.type must be "timed" or "reps", got ${ex.type}`);
  }
  assertNumber(ex.sets, `${path_}.sets`);
  assertString(ex.form_cue, `${path_}.form_cue`);
  assertString(ex.why, `${path_}.why`);

  if (ex.type === "timed") {
    assertNumber(ex.duration_secs, `${path_}.duration_secs`);
    if (ex.reps !== undefined)
      throw new Error(`workout schema: ${path_}.reps should be absent on a timed exercise`);
  } else {
    assertNumber(ex.reps, `${path_}.reps`);
    if (ex.duration_secs !== undefined)
      throw new Error(`workout schema: ${path_}.duration_secs should be absent on a reps exercise`);
  }

  const optionalNumberFields = ["rest_between_sets_secs", "rest_after_exercise_secs", "prep_secs"];
  for (const field of optionalNumberFields) {
    if (ex[field] !== undefined) assertNumber(ex[field], `${path_}.${field}`);
  }
  const optionalBoolFields = ["optional", "both_sides"];
  for (const field of optionalBoolFields) {
    if (ex[field] !== undefined && typeof ex[field] !== "boolean") {
      throw new Error(`workout schema: ${path_}.${field} should be a boolean`);
    }
  }

  const allowedKeys = new Set([
    "num",
    "name",
    "type",
    "duration_secs",
    "reps",
    "sets",
    "rest_between_sets_secs",
    "rest_after_exercise_secs",
    "prep_secs",
    "optional",
    "both_sides",
    "form_cue",
    "why",
  ]);
  for (const key of Object.keys(ex)) {
    if (!allowedKeys.has(key))
      throw new Error(`workout schema: ${path_} has unexpected field "${key}"`);
  }
}

function validatePhase(phase: any, path_: string): void {
  assertString(phase.name, `${path_}.name`);
  assertString(phase.duration, `${path_}.duration`);
  assertNumber(phase.default_rest_secs, `${path_}.default_rest_secs`);
  if (!Array.isArray(phase.exercises) || phase.exercises.length === 0) {
    throw new Error(`workout schema: ${path_}.exercises should be a non-empty array`);
  }

  if (phase.transition_rest_secs !== undefined)
    assertNumber(phase.transition_rest_secs, `${path_}.transition_rest_secs`);
  if (phase.optional !== undefined && typeof phase.optional !== "boolean") {
    throw new Error(`workout schema: ${path_}.optional should be a boolean`);
  }
  if (phase.coaching_note !== undefined)
    assertString(phase.coaching_note, `${path_}.coaching_note`);
  if (phase.circuit !== undefined && typeof phase.circuit !== "boolean") {
    throw new Error(`workout schema: ${path_}.circuit should be a boolean`);
  }
  if (phase.rounds !== undefined) assertNumber(phase.rounds, `${path_}.rounds`);

  phase.exercises.forEach((ex: any, i: number) => validateExercise(ex, `${path_}.exercises[${i}]`));

  const allowedKeys = new Set([
    "name",
    "duration",
    "default_rest_secs",
    "transition_rest_secs",
    "optional",
    "coaching_note",
    "exercises",
    "circuit",
    "rounds",
  ]);
  for (const key of Object.keys(phase)) {
    if (!allowedKeys.has(key))
      throw new Error(`workout schema: ${path_} has unexpected field "${key}"`);
  }
}

/** Throws on the first structural violation so invalid workouts cannot be committed. */
export function validateWorkout(workout: any, label: string): asserts workout is Workout {
  if (workout == null || typeof workout !== "object") {
    throw new Error(`workout schema: ${label} is not an object`);
  }
  assertString(workout.id, `${label}.id`);
  assertString(workout.title, `${label}.title`);
  assertString(workout.subtitle, `${label}.subtitle`);
  if (!WORKOUT_TYPES.has(workout.workout_type)) {
    throw new Error(`workout schema: ${label}.workout_type invalid: ${workout.workout_type}`);
  }
  assertNumber(workout.estimated_duration_mins, `${label}.estimated_duration_mins`);
  assertString(workout.location, `${label}.location`);
  if (!Array.isArray(workout.equipment))
    throw new Error(`workout schema: ${label}.equipment should be an array`);
  workout.equipment.forEach((e: unknown, i: number) => assertString(e, `${label}.equipment[${i}]`));
  assertString(workout.coaching_note, `${label}.coaching_note`);
  if (!Array.isArray(workout.phases) || workout.phases.length === 0) {
    throw new Error(`workout schema: ${label}.phases should be a non-empty array`);
  }

  workout.phases.forEach((phase: any, i: number) => validatePhase(phase, `${label}.phases[${i}]`));

  if (workout.progression_notes !== undefined)
    assertString(workout.progression_notes, `${label}.progression_notes`);

  const allowedKeys = new Set([
    "id",
    "title",
    "subtitle",
    "session_date",
    "based_on_template",
    "workout_type",
    "estimated_duration_mins",
    "location",
    "equipment",
    "coaching_note",
    "phases",
    "shoulder_modification",
    "progression_notes",
    "_meta",
  ]);
  for (const key of Object.keys(workout)) {
    if (!allowedKeys.has(key))
      throw new Error(`workout schema: ${label} has unexpected top-level field "${key}"`);
  }

  const nums = workout.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num));
  const sorted = [...nums].sort((a: number, b: number) => a - b);
  if (JSON.stringify(nums) !== JSON.stringify(sorted)) {
    throw new Error(
      `workout schema: ${label} exercise nums should be strictly ascending across phases`,
    );
  }
  if (new Set(nums).size !== nums.length) {
    throw new Error(`workout schema: ${label} exercise nums should be unique`);
  }
}
