import { describe, it, expect } from "vitest";
import { onboardingHintsContext } from "../coach-chat/_lib/coachPrompt.js";

// B4: formats iOS's native onboarding sport/goal hints into extra prompt context for the
// greeting turn, so platform/soul/B_engine.md's First Session Protocol can reflect them back
// instead of asking cold. Undefined means "nothing to inject" - web athletes and reinstalls
// never send hints, and the greeting-mode prompt already handles the fresh-ask path fine without
// this context block present at all.
describe("onboardingHintsContext", () => {
  it("returns undefined when hints are undefined", () => {
    expect(onboardingHintsContext(undefined)).toBeUndefined();
  });

  it("returns undefined when both sports and goal are empty", () => {
    expect(onboardingHintsContext({ sports: [], goal: "" })).toBeUndefined();
  });

  it("returns undefined when goal is only whitespace and sports is empty", () => {
    expect(onboardingHintsContext({ sports: [], goal: "   " })).toBeUndefined();
  });

  it("includes sports when present", () => {
    const result = onboardingHintsContext({ sports: ["Running", "Strength"], goal: "" });
    expect(result).toContain("Sport(s) selected: Running, Strength");
    expect(result).not.toContain("Goal entered");
  });

  it("includes goal when present", () => {
    const result = onboardingHintsContext({ sports: [], goal: "Get back to competitive shape" });
    expect(result).toContain("Goal entered: Get back to competitive shape");
    expect(result).not.toContain("Sport(s) selected");
  });

  it("includes both when both are present", () => {
    const result = onboardingHintsContext({ sports: ["Badminton"], goal: "Win club tournament" });
    expect(result).toContain("Sport(s) selected: Badminton");
    expect(result).toContain("Goal entered: Win club tournament");
  });

  it("trims whitespace from the goal", () => {
    const result = onboardingHintsContext({ sports: [], goal: "  Sub-20 5k  " });
    expect(result).toContain("Goal entered: Sub-20 5k");
    expect(result).not.toContain("  Sub-20 5k  ");
  });
});
