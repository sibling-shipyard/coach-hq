import { describe, it, expect } from "vitest";
import {
  applyWorkoutCreate,
  applyWorkoutRemove,
  slugifyRoutineId,
  buildManifestContent,
  type WorkoutCreateSpec,
} from "../../_lib/decide/coachWorkoutFiles.js";
import {
  buildWorkoutCreateWrite,
  buildWorkoutRemoveWrite,
} from "../../_lib/decide/turnWrites/workoutWrite.js";
import { validateWorkout } from "../../_lib/decide/workoutSchema.js";
import type { ProgressionsJson } from "../../_lib/decide/coachQuestFiles.js";
import { generationConfigFor } from "../../_lib/gemini/coachReplySchema.js";

// A2 (#727): unit coverage for workout_create/workout_remove - the mid-conversation "make me a
// routine"/"remove that routine" actions. Same discipline as coachWorkoutFiles.test.ts's existing
// suite: real invariant enforcement (injury ack, progression id resolution, dose cap), never
// mocked away, since a wrong pick here could commit a routine that ignores a real injury or blows
// past a real benchmark.

function progressions(list: ProgressionsJson["progressions"]): ProgressionsJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "coach", trace_id: "t1" },
    progressions: list,
  };
}

function minimalSpec(overrides: Partial<WorkoutCreateSpec> = {}): WorkoutCreateSpec {
  return {
    title: "Upper Body Pump",
    workout_type: "strength",
    location: "home",
    coaching_note: "Keep it controlled.",
    equipment: ["dumbbells"],
    phases: [
      {
        name: "Main",
        exercises: [
          {
            name: "Dumbbell row",
            type: "reps",
            reps: 10,
            sets: 3,
            form_cue: "Squeeze the shoulder blade.",
            why: "Back strength.",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("slugifyRoutineId", () => {
  it("slugifies a plain title", () => {
    expect(slugifyRoutineId("Upper Body Pump", new Set())).toBe("upper_body_pump");
  });

  it("suffixes on collision with an existing id", () => {
    expect(slugifyRoutineId("Upper Body Pump", new Set(["upper_body_pump"]))).toBe(
      "upper_body_pump_2",
    );
    expect(
      slugifyRoutineId("Upper Body Pump", new Set(["upper_body_pump", "upper_body_pump_2"])),
    ).toBe("upper_body_pump_3");
  });

  it("falls back to a safe base for a title with no ASCII alphanumerics", () => {
    expect(slugifyRoutineId("!!!", new Set())).toBe("routine");
  });
});

describe("applyWorkoutCreate", () => {
  it("happy path: compiles and writes a structurally valid file", () => {
    const { id, content } = applyWorkoutCreate(minimalSpec(), new Set(), new Set(), null, "t1");
    expect(id).toBe("upper_body_pump");
    const parsed = JSON.parse(content);
    expect(parsed.title).toBe("Upper Body Pump");
    expect(parsed.id).toBe("upper_body_pump");
    // Committed file passes structural validation - never commit invalid data, same discipline
    // as every other applier in this file.
    expect(() => validateWorkout(parsed, "workout_create test")).not.toThrow();
  });

  it("suffixes the id on collision with an existing routine id", () => {
    const { id } = applyWorkoutCreate(
      minimalSpec(),
      new Set(["upper_body_pump"]),
      new Set(),
      null,
      "t1",
    );
    expect(id).toBe("upper_body_pump_2");
  });

  it("throws when an active injury flag has no acknowledgment", () => {
    expect(() =>
      applyWorkoutCreate(minimalSpec(), new Set(), new Set(["inj_shoulder"]), null, "t1"),
    ).toThrow(/inj_shoulder/);
  });

  it("passes when the active flag is acknowledged", () => {
    const spec = minimalSpec({
      injury_ack: [{ flag: "inj_shoulder", accommodation: "Dropped overhead pressing." }],
    });
    expect(() =>
      applyWorkoutCreate(spec, new Set(), new Set(["inj_shoulder"]), null, "t1"),
    ).not.toThrow();
  });

  it("throws when a progression_id doesn't exist yet and has no scaled_from", () => {
    const spec = minimalSpec({
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: "Front lever tuck",
              type: "timed",
              duration_secs: 10,
              sets: 3,
              form_cue: "Hollow body.",
              why: "Skill progression.",
              progression_id: "fl_tuck",
            },
          ],
        },
      ],
    });
    expect(() => applyWorkoutCreate(spec, new Set(), new Set(), null, "t1")).toThrow(/scaled_from/);
  });

  it("passes the same unknown progression_id when scaled_from is set", () => {
    const spec = minimalSpec({
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: "Front lever tuck",
              type: "timed",
              duration_secs: 10,
              sets: 3,
              form_cue: "Hollow body.",
              why: "Skill progression.",
              progression_id: "fl_tuck",
              scaled_from: "Started conservative - no baseline hold yet.",
            },
          ],
        },
      ],
    });
    expect(() => applyWorkoutCreate(spec, new Set(), new Set(), null, "t1")).not.toThrow();
  });

  it("throws when a dose exceeds an existing progression's current value", () => {
    const spec = minimalSpec({
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: "Dumbbell row",
              type: "reps",
              reps: 20,
              sets: 3, // dose 60, current is 30
              form_cue: "Squeeze the shoulder blade.",
              why: "Back strength.",
              progression_id: "row_dumbbell",
            },
          ],
        },
      ],
    });
    const progs = progressions([
      {
        id: "row_dumbbell",
        name: "Dumbbell row",
        current: "30",
        target: "50",
        unit: "reps",
        history: [],
      },
    ]);
    expect(() => applyWorkoutCreate(spec, new Set(), new Set(), progs, "t1")).toThrow(
      /above progression/,
    );
  });

  it("allows a dose at or below an existing progression's current value", () => {
    const spec = minimalSpec({
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: "Dumbbell row",
              type: "reps",
              reps: 10,
              sets: 3, // dose 30, current is 30
              form_cue: "Squeeze the shoulder blade.",
              why: "Back strength.",
              progression_id: "row_dumbbell",
            },
          ],
        },
      ],
    });
    const progs = progressions([
      {
        id: "row_dumbbell",
        name: "Dumbbell row",
        current: "30",
        target: "50",
        unit: "reps",
        history: [],
      },
    ]);
    expect(() => applyWorkoutCreate(spec, new Set(), new Set(), progs, "t1")).not.toThrow();
  });

  it("does not enforce the dose cap when current isn't a parseable number (real-world free text)", () => {
    const spec = minimalSpec({
      phases: [
        {
          name: "Main",
          exercises: [
            {
              name: "Front lever - single leg",
              type: "timed",
              duration_secs: 999,
              sets: 3,
              form_cue: "Straight body.",
              why: "Skill work.",
              progression_id: "fl_single_leg",
            },
          ],
        },
      ],
    });
    const progs = progressions([
      {
        id: "fl_single_leg",
        name: "Front lever - single-leg hold",
        current: "", // unparseable/empty - real progressions.json can hold non-numeric prose too
        target: "Clean hold, 15s",
        unit: "s",
        history: [],
      },
    ]);
    expect(() => applyWorkoutCreate(spec, new Set(), new Set(), progs, "t1")).not.toThrow();
  });
});

