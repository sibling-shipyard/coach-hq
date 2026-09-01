import { describe, it, expect } from "vitest";
import { validTemplates, validSessions, type Workout, type WorkoutsData } from "./workouts";

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: "strength-a",
    title: "Strength A",
    subtitle: "Upper body",
    workout_type: "strength",
    estimated_duration_mins: 45,
    location: "gym",
    equipment: [],
    coaching_note: "",
    phases: [],
    ...overrides,
  };
}

describe("validTemplates", () => {
  it("keeps real templates with a phases array", () => {
    const data: WorkoutsData = { templates: [workout()], sessions: [] };
    expect(validTemplates(data)).toHaveLength(1);
  });

  it("drops the _manifest.json sidecar (no id, no phases)", () => {
    const manifestSidecar = { template_ids: ["strength-a"] } as unknown as Workout;
    const data: WorkoutsData = { templates: [workout(), manifestSidecar], sessions: [] };
    const result = validTemplates(data);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("strength-a");
  });

  it("drops any entry whose id ends in _manifest", () => {
    const data: WorkoutsData = {
      templates: [workout(), workout({ id: "workout_plans_manifest" })],
      sessions: [],
    };
    expect(validTemplates(data)).toHaveLength(1);
  });

  it("drops entries missing a phases array even with a normal id", () => {
    const noPhases = { ...workout(), phases: undefined } as unknown as Workout;
    const data: WorkoutsData = { templates: [workout(), noPhases], sessions: [] };
    expect(validTemplates(data)).toHaveLength(1);
  });

  it("never throws on an empty or missing templates array", () => {
    expect(validTemplates({ templates: [], sessions: [] })).toEqual([]);
    expect(validTemplates({} as WorkoutsData)).toEqual([]);
  });
});

describe("validSessions", () => {
  it("keeps real sessions with a phases array", () => {
    const data: WorkoutsData = {
      templates: [],
      sessions: [workout({ session_date: "2026-09-01" })],
    };
    expect(validSessions(data)).toHaveLength(1);
  });

  it("drops a manifest-shaped entry with no id or phases", () => {
    const manifestSidecar = { template_ids: [] } as unknown as Workout;
    const data: WorkoutsData = { templates: [], sessions: [manifestSidecar] };
    expect(validSessions(data)).toEqual([]);
  });
});
