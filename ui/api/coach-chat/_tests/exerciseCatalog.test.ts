import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// workouts-redesign-lld.md A1b: shared/workout-library/exercises.json is a catalog of
// individual movements, not premade workouts. Coach picks movements from here by muscle group,
// sport, and equipment, then doses sets/reps/weight per athlete at write time (A2) - never read
// off this file. So this test validates catalog shape and coverage only: it never asserts
// anything about sets, reps, duration, or weight, because the schema itself forbids those
// fields on a catalog entry.

const here = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.resolve(here, "..", "..", "..", "..", "shared", "workout-library");
const exercisesPath = path.join(libraryDir, "exercises.json");

interface ExerciseEntry {
  id: string;
  name: string;
  muscle_group: string;
  movement_pattern: string;
  type: string;
  equipment: string[];
  sport_tags: string[];
  form_cue: string;
  why: string;
  progression_id?: string;
}

const TYPES = new Set(["reps", "timed"]);

// Coverage table from workouts-redesign-lld.md's A1b section - every group needs at least one
// entry, and this is also the source of truth the catalog is checked against below.
const REQUIRED_MUSCLE_MOVEMENT_PAIRS: Array<[string, string]> = [
  ["chest", "push"],
  ["shoulders", "push"],
  ["triceps", "push"],
  ["back", "pull"],
  ["biceps", "pull"],
  ["quads", "squat"],
  ["hamstrings", "hinge"],
  ["glutes", "hinge"],
  ["core", "core"],
  ["calves", "calves"],
  ["back", "calisthenics_skill"],
  ["shoulders", "calisthenics_skill"],
  ["glutes", "prehab"],
  ["shoulders", "prehab"],
];

function assertNonEmptyString(value: unknown, field: string): void {
  expect(typeof value, `${field} should be a string`).toBe("string");
  expect((value as string).trim().length, `${field} should not be empty`).toBeGreaterThan(0);
}

function assertNonEmptyStringArray(value: unknown, field: string): void {
  expect(Array.isArray(value), `${field} should be an array`).toBe(true);
  expect((value as unknown[]).length, `${field} should not be empty`).toBeGreaterThan(0);
  (value as unknown[]).forEach((v, i) => assertNonEmptyString(v, `${field}[${i}]`));
}

// A plausible progression_id shape: lowercase snake_case, no spaces, no file extension - the
// same shape every id used in real progressions.json files takes. This test can't check that
// the id actually resolves in any one athlete's ledger (that's a write-time concern, A2), only
// that it's the right kind of string.
const PROGRESSION_ID_SHAPE = /^[a-z][a-z0-9_]*[a-z0-9]$/;

describe("workout library exercises.json", () => {
  const raw = fs.readFileSync(exercisesPath, "utf-8");
  const exercises = JSON.parse(raw) as ExerciseEntry[];

  it("is an array", () => {
    expect(Array.isArray(exercises)).toBe(true);
  });

  it("has real coverage, not a stub set", () => {
    expect(exercises.length).toBeGreaterThanOrEqual(40);
  });

  it.each(exercises)("entry $id validates against the catalog schema", (entry) => {
    assertNonEmptyString(entry.id, "id");
    assertNonEmptyString(entry.name, "name");
    assertNonEmptyString(entry.muscle_group, "muscle_group");
    assertNonEmptyString(entry.movement_pattern, "movement_pattern");
    expect(TYPES.has(entry.type), `${entry.id}.type invalid: ${entry.type}`).toBe(true);
    assertNonEmptyStringArray(entry.equipment, `${entry.id}.equipment`);
    assertNonEmptyStringArray(entry.sport_tags, `${entry.id}.sport_tags`);
    assertNonEmptyString(entry.form_cue, `${entry.id}.form_cue`);
    assertNonEmptyString(entry.why, `${entry.id}.why`);

    // The catalog never carries dosing - these fields must not exist on any entry.
    expect(entry).not.toHaveProperty("sets");
    expect(entry).not.toHaveProperty("reps");
    expect(entry).not.toHaveProperty("duration_secs");
    expect(entry).not.toHaveProperty("weight");
  });

  it("every progression_id, where present, is a plausible resolvable identifier shape", () => {
    const withProgression = exercises.filter((e) => e.progression_id !== undefined);
    expect(
      withProgression.length,
      "at least some entries should be tracked movements",
    ).toBeGreaterThan(0);
    for (const entry of withProgression) {
      assertNonEmptyString(entry.progression_id, `${entry.id}.progression_id`);
      expect(
        PROGRESSION_ID_SHAPE.test(entry.progression_id as string),
        `${entry.id}.progression_id "${entry.progression_id}" doesn't look like a real progression id`,
      ).toBe(true);
    }
  });

  it("no two entries share an id", () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size, "exercises.json should not have duplicate ids").toBe(ids.length);
  });

  it.each(REQUIRED_MUSCLE_MOVEMENT_PAIRS)(
    "has at least one entry for muscle_group %s / movement_pattern %s",
    (muscleGroup, movementPattern) => {
      const match = exercises.some(
        (e) => e.muscle_group === muscleGroup && e.movement_pattern === movementPattern,
      );
      expect(match, `no entry found for ${muscleGroup}/${movementPattern}`).toBe(true);
    },
  );

  it("bodyweight, dumbbells, and full_gym all appear as equipment somewhere in the loadable groups", () => {
    // Bodyweight-only families (calisthenics skills, prehab) are exempt - the LLD only requires
    // 3 equipment variants "where the movement supports it", and a front lever hold has no
    // dumbbell variant to give it. This checks the aggregate across everything else instead of
    // per-pair, since a group like calves only needs 2-3 variants total, not per pattern.
    const exemptPatterns = new Set(["calisthenics_skill", "prehab"]);
    const allEquipment = new Set<string>();
    for (const entry of exercises) {
      if (exemptPatterns.has(entry.movement_pattern)) continue;
      entry.equipment.forEach((eq) => allEquipment.add(eq));
    }
    expect(allEquipment.has("bodyweight")).toBe(true);
    expect(allEquipment.has("dumbbells")).toBe(true);
    expect(allEquipment.has("full_gym")).toBe(true);
  });
});
