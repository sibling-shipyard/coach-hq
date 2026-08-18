import { describe, it, expect, vi } from "vitest";
import {
  selectTemplates,
  generateInitialTemplates,
  loadWorkoutLibraryIndex,
  type WorkoutLibraryIndexEntry,
} from "../_lib/coachWorkoutFiles.js";
import type { ProfileJson, MemoryJson, InjuriesJson } from "../_lib/coachMemoryFiles.js";

// coach-redesign workout-backend-wiring §2: unit coverage for selectTemplates's deterministic
// tag-matching logic (especially the injury-filtering case, since a wrong pick here could
// aggravate a real injury) and for generateInitialTemplates's output always matching the Workout
// schema shape, with the Gemini call mocked so this suite never needs real API access.

function profile(overrides: Partial<ProfileJson> = {}): ProfileJson {
  return {
    version: 1,
    coach_since: null,
    name: "Skanda",
    dob: null,
    timezone: "Asia/Kolkata",
    height_cm: null,
    weight_kg: null,
    ...overrides,
  };
}

function defaultNotes(): MemoryJson["notes"] {
  return {
    fitness_baseline: { text: "", updated_at: "", trace_id: "" },
    coaching_priorities: { text: "", updated_at: "", trace_id: "" },
    "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
    "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
    "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
    equipment: { text: "", updated_at: "", trace_id: "" },
  };
}

function memory(overrides: Partial<MemoryJson> = {}): MemoryJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    sports: ["badminton"],
    coaching_style: "",
    ...overrides,
    notes: { ...defaultNotes(), ...(overrides.notes ?? {}) },
  };
}

function injuries(flags: InjuriesJson["flags"] = []): InjuriesJson {
  return { flags };
}

const realLibrary = loadWorkoutLibraryIndex();

describe("selectTemplates", () => {
  it("picks 4-6 templates for a plain general-fitness athlete", () => {
    const ids = selectTemplates(profile(), memory({ sports: ["general_fitness"] }), injuries(), realLibrary);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(ids.length).toBeLessThanOrEqual(6);
    // No duplicates.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers more than one workout_type when the library has variety", () => {
    const ids = selectTemplates(profile(), memory({ sports: ["general_fitness"] }), injuries(), realLibrary);
    const prefixes = new Set(ids.map((id) => id.split("_")[0]));
    expect(prefixes.size).toBeGreaterThan(1);
  });

  it("excludes shoulder-loading templates when an active shoulder injury flag is present", () => {
    const shoulderInjuries = injuries([
      { id: "inj_1", text: "sore rotator cuff, avoid overhead work", status: "active", opened_at: "2026-08-01", resolved_at: null },
    ]);
    const ids = selectTemplates(profile(), memory({ sports: ["badminton"] }), shoulderInjuries, realLibrary);
    // realign_shoulder_prehab's own sport_tags (badminton/swimming/tennis) are exactly what the
    // shoulder-conflict rule excludes, so with an active shoulder flag it should never be picked
    // even though it would otherwise be a near-perfect sport match.
    expect(ids).not.toContain("realign_shoulder_prehab");
    // calisthenics templates are also tagged as a shoulder-conflicting sport.
    expect(ids.some((id) => id.startsWith("calisthenics_"))).toBe(false);
  });

  it("does not exclude shoulder-tagged templates when the injury flag is resolved, not active", () => {
    const resolvedInjuries = injuries([
      { id: "inj_1", text: "sore shoulder", status: "resolved", opened_at: "2026-08-01", resolved_at: "2026-08-10" },
    ]);
    const idsWithResolved = selectTemplates(profile(), memory({ sports: ["badminton"] }), resolvedInjuries, realLibrary);
    const idsWithNone = selectTemplates(profile(), memory({ sports: ["badminton"] }), injuries(), realLibrary);
    expect(idsWithResolved).toEqual(idsWithNone);
  });

  it("excludes running-conflicting templates for an active knee flag", () => {
    const kneeInjuries = injuries([
      { id: "inj_1", text: "knee pain when running", status: "active", opened_at: "2026-08-01", resolved_at: null },
    ]);
    const ids = selectTemplates(profile(), memory({ sports: ["running"] }), kneeInjuries, realLibrary);
    expect(ids).not.toContain("foundation_running_prehab");
    expect(ids).not.toContain("recovery_post_run_stretch");
  });

  it("up-ranks an injury_prevention template when an active flag exists, without requiring it", () => {
    const backInjuries = injuries([
      { id: "inj_1", text: "lower back tightness", status: "active", opened_at: "2026-08-01", resolved_at: null },
    ]);
    const ids = selectTemplates(profile(), memory({ sports: ["general_fitness"] }), backInjuries, realLibrary);
    // At least one injury_prevention-tagged template should be present.
    const injuryPreventionIds = new Set(
      realLibrary.filter((e) => e.goal_tags.includes("injury_prevention")).map((e) => e.id),
    );
    expect(ids.some((id) => injuryPreventionIds.has(id))).toBe(true);
  });

  it("works against a synthetic library for a narrow deterministic check", () => {
    const library: WorkoutLibraryIndexEntry[] = [
      { id: "a_match", sport_tags: ["running"], equipment: ["bodyweight"], goal_tags: ["endurance"], level: "beginner" },
      { id: "b_mismatch", sport_tags: ["swimming"], equipment: ["full_gym"], goal_tags: ["build_strength"], level: "advanced" },
    ];
    const ids = selectTemplates(profile(), memory({ sports: ["running"] }), injuries(), library);
    expect(ids[0]).toBe("a_match");
  });
});

