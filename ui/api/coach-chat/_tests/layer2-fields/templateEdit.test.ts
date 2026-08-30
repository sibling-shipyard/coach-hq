import { describe, it, expect } from "vitest";
import {
  applyTemplateEdit,
  validTemplateIdsFromManifest,
  templatePath,
} from "../../_lib/coachWorkoutFiles.js";
import type { Workout } from "../../../../client/src/lib/workouts.js";

// coach-redesign workout-backend-wiring §3: template_edit action field. Purely mechanical now -
// same skip_exercise_nums/skip_phases primitives as session_plan, no Gemini-generated content, no
// second network call. Covers the hallucinated-id guard, the skip/renumber/note behavior (mirrors
// sessionPlan.test.ts), and validateWorkout as the final backstop.

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
      {
        name: "Warmup",
        duration: "10 min",
        default_rest_secs: 30,
        exercises: [
          {
            num: 1,
            name: "Arm circles",
            type: "timed",
            duration_secs: 30,
            sets: 1,
            form_cue: "Slow.",
            why: "Warm up.",
          },
          {
            num: 2,
            name: "Band pull-aparts",
            type: "reps",
            reps: 15,
            sets: 2,
            form_cue: "Squeeze.",
            why: "Activate.",
          },
        ],
      },
      {
        name: "Main set",
        duration: "30 min",
        default_rest_secs: 60,
        exercises: [
          {
            num: 3,
            name: "Push-ups",
            type: "reps",
            reps: 12,
            sets: 3,
            form_cue: "Elbows in.",
            why: "Chest strength.",
          },
          {
            num: 4,
            name: "Rows",
            type: "reps",
            reps: 10,
            sets: 3,
            form_cue: "Squeeze back.",
            why: "Balance pushing work.",
          },
          {
            num: 5,
            name: "Overhead Press",
            type: "reps",
            reps: 8,
            sets: 3,
            form_cue: "Brace core.",
            why: "Shoulder strength.",
          },
        ],
      },
    ],
    ...overrides,
  };
}

const currentTemplateContent = JSON.stringify(validWorkout());

describe("validTemplateIdsFromManifest", () => {
  it("returns the manifest's template_ids as a set", () => {
    const manifest = JSON.stringify({
      generated_at: "2026-08-18T00:00:00Z",
      trace_id: "t1",
      template_ids: ["strength_b", "foundation_a"],
    });
    const ids = validTemplateIdsFromManifest(manifest);
    expect(ids.has("strength_b")).toBe(true);
    expect(ids.has("foundation_a")).toBe(true);
    expect(ids.has("nonexistent")).toBe(false);
  });

  it("treats missing manifest content as no valid ids, not a throw", () => {
    expect(validTemplateIdsFromManifest(null).size).toBe(0);
  });

  it("treats unparseable manifest content as no valid ids, not a throw", () => {
    expect(validTemplateIdsFromManifest("{not valid json").size).toBe(0);
  });

  it("treats a manifest with no template_ids array as no valid ids", () => {
    expect(
      validTemplateIdsFromManifest(JSON.stringify({ generated_at: "2026-08-18T00:00:00Z" })).size,
    ).toBe(0);
  });
});

describe("templatePath", () => {
  it("builds the athlete's templates/<id>.json path", () => {
    expect(templatePath("strength_b")).toBe(
      "user_data/activities/workout_plans/templates/strength_b.json",
    );
  });
});

describe("applyTemplateEdit", () => {
  const validIds = new Set(["strength_b"]);

  it("throws with the hallucinated-id message when template_id isn't in validTemplateIds", () => {
    expect(() =>
      applyTemplateEdit(currentTemplateContent, { template_id: "made_up_id" }, validIds, "t1"),
    ).toThrow('template_edit: no template with id "made_up_id" in this athlete\'s templates');
  });

  it("throws when the manifest is empty (no templates editable yet)", () => {
    expect(() =>
      applyTemplateEdit(currentTemplateContent, { template_id: "strength_b" }, new Set(), "t1"),
    ).toThrow('template_edit: no template with id "strength_b"');
  });

  it("throws when the current template content can't be read", () => {
    expect(() => applyTemplateEdit(null, { template_id: "strength_b" }, validIds, "t1")).toThrow(
      'template_edit: template "strength_b" could not be read',
    );
  });

  it("applies skip_exercise_nums permanently, renumbering the rest, and stamps _meta", () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", skip_exercise_nums: [3] },
      validIds,
      "trace-1",
    );
    const parsed = JSON.parse(result);
    expect(parsed.phases.flatMap((p: any) => p.exercises.map((e: any) => e.num))).toEqual([
      1, 2, 3, 4,
    ]);
    expect(parsed.phases.flatMap((p: any) => p.exercises.map((e: any) => e.name))).toEqual([
      "Arm circles",
      "Band pull-aparts",
      "Rows",
      "Overhead Press",
    ]);
    expect(parsed._meta).toMatchObject({ updated_by: "model", trace_id: "trace-1" });
  });

  it("resolves skip_phases by name (case-insensitive), dropping the whole phase", () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", skip_phases: ["warmup"] },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(result);
    expect(parsed.phases).toHaveLength(1);
    expect(parsed.phases[0].exercises.map((e: any) => e.num)).toEqual([1, 2, 3]);
  });

  it("appends note to coaching_note rather than replacing it", () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", skip_exercise_nums: [5], note: "shoulder still recovering" },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(result);
    expect(parsed.coaching_note).toBe("Keep form tight. — shoulder still recovering");
  });

  it("appends note when no skip was requested at all (a pure note-only edit)", () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", note: "just leaving context" },
      validIds,
      "t1",
    );
    expect(JSON.parse(result).coaching_note).toBe("Keep form tight. — just leaving context");
  });

  it('does NOT append the note when a skip was requested but matched nothing real (adversarial testing: "drop the burpees" when no such exercise/phase exists)', () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      {
        template_id: "strength_b",
        skip_phases: ["Nonexistent Phase"],
        note: "removed burpees per athlete request",
      },
      validIds,
      "t1",
    );
    const parsed = JSON.parse(result);
    expect(parsed.coaching_note).toBe("Keep form tight.");
    expect(parsed.phases).toHaveLength(2);
  });

  it("produces schema-valid output", () => {
    const result = applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", skip_exercise_nums: [3] },
      validIds,
      "t1",
    );
    expect(() => JSON.parse(result)).not.toThrow();
  });
});
