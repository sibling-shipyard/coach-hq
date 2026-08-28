import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkout as validateWorkoutSchema } from "../_lib/workoutSchema.js";

// coach-redesign workout-backend-wiring §1: shared/workout-library/templates/ is the generic
// starter template set that post-first-session template generation picks from (not built yet -
// this only covers the library itself). Every file has to match the Workout/Phase/Exercise
// schema in ui/client/src/lib/workouts.ts exactly, and index.json has to stay in 1:1
// correspondence with the template files - that's what backend selection logic will rely on
// without needing to parse exercise content.
//
// §3: the structural validator itself now lives in _lib/workoutSchema.ts (a real runtime guard
// for applyTemplateEdit, not just a test assertion) - this test wraps it in an expect() so a
// thrown validation error still reports as a normal test failure with a useful message.

const here = path.dirname(fileURLToPath(import.meta.url));
const libraryDir = path.resolve(here, "..", "..", "..", "..", "shared", "workout-library");
const templatesDir = path.join(libraryDir, "templates");
const indexPath = path.join(libraryDir, "index.json");

interface LibraryIndexEntry {
  id: string;
  sport_tags: string[];
  equipment: string[];
  goal_tags: string[];
  level: string;
}

const LEVELS = new Set(["beginner", "intermediate", "advanced"]);

function assertString(value: unknown, field: string): void {
  expect(typeof value, `${field} should be a string`).toBe("string");
  expect((value as string).length, `${field} should not be empty`).toBeGreaterThan(0);
}

function validateWorkout(workout: any, fileName: string): void {
  expect(() => validateWorkoutSchema(workout, fileName)).not.toThrow();
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
      expect(workout.id, `${fileName}'s id field should match its filename`).toBe(
        fileName.replace(/\.json$/, ""),
      );
    }
  });
});

describe("workout library index.json", () => {
  const templateFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));
  const templateIds = new Set(templateFiles.map((f) => f.replace(/\.json$/, "")));
  // Shaped, not `any`: this test's whole job is asserting these fields exist and are well
  // formed, so the row type is what it validates against.
  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as LibraryIndexEntry[];

  it("is an array", () => {
    expect(Array.isArray(index)).toBe(true);
  });

  it("has exactly one entry per template file - no orphans, no missing entries", () => {
    const indexIds = index.map((entry: any) => entry.id);
    expect(new Set(indexIds).size, "index.json should not have duplicate ids").toBe(
      indexIds.length,
    );
    expect(new Set(indexIds)).toEqual(templateIds);
  });

  it.each(index)("entry $id has valid selection metadata", (entry) => {
    assertString(entry.id, "id");
    expect(templateIds.has(entry.id), `${entry.id} should have a matching template file`).toBe(
      true,
    );

    expect(Array.isArray(entry.sport_tags), `${entry.id}.sport_tags should be an array`).toBe(true);
    expect(entry.sport_tags.length, `${entry.id}.sport_tags should not be empty`).toBeGreaterThan(
      0,
    );
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
      const workout = JSON.parse(
        fs.readFileSync(path.join(templatesDir, `${entry.id}.json`), "utf-8"),
      );
      expect(workout.id, `template file for ${entry.id} has a mismatched id field`).toBe(entry.id);
    }
  });
});