describe("generateInitialTemplates", () => {
  it("returns FileEntry writes whose content always matches the Workout schema shape", async () => {
    const mockAdjust = vi.fn().mockResolvedValue([
      { template_id: "foundation_bodyweight_beginner", coaching_note: "Tuned for you." },
    ]);

    const { templates } = await generateInitialTemplates(
      profile(),
      memory({ sports: ["general_fitness"] }),
      injuries(),
      "Asia/Kolkata",
      "trace-123",
      "fake-api-key",
      mockAdjust,
    );

    // One manifest + N template writes.
    const manifestEntry = templates.find((t) => t.path.endsWith("_manifest.json"));
    expect(manifestEntry).toBeDefined();
    const templateEntries = templates.filter((t) => t !== manifestEntry);
    expect(templateEntries.length).toBeGreaterThanOrEqual(4);

    for (const entry of templateEntries) {
      expect("content" in entry).toBe(true);
      const content = (entry as { content: string }).content;
      const workout = JSON.parse(content);
      expect(typeof workout.id).toBe("string");
      expect(typeof workout.title).toBe("string");
      expect(Array.isArray(workout.phases)).toBe(true);
      expect(workout.phases.length).toBeGreaterThan(0);
      expect(workout._meta).toBeDefined();
      expect(workout._meta.trace_id).toBe("trace-123");
      expect(entry.path).toBe(`user_data/activities/workout_plans/templates/${workout.id}.json`);
    }

    // The Gemini-adjusted template picked up its adjustment.
    const adjustedEntry = templateEntries.find((t) => t.path.includes("foundation_bodyweight_beginner"));
    if (adjustedEntry) {
      const workout = JSON.parse((adjustedEntry as { content: string }).content);
      expect(workout.coaching_note).toBe("Tuned for you.");
    }
  });

  it("falls back to unadjusted library templates when the Gemini call throws", async () => {
    const mockAdjust = vi.fn().mockRejectedValue(new Error("network down"));

    const { templates } = await generateInitialTemplates(
      profile(),
      memory({ sports: ["general_fitness"] }),
      injuries(),
      "Asia/Kolkata",
      "trace-456",
      "fake-api-key",
      mockAdjust,
    );

    expect(templates.length).toBeGreaterThanOrEqual(4);
    for (const entry of templates) {
      expect("content" in entry).toBe(true);
    }
  });
});
