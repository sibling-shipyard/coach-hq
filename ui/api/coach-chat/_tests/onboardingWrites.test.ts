import { describe, expect, it } from "vitest";
import type { MemoryJson, ProfileJson } from "../_lib/coachMemoryFiles.js";
import { onboardingChanges } from "../_lib/onboardingWrites.js";

const profile = { name: "Skanda" } as ProfileJson;
const memory = { sports: ["Badminton", "Strength"], coaching_style: "analysis" } as MemoryJson;

describe("onboardingChanges", () => {
  it("returns no changes when a retry carries facts already written", () => {
    expect(onboardingChanges(
      { name: "Skanda", sports: ["Badminton", "Strength"], coaching_style: "analysis" },
      profile,
      memory,
    )).toEqual({ name: undefined, sports: undefined, coachingStyle: undefined });
  });

  it("treats surrounding whitespace as the same persisted values", () => {
    expect(onboardingChanges(
      { name: "  Skanda ", sports: [" Badminton", "Strength  "], coaching_style: "analysis" },
      profile,
      memory,
    )).toEqual({ name: undefined, sports: undefined, coachingStyle: undefined });
  });

  it("returns only fields that differ from the loaded snapshot", () => {
    expect(onboardingChanges(
      { name: "Skanda", sports: ["Running"], coaching_style: "encouragement" },
      profile,
      memory,
    )).toEqual({ name: undefined, sports: ["Running"], coachingStyle: "encouragement" });
  });

  it("returns all supplied facts for a cold athlete", () => {
    expect(onboardingChanges(
      { name: "Skanda", sports: ["Badminton"], coaching_style: "accountability" },
      null,
      null,
    )).toEqual({ name: "Skanda", sports: ["Badminton"], coachingStyle: "accountability" });
  });
});
