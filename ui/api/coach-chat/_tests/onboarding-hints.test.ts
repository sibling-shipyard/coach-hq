import { describe, it, expect } from "vitest";
import { onboardingHintsContext } from "../_lib/gemini/coachPromptText.js";

// Native onboarding fields are already committed before the greeting call. This context gives
// Gemini the same-request snapshot, especially the name it cannot re-read from profile.json yet.
describe("onboardingHintsContext", () => {
  it("returns undefined when hints are undefined", () => {
    expect(onboardingHintsContext(undefined)).toBeUndefined();
  });

  it("returns undefined when every hint is empty", () => {
    expect(onboardingHintsContext({ name: "", sports: [] })).toBeUndefined();
  });

  it("returns undefined when name is only whitespace and sports is empty", () => {
    expect(onboardingHintsContext({ name: "   ", sports: [] })).toBeUndefined();
  });

  it("includes and trims the athlete name", () => {
    const result = onboardingHintsContext({ name: "  Skanda  " });
    expect(result).toContain("Name: Skanda");
    expect(result).not.toContain("  Skanda  ");
  });

  it("includes sports when present", () => {
    const result = onboardingHintsContext({ sports: ["Running", "Strength"] });
    expect(result).toContain("Sport(s): Running, Strength");
  });

  it("includes name and sports together", () => {
    const result = onboardingHintsContext({ name: "Skanda", sports: ["Badminton"] });
    expect(result).toContain("Name: Skanda");
    expect(result).toContain("Sport(s): Badminton");
  });
});
