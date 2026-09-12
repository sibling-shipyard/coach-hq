import { describe, it, expect } from "vitest";
import {
  buildBenchmarkSpec,
  seedBenchmarkProgressions,
  inferTrainingAvailability,
  loadExerciseCatalog,
  type ExerciseCatalogEntry,
} from "../_lib/decide/coachFirstSessionBenchmark.js";
import { applyWorkoutCreate } from "../_lib/decide/coachWorkoutFiles.js";
import { validateWorkout } from "../_lib/decide/workoutSchema.js";
import type { MemoryJson, InjuriesJson } from "../_lib/decide/coachMemoryFiles.js";
import type { ProgressionsJson } from "../_lib/decide/coachQuestFiles.js";

// A3 (#727): First Session's benchmark - one workout_create spec per profile-complete
// transition, plus progression seeding. Real invariant enforcement via applyWorkoutCreate
// (never mocked), same discipline as coachWorkoutCreate.test.ts's A2 suite.

function memory(overrides: Partial<MemoryJson> = {}): MemoryJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-09-11", updated_by: "model", trace_id: "t1" },
    sports: ["Badminton"],
    coaching_style: "accountability",
    training_availability: null,
    notes: {
      fitness_baseline: { text: "", updated_at: "", trace_id: "" },
      coaching_priorities: { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "", updated_at: "", trace_id: "" },
    },
    ...overrides,
  };
}

function injuries(flags: InjuriesJson["flags"] = []): InjuriesJson {
  return { flags };
}

describe("loadExerciseCatalog", () => {
  it("reads a real, non-empty catalog", () => {
    const catalog = loadExerciseCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((e) => typeof e.id === "string" && e.id.length > 0)).toBe(true);
  });
});

describe("buildBenchmarkSpec", () => {
  it("covers 4-6 movement patterns, one exercise each", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const exercises = spec.phases.flatMap((p) => p.exercises);
    expect(exercises.length).toBeGreaterThanOrEqual(4);
    expect(exercises.length).toBeLessThanOrEqual(6);
  });

  it("every exercise carries an easier and a harder alternative in its coaching cue", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    for (const ex of spec.phases.flatMap((p) => p.exercises)) {
      expect(ex.form_cue).toMatch(/Easier: .+\. Harder: .+\./);
    }
  });

  it("every exercise is a fresh progression, acknowledged with scaled_from", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    for (const ex of spec.phases.flatMap((p) => p.exercises)) {
      if (ex.progression_id) expect(ex.scaled_from?.trim()).toBeTruthy();
    }
  });

  it("acknowledges every active injury flag", () => {
    const spec = buildBenchmarkSpec(
      memory(),
      injuries([
        {
          id: "flag_1",
          text: "sore shoulder",
          status: "active",
          opened_at: "2026-09-01",
          resolved_at: null,
        },
      ]),
    );
    expect(spec.injury_ack?.map((a) => a.flag)).toEqual(["flag_1"]);
  });

  it("compiles and writes a structurally valid, injury-cleared routine (real applyWorkoutCreate)", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const { content } = applyWorkoutCreate(spec, new Set(), new Set(), null, "t1");
    const parsed = JSON.parse(content);
    expect(() => validateWorkout(parsed, "benchmark test")).not.toThrow();
  });
});