describe("applyWorkoutRemove", () => {
  it("removes a known routine id from the manifest set", () => {
    const { remainingIds } = applyWorkoutRemove(
      "upper_body_pump",
      new Set(["upper_body_pump", "other_routine"]),
    );
    expect(remainingIds).toEqual(["other_routine"]);
  });

  it("throws on an unknown routine_id", () => {
    expect(() => applyWorkoutRemove("ghost_routine", new Set(["other_routine"]))).toThrow(
      /ghost_routine/,
    );
  });
});

describe("buildManifestContent", () => {
  it("round-trips the template_ids list", () => {
    const content = buildManifestContent(["a", "b"], "t1");
    expect(JSON.parse(content).template_ids).toEqual(["a", "b"]);
  });
});

describe("buildWorkoutCreateWrite", () => {
  it("returns no writes when workout_create is absent", () => {
    const result = buildWorkoutCreateWrite("t1", undefined, new Set(), new Set(), null);
    expect(result).toEqual({ writes: [], dropped: [] });
  });

  it("builds the routine file write and the manifest write together, in the same commit", () => {
    const { writes, dropped } = buildWorkoutCreateWrite(
      "t1",
      minimalSpec(),
      new Set(["existing_routine"]),
      new Set(),
      null,
    );
    expect(dropped).toEqual([]);
    expect(writes).toHaveLength(2);
    const [routineWrite, manifestWrite] = writes as { path: string; content: string }[];
    expect(routineWrite.path).toBe(
      "user_data/activities/workout_plans/templates/upper_body_pump.json",
    );
    expect(manifestWrite.path).toBe("user_data/activities/workout_plans/templates/_manifest.json");
    expect(JSON.parse(manifestWrite.content).template_ids).toEqual([
      "existing_routine",
      "upper_body_pump",
    ]);
  });

  it("reports a thrown invariant as a dropped action instead of propagating - one bad action never costs the rest of the turn", () => {
    const { writes, dropped } = buildWorkoutCreateWrite(
      "t1",
      minimalSpec(),
      new Set(),
      new Set(["inj_shoulder"]),
      null,
    );
    expect(writes).toEqual([]);
    expect(dropped).toEqual([expect.objectContaining({ field: "workout_create" })]);
  });
});

