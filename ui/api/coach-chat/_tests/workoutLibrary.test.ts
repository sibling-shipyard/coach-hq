import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// coach-redesign workout-backend-wiring §1: shared/workout-library/templates/ is the generic
// starter template set that post-first-session template generation picks from (not built yet -
// this only covers the library itself). Every file has to match the Workout/Phase/Exercise
// schema in ui/client/src/lib/workouts.ts exactly, and index.json has to stay in 1:1
// correspondence with the template files - that's what backend selection logic will rely on
// without needing to parse exercise content.

const here = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.resolve(here, "..", "..", "..", "..", "shared", "workout-library");
const templatesDir = path.join(libraryDir, "templates");
const indexPath = path.join(libraryDir, "index.json");

const WORKOUT_TYPES = new Set(["foundation", "strength", "recovery", "realign", "calisthenics"]);
const EXERCISE_TYPES = new Set(["timed", "reps"]);
const LEVELS = new Set(["beginner", "intermediate", "advanced"]);

function assertString(value: unknown, field: string): void {
  expect(typeof value, `${field} should be a string`).toBe("string");
  expect((value as string).length, `${field} should not be empty`).toBeGreaterThan(0);
}

function assertNumber(value: unknown, field: string): void {
  expect(typeof value, `${field} should be a number`).toBe("number");
  expect(Number.isFinite(value as number), `${field} should be finite`).toBe(true);
}

function validateExercise(ex: any, path_: string): void {
  assertNumber(ex.num, `${path_}.num`);
  assertString(ex.name, `${path_}.name`);
  expect(EXERCISE_TYPES.has(ex.type), `${path_}.type must be "timed" or "reps", got ${ex.type}`).toBe(true);
  assertNumber(ex.sets, `${path_}.sets`);
  assertString(ex.form_cue, `${path_}.form_cue`);
  assertString(ex.why, `${path_}.why`);

  if (ex.type === "timed") {
    assertNumber(ex.duration_secs, `${path_}.duration_secs`);
    expect(ex.reps, `${path_}.reps should be absent on a timed exercise`).toBeUndefined();
  } else {
    assertNumber(ex.reps, `${path_}.reps`);
    expect(ex.duration_secs, `${path_}.duration_secs should be absent on a reps exercise`).toBeUndefined();
  }

  const optionalNumberFields = [
    "rest_between_sets_secs",
    "rest_after_exercise_secs",
    "prep_secs",
  ];
  for (const field of optionalNumberFields) {
    if (ex[field] !== undefined) assertNumber(ex[field], `${path_}.${field}`);
  }
  const optionalBoolFields = ["optional", "both_sides"];
  for (const field of optionalBoolFields) {
    if (ex[field] !== undefined) {
      expect(typeof ex[field], `${path_}.${field} should be a boolean`).toBe("boolean");
    }
  }

  const allowedKeys = new Set([
    "num", "name", "type", "duration_secs", "reps", "sets",
    "rest_between_sets_secs", "rest_after_exercise_secs", "prep_secs",
    "optional", "both_sides", "form_cue", "why",
  ]);
  for (const key of Object.keys(ex)) {
    expect(allowedKeys.has(key), `${path_} has unexpected field "${key}"`).toBe(true);
  }
}

function validatePhase(phase: any, path_: string): void {
  assertString(phase.name, `${path_}.name`);
  assertString(phase.duration, `${path_}.duration`);
  assertNumber(phase.default_rest_secs, `${path_}.default_rest_secs`);
  expect(Array.isArray(phase.exercises), `${path_}.exercises should be an array`).toBe(true);
  expect(phase.exercises.length, `${path_}.exercises should not be empty`).toBeGreaterThan(0);

  if (phase.transition_rest_secs !== undefined) {
    assertNumber(phase.transition_rest_secs, `${path_}.transition_rest_secs`);
  }
  if (phase.optional !== undefined) {
    expect(typeof phase.optional, `${path_}.optional should be a boolean`).toBe("boolean");
  }
  if (phase.coaching_note !== undefined) {
    assertString(phase.coaching_note, `${path_}.coaching_note`);
  }
  if (phase.circuit !== undefined) {
    expect(typeof phase.circuit, `${path_}.circuit should be a boolean`).toBe("boolean");
  }
  if (phase.rounds !== undefined) {
    assertNumber(phase.rounds, `${path_}.rounds`);
  }

  phase.exercises.forEach((ex: any, i: number) => validateExercise(ex, `${path_}.exercises[${i}]`));

  const allowedKeys = new Set([
    "name", "duration", "default_rest_secs", "transition_rest_secs",
    "optional", "coaching_note", "exercises", "circuit", "rounds",
  ]);
  for (const key of Object.keys(phase)) {
    expect(allowedKeys.has(key), `${path_} has unexpected field "${key}"`).toBe(true);
  }
}

