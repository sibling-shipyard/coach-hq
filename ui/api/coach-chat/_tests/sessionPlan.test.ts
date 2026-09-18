import { describe, it, expect, vi } from "vitest";
import {
  applySessionPlan,
  renumberAfterSkip,
  sessionPath,
  templatePath,
} from "../_lib/decide/coachWorkoutFiles.js";
import type { Workout } from "../../../client/src/lib/workouts.js";

// coach-redesign workout-backend-wiring §4: session_plan action field. Covers the renumbering
// logic (the trickiest part - get it right per B_engine.md's "no gaps" rule), the hallucinated-id
// guard, and session_date/based_on_template getting set correctly, with validateWorkout as the
// final backstop against committing something malformed.

function ex(num: number, name = `Exercise ${num}`) {
  return { num, name, type: "reps" as const, reps: 10, sets: 3, form_cue: "Form.", why: "Why." };
}

function validWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: "strength_b",
    title: "Strength B",
    subtitle: "Upper body focus",
    workout_type: "strength",
    estimated_duration_mins: 45,
    location: "gym",
    equipment: ["dumbbells"],
    coaching_note: "Keep form tight.",
    phases: [
      { name: "Warmup", duration: "10 min", default_rest_secs: 30, exercises: [ex(1), ex(2)] },
      {
        name: "Main set",
        duration: "30 min",
        default_rest_secs: 60,
        exercises: [ex(3), ex(4), ex(5)],
      },
    ],
    ...overrides,
  };
}

describe("sessionPath", () => {
  it("builds the sessions/<date>_<template_id>.json path", () => {
    expect(sessionPath("2026-08-18", "strength_b")).toBe(
      "user_data/activities/workout_plans/sessions/2026-08-18_strength_b.json",
    );
  });
});