describe("buildWorkoutRemoveWrite", () => {
  it("returns no writes when workout_remove is absent", () => {
    expect(buildWorkoutRemoveWrite("t1", undefined, new Set())).toEqual({
      writes: [],
      dropped: [],
    });
  });

  it("deletes the routine file and drops the manifest entry, in the same commit", () => {
    const { writes, dropped } = buildWorkoutRemoveWrite(
      "t1",
      { routine_id: "old_routine" },
      new Set(["old_routine", "keep_routine"]),
    );
    expect(dropped).toEqual([]);
    expect(writes).toHaveLength(2);
    const [deleteEntry, manifestWrite] = writes as (
      | { path: string; delete: true }
      | { path: string; content: string }
    )[];
    expect(deleteEntry).toEqual({
      path: "user_data/activities/workout_plans/templates/old_routine.json",
      delete: true,
    });
    expect(JSON.parse((manifestWrite as { content: string }).content).template_ids).toEqual([
      "keep_routine",
    ]);
  });

  it("reports an unknown routine_id as a dropped action instead of throwing", () => {
    const { writes, dropped } = buildWorkoutRemoveWrite(
      "t1",
      { routine_id: "ghost_routine" },
      new Set(["keep_routine"]),
    );
    expect(writes).toEqual([]);
    expect(dropped).toEqual([expect.objectContaining({ field: "workout_remove" })]);
  });
});

describe("ordinary turn mode exposes both actions", () => {
  it("includes workout_create and workout_remove for a returning athlete's ordinary turn, but not First Session", () => {
    const returningFields = Object.keys(
      generationConfigFor("ordinary", false).responseSchema.properties,
    );
    expect(returningFields).toContain("workout_create");
    expect(returningFields).toContain("workout_remove");

    const firstSessionFields = Object.keys(
      generationConfigFor("ordinary", true).responseSchema.properties,
    );
    expect(firstSessionFields).not.toContain("workout_create");
    expect(firstSessionFields).not.toContain("workout_remove");
  });

  it("makes injury_ack structurally required on workout_create when the athlete has an active flag", () => {
    const withoutFlags = generationConfigFor("ordinary", false).responseSchema.properties
      .workout_create as unknown as { required: readonly string[] };
    expect(withoutFlags.required).not.toContain("injury_ack");

    const withFlags = generationConfigFor("ordinary", false, {
      activeInjuryFlagIds: ["inj_shoulder"],
    }).responseSchema.properties.workout_create as unknown as {
      required: readonly string[];
      properties: { injury_ack: { items: { properties: { flag: { enum: readonly string[] } } } } };
    };
    expect(withFlags.required).toContain("injury_ack");
    expect(withFlags.properties.injury_ack.items.properties.flag.enum).toEqual(["inj_shoulder"]);
  });
});