describe("seedBenchmarkProgressions", () => {
  it("seeds one progression per benchmarked pattern, current: null", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const { content, seededIds } = seedBenchmarkProgressions(null, spec, "2026-09-11", "t1");
    const exerciseCount = spec.phases
      .flatMap((p) => p.exercises)
      .filter((e) => e.progression_id).length;
    expect(seededIds.length).toBe(exerciseCount);
    const parsed = JSON.parse(content) as ProgressionsJson;
    expect(parsed.progressions.length).toBe(exerciseCount);
    expect(parsed.progressions.every((p) => p.current === null)).toBe(true);
  });

  it("never overwrites an existing progression with the same id", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const firstId = spec.phases[0].exercises[0].progression_id!;
    const existing: ProgressionsJson = {
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "coach", trace_id: "old" },
      progressions: [
        {
          id: firstId,
          name: "Real history",
          current: "3x10 (Aug 1)",
          target: "3x15",
          unit: null,
          history: [],
        },
      ],
    };
    const { content, seededIds } = seedBenchmarkProgressions(existing, spec, "2026-09-11", "t1");
    expect(seededIds).not.toContain(firstId);
    const parsed = JSON.parse(content) as ProgressionsJson;
    expect(parsed.progressions.find((p) => p.id === firstId)?.current).toBe("3x10 (Aug 1)");
  });
});

// Invariant 2, re-affirmed at the exact boundary A3 introduces: a null current is accepted (no
// benchmark yet), and once a real numeric current exists, a dose above it throws.
describe("applyWorkoutCreate invariant 2 with a seeded, unbenchmarked progression", () => {
  const catalog: ExerciseCatalogEntry[] = loadExerciseCatalog();
  const pushEntry = catalog.find((e) => e.movement_pattern === "push" && e.progression_id)!;

  function specWithDose(reps: number) {
    return {
      title: "Follow-up push work",
      workout_type: "strength" as const,
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: pushEntry.name,
              type: "reps" as const,
              reps,
              sets: 1,
              form_cue: pushEntry.form_cue,
              why: pushEntry.why,
              progression_id: pushEntry.progression_id,
            },
          ],
        },
      ],
    };
  }

  it("current: null is accepted - invariant 2 is a no-op with nothing to compare against", () => {
    const progressions: ProgressionsJson = {
      version: 1,
      _meta: { updated_at: "2026-09-11", updated_by: "model", trace_id: "t1" },
      progressions: [
        {
          id: pushEntry.progression_id!,
          name: pushEntry.name,
          current: null,
          target: "",
          unit: null,
          history: [],
        },
      ],
    };
    expect(() =>
      applyWorkoutCreate(specWithDose(50), new Set(), new Set(), progressions, "t1"),
    ).not.toThrow();
  });

  it("a dose above a real benchmarked current throws", () => {
    const progressions: ProgressionsJson = {
      version: 1,
      _meta: { updated_at: "2026-09-11", updated_by: "model", trace_id: "t1" },
      progressions: [
        {
          id: pushEntry.progression_id!,
          name: pushEntry.name,
          current: "8 (Sep 11 benchmark)",
          target: "",
          unit: null,
          history: [],
        },
      ],
    };
    expect(() =>
      applyWorkoutCreate(specWithDose(20), new Set(), new Set(), progressions, "t1"),
    ).toThrow(/doses/);
  });
});

describe("inferTrainingAvailability", () => {
  it("returns null when nothing parseable was ever said", () => {
    expect(inferTrainingAvailability(memory())).toBeNull();
  });

  it("parses a plain days-per-week statement out of fitness_baseline prose", () => {
    const result = inferTrainingAvailability(
      memory({
        notes: {
          ...memory().notes,
          fitness_baseline: {
            text: "I can train 4 days a week, usually Monday, Wednesday, Friday, and Saturday.",
            updated_at: "2026-09-11",
            trace_id: "t1",
          },
        },
      }),
    );
    expect(result?.days_per_week).toBe(4);
    expect(result?.preferred_days).toEqual(
      expect.arrayContaining(["monday", "wednesday", "friday", "saturday"]),
    );
  });

  it("accepts a stated zero as a real, legal answer", () => {
    const result = inferTrainingAvailability(
      memory({
        notes: {
          ...memory().notes,
          coaching_priorities: {
            text: "Honestly 0 days a week right now, work is too much.",
            updated_at: "2026-09-11",
            trace_id: "t1",
          },
        },
      }),
    );
    expect(result).toEqual({ days_per_week: 0, preferred_days: [] });
  });
});