describe("renumberAfterSkip", () => {
  it("is a no-op passthrough when skipping nothing", () => {
    const phases = validWorkout().phases;
    const result = renumberAfterSkip(phases, []);
    expect(result.map((p) => p.exercises.map((e) => e.num))).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it("renumbers everything after a skipped middle exercise, no gaps", () => {
    const phases = validWorkout().phases;
    const result = renumberAfterSkip(phases, [3]);
    expect(result.map((p) => p.exercises.map((e) => e.num))).toEqual([
      [1, 2],
      [3, 4],
    ]);
    // Original relative order preserved - exercise originally num 4 is now num 3, num 5 is now num 4.
    expect(result[1].exercises.map((e) => e.name)).toEqual(["Exercise 4", "Exercise 5"]);
  });

  it("renumbers correctly when the skip crosses a phase boundary", () => {
    const phases = validWorkout().phases;
    const result = renumberAfterSkip(phases, [2, 3]);
    expect(result.map((p) => p.exercises.map((e) => e.num))).toEqual([[1], [2, 3]]);
    expect(result[0].exercises.map((e) => e.name)).toEqual(["Exercise 1"]);
    expect(result[1].exercises.map((e) => e.name)).toEqual(["Exercise 4", "Exercise 5"]);
  });

  it("drops a phase entirely rather than leaving it empty when every exercise in it is skipped", () => {
    const phases = validWorkout().phases;
    const result = renumberAfterSkip(phases, [1, 2]);
    expect(result).toHaveLength(1);
    expect(result[0].exercises.map((e) => e.num)).toEqual([1, 2, 3]);
  });
});

describe("applySessionPlan", () => {
  const validIds = new Set(["strength_b"]);
  const currentTemplateContent = JSON.stringify(validWorkout());

  it("throws with the hallucinated-id message when template_id isn't in validTemplateIds", () => {
    expect(() =>
      applySessionPlan(
        currentTemplateContent,
        { template_id: "made_up_id", session_date: "2026-08-18" },
        validIds,
        "t1",
      ),
    ).toThrow('session_plan: no template with id "made_up_id" in this athlete\'s templates');
  });

  it("throws when the manifest is empty (no templates plannable yet)", () => {
    expect(() =>
      applySessionPlan(
        currentTemplateContent,
        { template_id: "strength_b", session_date: "2026-08-18" },
        new Set(),
        "t1",
      ),
    ).toThrow('session_plan: no template with id "strength_b"');
  });

  it("throws when the current template content can't be read", () => {
    expect(() =>
      applySessionPlan(
        null,
        { template_id: "strength_b", session_date: "2026-08-18" },
        validIds,
        "t1",
      ),
    ).toThrow('session_plan: template "strength_b" could not be read');
  });

  it("sets session_date and based_on_template correctly, stamps _meta, and is a no-op on exercises with no skip list", () => {
    const { path, content } = applySessionPlan(
      currentTemplateContent,
      { template_id: "strength_b", session_date: "2026-08-18" },
      validIds,
      "trace-1",
    );
    expect(path).toBe("user_data/activities/workout_plans/sessions/2026-08-18_strength_b.json");
    const parsed = JSON.parse(content);
    expect(parsed.session_date).toBe("2026-08-18");
    expect(parsed.based_on_template).toBe(templatePath("strength_b"));
    expect(parsed._meta).toMatchObject({ updated_by: "model", trace_id: "trace-1" });
    expect(parsed.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    // No note given - base coaching_note left untouched.
    expect(parsed.coaching_note).toBe("Keep form tight.");
  });

  it("applies skip_exercise_nums and appends the note to coaching_note", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      {
        template_id: "strength_b",
        session_date: "2026-08-18",
        skip_exercise_nums: [3],
        note: "knee modification",
      },
      validIds,
      "trace-1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num))).toEqual([
      1, 2, 3, 4,
    ]);
    expect(parsed.coaching_note).toBe("Keep form tight. — knee modification");
  });

  it("does NOT append the note when a skip was requested but matched nothing real", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      {
        template_id: "strength_b",
        session_date: "2026-08-18",
        skip_exercise_nums: [999],
        note: "removed the burpees",
      },
      validIds,
      "trace-1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.coaching_note).toBe("Keep form tight.");
  });

  it("drops a phase entirely, rather than rejecting the result, when every exercise in it is skipped", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      { template_id: "strength_b", session_date: "2026-08-18", skip_exercise_nums: [1, 2] },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].exercises.map((e: any) => e.num)).toEqual([1, 2, 3]);
  });

  // skip_phases: Gemini is never shown exercise numbers (see LlmReply's own comment on
  // session_plan), so a real athlete request like "skip the warmup" or "skip the shoulder phase"
  // has to be resolved server-side from the phase's plain-language name, not a number Gemini could
  // never actually know.
  it("resolves skip_phases by name (case-insensitive) to the phase's exercise nums", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      { template_id: "strength_b", session_date: "2026-08-18", skip_phases: ["warmup"] },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].exercises.map((e: any) => e.num)).toEqual([1, 2, 3]);
  });

  it("combines skip_phases and skip_exercise_nums together", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      {
        template_id: "strength_b",
        session_date: "2026-08-18",
        skip_phases: ["Warmup"],
        skip_exercise_nums: [5],
      },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].exercises.map((e: any) => e.num)).toEqual([1, 2]);
  });

  it("ignores an unrecognized phase name rather than throwing or failing the whole plan", () => {
    const { content } = applySessionPlan(
      currentTemplateContent,
      { template_id: "strength_b", session_date: "2026-08-18", skip_phases: ["Cooldown Stretch"] },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(content);
    expect(parsed.phases).toHaveLength(2);
    expect(parsed.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  // Round-2 live pass: the model said "core" for a phase named "Core & Cool-down" and the exact
  // match silently skipped nothing while the reply claimed it was dropped.
  describe("skip_phases partial-name matching", () => {
    const template = JSON.stringify(
      validWorkout({
        phases: [
          { name: "Warmup", duration: "5 min", default_rest_secs: 30, exercises: [ex(1)] },
          {
            name: "Core & Cool-down",
            duration: "10 min",
            default_rest_secs: 30,
            exercises: [ex(2), ex(3)],
          },
          { name: "Main set", duration: "30 min", default_rest_secs: 60, exercises: [ex(4)] },
        ],
      }),
    );
    const plan = (skip: string[]) =>
      JSON.parse(
        applySessionPlan(
          template,
          { template_id: "strength_b", session_date: "2026-08-18", skip_phases: skip },
          validIds,
          "t1",
        ).content,
      );

    it("resolves a unique whole-word match", () => {
      expect(plan(["core"]).phases.map((p: any) => p.name)).toEqual(["Warmup", "Main set"]);
    });

    it("resolves a multi-word partial match", () => {
      expect(plan(["cool-down"]).phases.map((p: any) => p.name)).toEqual(["Warmup", "Main set"]);
    });

    it("does not match inside a longer word", () => {
      expect(plan(["war"]).phases).toHaveLength(3);
    });

    it("ignores an ambiguous match instead of guessing", () => {
      const twoSets = JSON.stringify(
        validWorkout({
          phases: [
            { name: "Main set A", duration: "10 min", default_rest_secs: 30, exercises: [ex(1)] },
            { name: "Main set B", duration: "10 min", default_rest_secs: 30, exercises: [ex(2)] },
          ],
        }),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { content } = applySessionPlan(
        twoSets,
        { template_id: "strength_b", session_date: "2026-08-18", skip_phases: ["main"] },
        validIds,
        "t1",
      );
      expect(JSON.parse(content).phases).toHaveLength(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("matches more than one phase"), {
        traceId: "t1",
      });
      warn.mockRestore();
    });
  });
});