function validateWorkout(workout: any, fileName: string): void {
  assertString(workout.id, `${fileName}.id`);
  assertString(workout.title, `${fileName}.title`);
  assertString(workout.subtitle, `${fileName}.subtitle`);
  expect(WORKOUT_TYPES.has(workout.workout_type), `${fileName}.workout_type invalid: ${workout.workout_type}`).toBe(true);
  assertNumber(workout.estimated_duration_mins, `${fileName}.estimated_duration_mins`);
  assertString(workout.location, `${fileName}.location`);
  expect(Array.isArray(workout.equipment), `${fileName}.equipment should be an array`).toBe(true);
  workout.equipment.forEach((e: unknown, i: number) => assertString(e, `${fileName}.equipment[${i}]`));
  assertString(workout.coaching_note, `${fileName}.coaching_note`);
  expect(Array.isArray(workout.phases), `${fileName}.phases should be an array`).toBe(true);
  expect(workout.phases.length, `${fileName}.phases should not be empty`).toBeGreaterThan(0);

  workout.phases.forEach((phase: any, i: number) => validatePhase(phase, `${fileName}.phases[${i}]`));

  // Generic templates: session_date/based_on_template/shoulder_modification/_meta don't apply -
  // those get stamped when a template is adapted into an athlete's own session/template file.
  if (workout.progression_notes !== undefined) {
    assertString(workout.progression_notes, `${fileName}.progression_notes`);
  }

  const allowedKeys = new Set([
    "id", "title", "subtitle", "session_date", "based_on_template", "workout_type",
    "estimated_duration_mins", "location", "equipment", "coaching_note", "phases",
    "shoulder_modification", "progression_notes", "_meta",
  ]);
  for (const key of Object.keys(workout)) {
    expect(allowedKeys.has(key), `${fileName} has unexpected top-level field "${key}"`).toBe(true);
  }

  // Exercise nums should be unique and in ascending order across the whole workout.
  const nums = workout.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num));
  const sorted = [...nums].sort((a, b) => a - b);
  expect(nums, `${fileName} exercise nums should be strictly ascending across phases`).toEqual(sorted);
  expect(new Set(nums).size, `${fileName} exercise nums should be unique`).toBe(nums.length);
}

describe("workout library templates", () => {
  const templateFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));

  it("has template files to validate", () => {
    expect(templateFiles.length).toBeGreaterThanOrEqual(15);
  });

  it.each(templateFiles)("%s parses as valid JSON and matches the Workout schema", (fileName) => {
    const raw = fs.readFileSync(path.join(templatesDir, fileName), "utf-8");
    const workout = JSON.parse(raw);
    validateWorkout(workout, fileName);
  });

  it("every template's own id matches its filename (minus .json)", () => {
    for (const fileName of templateFiles) {
      const workout = JSON.parse(fs.readFileSync(path.join(templatesDir, fileName), "utf-8"));
      expect(workout.id, `${fileName}'s id field should match its filename`).toBe(fileName.replace(/\.json$/, ""));
    }
  });
});

describe("workout library index.json", () => {
  const templateFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
  const templateIds = new Set(templateFiles.map((f) => f.replace(/\.json$/, "")));
  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

  it("is an array", () => {
    expect(Array.isArray(index)).toBe(true);
  });

  it("has exactly one entry per template file - no orphans, no missing entries", () => {
    const indexIds = index.map((entry: any) => entry.id);
    expect(new Set(indexIds).size, "index.json should not have duplicate ids").toBe(indexIds.length);
    expect(new Set(indexIds)).toEqual(templateIds);
  });

  it.each(index)("entry $id has valid selection metadata", (entry: any) => {
    assertString(entry.id, "id");
    expect(templateIds.has(entry.id), `${entry.id} should have a matching template file`).toBe(true);

    expect(Array.isArray(entry.sport_tags), `${entry.id}.sport_tags should be an array`).toBe(true);
    expect(entry.sport_tags.length, `${entry.id}.sport_tags should not be empty`).toBeGreaterThan(0);
    entry.sport_tags.forEach((t: unknown) => assertString(t, `${entry.id}.sport_tags[]`));

    expect(Array.isArray(entry.equipment), `${entry.id}.equipment should be an array`).toBe(true);
    expect(entry.equipment.length, `${entry.id}.equipment should not be empty`).toBeGreaterThan(0);
    entry.equipment.forEach((t: unknown) => assertString(t, `${entry.id}.equipment[]`));

    expect(Array.isArray(entry.goal_tags), `${entry.id}.goal_tags should be an array`).toBe(true);
    expect(entry.goal_tags.length, `${entry.id}.goal_tags should not be empty`).toBeGreaterThan(0);
    entry.goal_tags.forEach((t: unknown) => assertString(t, `${entry.id}.goal_tags[]`));

    expect(LEVELS.has(entry.level), `${entry.id}.level invalid: ${entry.level}`).toBe(true);
  });

  it("every id in index.json matches the corresponding template's own id field", () => {
    for (const entry of index) {
      const workout = JSON.parse(fs.readFileSync(path.join(templatesDir, `${entry.id}.json`), "utf-8"));
      expect(workout.id, `template file for ${entry.id} has a mismatched id field`).toBe(entry.id);
    }
  });
});
