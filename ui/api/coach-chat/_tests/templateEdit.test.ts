import { describe, it, expect, vi } from "vitest";
import {
  applyTemplateEdit,
  validTemplateIdsFromManifest,
  templatePath,
  type EditTemplateFn,
} from "../_lib/coachWorkoutFiles.js";
import type { Workout } from "../../../client/src/lib/workouts.js";

// coach-redesign workout-backend-wiring §3: template_edit action field. Covers the two guards
// applyTemplateEdit exists to enforce - a hallucinated/stale template_id must never write, and a
// structurally malformed Gemini response must never commit - with the Gemini call itself always
// mocked (EditTemplateFn injection) so this suite never needs real network access.

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
        name: "Main set",
        duration: "30 min",
        default_rest_secs: 60,
        exercises: [
          { num: 1, name: "Push-ups", type: "reps", reps: 12, sets: 3, form_cue: "Elbows in.", why: "Chest strength." },
        ],
      },
    ],
    ...overrides,
  };
}

const currentTemplateContent = JSON.stringify(validWorkout());

describe("validTemplateIdsFromManifest", () => {
  it("returns the manifest's template_ids as a set", () => {
    const manifest = JSON.stringify({ generated_at: "2026-08-18T00:00:00Z", trace_id: "t1", template_ids: ["strength_b", "foundation_a"] });
    const ids = validTemplateIdsFromManifest(manifest);
    expect(ids.has("strength_b")).toBe(true);
    expect(ids.has("foundation_a")).toBe(true);
    expect(ids.has("nonexistent")).toBe(false);
  });

  it("treats missing manifest content as no valid ids, not a throw", () => {
    const ids = validTemplateIdsFromManifest(null);
    expect(ids.size).toBe(0);
  });

  it("treats unparseable manifest content as no valid ids, not a throw", () => {
    const ids = validTemplateIdsFromManifest("{not valid json");
    expect(ids.size).toBe(0);
  });

  it("treats a manifest with no template_ids array as no valid ids", () => {
    const ids = validTemplateIdsFromManifest(JSON.stringify({ generated_at: "2026-08-18T00:00:00Z" }));
    expect(ids.size).toBe(0);
  });
});

describe("templatePath", () => {
  it("builds the athlete's templates/<id>.json path", () => {
    expect(templatePath("strength_b")).toBe("user_data/activities/workout_plans/templates/strength_b.json");
  });
});

describe("applyTemplateEdit", () => {
  const validIds = new Set(["strength_b"]);

  it("throws with the hallucinated-id message when template_id isn't in validTemplateIds", async () => {
    const editFn: EditTemplateFn = vi.fn();
    await expect(
      applyTemplateEdit(
        currentTemplateContent,
        { template_id: "made_up_id", instruction: "add more exercises" },
        validIds,
        "t1",
        "fake-key",
        editFn,
      ),
    ).rejects.toThrow('template_edit: no template with id "made_up_id" in this athlete\'s templates');
    expect(editFn).not.toHaveBeenCalled();
  });

  it("throws when the manifest is empty (no templates editable yet)", async () => {
    await expect(
      applyTemplateEdit(
        currentTemplateContent,
        { template_id: "strength_b", instruction: "add more exercises" },
        new Set(),
        "t1",
        "fake-key",
      ),
    ).rejects.toThrow('template_edit: no template with id "strength_b"');
  });

  it("accepts a well-formed Gemini-returned Workout and stamps _meta", async () => {
    const edited = validWorkout({
      phases: [
        {
          name: "Main set",
          duration: "35 min",
          default_rest_secs: 60,
          exercises: [
            { num: 1, name: "Push-ups", type: "reps", reps: 12, sets: 3, form_cue: "Elbows in.", why: "Chest strength." },
            { num: 2, name: "Rows", type: "reps", reps: 10, sets: 3, form_cue: "Squeeze back.", why: "Balance pushing work." },
          ],
        },
      ],
    });
    const editFn: EditTemplateFn = vi.fn().mockResolvedValue(edited);

    const result = await applyTemplateEdit(
      currentTemplateContent,
      { template_id: "strength_b", instruction: "add a row exercise" },
      validIds,
      "trace-1",
      "fake-key",
      editFn,
    );

    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("strength_b");
    expect(parsed.phases[0].exercises).toHaveLength(2);
    expect(parsed._meta).toMatchObject({ updated_by: "model", trace_id: "trace-1" });
    expect(editFn).toHaveBeenCalledWith("fake-key", JSON.parse(currentTemplateContent), "add a row exercise");
  });

  it("rejects a malformed Gemini response (missing required field) rather than committing it", async () => {
    const malformed = { id: "strength_b", title: "Strength B" }; // missing phases, etc.
    const editFn: EditTemplateFn = vi.fn().mockResolvedValue(malformed);

    await expect(
      applyTemplateEdit(
        currentTemplateContent,
        { template_id: "strength_b", instruction: "add more exercises" },
        validIds,
        "t1",
        "fake-key",
        editFn,
      ),
    ).rejects.toThrow(/workout schema/);
  });

  it("rejects a Gemini response whose id doesn't match the requested template_id", async () => {
    const edited = validWorkout({ id: "different_id" });
    const editFn: EditTemplateFn = vi.fn().mockResolvedValue(edited);

    await expect(
      applyTemplateEdit(
        currentTemplateContent,
        { template_id: "strength_b", instruction: "add more exercises" },
        validIds,
        "t1",
        "fake-key",
        editFn,
      ),
    ).rejects.toThrow('template_edit: Gemini returned id "different_id", expected "strength_b" to stay unchanged');
  });

  it("throws when the current template content can't be read", async () => {
    const editFn: EditTemplateFn = vi.fn();
    await expect(
      applyTemplateEdit(
        null,
        { template_id: "strength_b", instruction: "add more exercises" },
        validIds,
        "t1",
        "fake-key",
        editFn,
      ),
    ).rejects.toThrow('template_edit: template "strength_b" could not be read');
    expect(editFn).not.toHaveBeenCalled();
  });
});
