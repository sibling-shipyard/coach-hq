import { describe, it, expect } from "vitest";
import {
  buildBenchmarkSpec,
  repairBenchmarkSpecForInvariants,
  buildFallbackBenchmarkSpec,
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
  it("regression: never picks a full_gym exercise when a bodyweight alternative is on file, even for a fresh athlete with no stated equipment", () => {
    // Live-verified (#727 review): equipment.length alone ties ["bodyweight"] and ["full_gym"]
    // at 1 item each, and a full_gym entry could win the id tie-break - real content
    // (chest_fly_cable) did exactly this for the "push" pattern.
    const spec = buildBenchmarkSpec(memory(), injuries());
    const catalog = loadExerciseCatalog();
    for (const ex of spec.phases.flatMap((p) => p.exercises)) {
      const entry = catalog.find((e) => e.name === ex.name);
      const pattern = entry?.movement_pattern;
      const hasBodyweightOption = catalog.some(
        (e) => e.movement_pattern === pattern && e.equipment.includes("bodyweight"),
      );
      if (hasBodyweightOption) {
        expect(entry?.equipment).toContain("bodyweight");
      }
    }
  });

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

  it("regression: an active flag steers the pick away from a matching muscle group when an alternative is on file", () => {
    const catalog = loadExerciseCatalog();
    const cheapestPushPick = catalog
      .filter((e) => e.movement_pattern === "push")
      .sort((a, b) => a.equipment.length - b.equipment.length || a.id.localeCompare(b.id))[0];
    // Confirms the fixture actually exercises the mismatch: without any injury filter, the
    // cheapest push candidate on file targets a real, specific muscle group.
    const flaggedGroup = cheapestPushPick.muscle_group;
    const hasAlternative = catalog.some(
      (e) => e.movement_pattern === "push" && e.muscle_group !== flaggedGroup,
    );
    expect(hasAlternative).toBe(true);

    const withFlag = buildBenchmarkSpec(
      memory(),
      injuries([
        {
          id: "flag_1",
          text: `sore ${flaggedGroup.replace(/s$/, "")}`,
          status: "active",
          opened_at: "2026-09-01",
          resolved_at: null,
        },
      ]),
    );
    const pushWithFlag = withFlag.phases
      .flatMap((p) => p.exercises)
      .find((ex) => catalog.find((e) => e.name === ex.name)?.movement_pattern === "push");
    const pushEntry = catalog.find((e) => e.name === pushWithFlag?.name);
    expect(pushEntry?.muscle_group).not.toBe(flaggedGroup);
  });
});

describe("repairBenchmarkSpecForInvariants", () => {
  it("clamps a dose down to a since-updated progression's real current, to one set", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const target = spec.phases[0].exercises.find((ex) => ex.progression_id)!;
    const progressions: ProgressionsJson = {
      version: 1,
      _meta: { updated_at: "t", updated_by: "model", trace_id: "t1" },
      progressions: [
        {
          id: target.progression_id!,
          name: target.name,
          current: "1 (already benchmarked)",
          target: "",
          unit: null,
          history: [],
        },
      ],
    };
    const repaired = repairBenchmarkSpecForInvariants(spec, progressions, new Set());
    const repairedTarget = repaired.phases
      .flatMap((p) => p.exercises)
      .find((ex) => ex.progression_id === target.progression_id)!;
    const dose =
      repairedTarget.type === "timed"
        ? (repairedTarget.duration_secs ?? 0) * repairedTarget.sets
        : (repairedTarget.reps ?? 0) * repairedTarget.sets;
    expect(dose).toBeLessThanOrEqual(1);
    expect(() =>
      applyWorkoutCreate(repaired, new Set(), new Set(), progressions, "t1"),
    ).not.toThrow();
  });

  it("leaves every exercise alone when nothing needs repair", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const repaired = repairBenchmarkSpecForInvariants(spec, null, new Set());
    expect(repaired).toEqual(spec);
  });

  it("fills a generic ack for an active flag activeInjuryFlagIds knows about but spec.injury_ack doesn't", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    expect(spec.injury_ack ?? []).toEqual([]);
    const repaired = repairBenchmarkSpecForInvariants(spec, null, new Set(["flag_x"]));
    expect(repaired.injury_ack?.map((a) => a.flag)).toEqual(["flag_x"]);
  });

  it("synthesizes scaled_from for a progression_id with no matching entry and none set", () => {
    const spec = buildBenchmarkSpec(memory(), injuries());
    const stripped = {
      ...spec,
      phases: spec.phases.map((p) => ({
        ...p,
        exercises: p.exercises.map((ex) => ({ ...ex, scaled_from: undefined })),
      })),
    };
    const repaired = repairBenchmarkSpecForInvariants(stripped, null, new Set());
    for (const ex of repaired.phases.flatMap((p) => p.exercises)) {
      if (ex.progression_id) expect(ex.scaled_from?.trim()).toBeTruthy();
    }
  });
});

describe("buildFallbackBenchmarkSpec", () => {
  it("compiles and passes every invariant with no injury flags", () => {
    const spec = buildFallbackBenchmarkSpec(new Set());
    const { content } = applyWorkoutCreate(spec, new Set(), new Set(), null, "t1");
    expect(() => validateWorkout(JSON.parse(content), "fallback test")).not.toThrow();
  });

  it("compiles and passes invariant 7 with active injury flags acked for free", () => {
    const spec = buildFallbackBenchmarkSpec(new Set(["flag_1", "flag_2"]));
    const { content } = applyWorkoutCreate(
      spec,
      new Set(),
      new Set(["flag_1", "flag_2"]),
      null,
      "t1",
    );
    expect(() => validateWorkout(JSON.parse(content), "fallback test")).not.toThrow();
  });

  it("slugifies to the exact same BENCHMARK_ROUTINE_ID buildBenchmarkSpec does", () => {
    const spec = buildFallbackBenchmarkSpec(new Set());
    expect(spec.title).toBe(buildBenchmarkSpec(memory(), injuries()).title);
  });

  it("carries no progression_id, so invariants 1/2/8 never apply", () => {
    const spec = buildFallbackBenchmarkSpec(new Set());
    for (const ex of spec.phases.flatMap((p) => p.exercises)) {
      expect(ex.progression_id).toBeUndefined();
    }
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

  it("falls back to the latest coach_log row that states a frequency", () => {
    const result = inferTrainingAvailability(memory(), [
      { text: "Trains 2 days a week." },
      { text: "Athlete trains 4 days a week, mostly Tuesday and Saturday." },
      { text: "Talked about sleep." },
    ]);
    expect(result?.days_per_week).toBe(4);
    expect(result?.preferred_days).toEqual(expect.arrayContaining(["tuesday", "saturday"]));
  });

  it("prefers a memory note over the coach_log", () => {
    const result = inferTrainingAvailability(
      memory({
        notes: {
          ...memory().notes,
          fitness_baseline: {
            text: "Trains 3 days a week.",
            updated_at: "2026-09-11",
            trace_id: "t1",
          },
        },
      }),
      [{ text: "Trains 5 days a week." }],
    );
    expect(result?.days_per_week).toBe(3);
  });

  it("returns null when neither the notes nor the log state a frequency", () => {
    expect(inferTrainingAvailability(memory(), [{ text: "Talked about sleep." }])).toBeNull();
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
