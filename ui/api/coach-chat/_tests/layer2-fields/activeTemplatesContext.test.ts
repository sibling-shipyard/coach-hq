import { describe, it, expect } from "vitest";
import { activeTemplatesContext } from "../../_lib/gemini/coachPromptText.js";

// #727 live-test finding: a real "remove that routine" request went unanswered in the model's
// structured reply (Coach's own text falsely claimed success, nothing was deleted) because this
// context block's header only mentioned template_edit, from before workout_remove/session_plan
// existed - the ids were present, but nothing told the model they applied to a removal.
describe("activeTemplatesContext", () => {
  it("names template_edit, workout_remove, and session_plan as valid uses for these ids", () => {
    const context = activeTemplatesContext(new Set(["upper_body_dumbbell_focus"]));
    expect(context).toContain("template_edit");
    expect(context).toContain("workout_remove");
    expect(context).toContain("session_plan");
    expect(context).toContain("upper_body_dumbbell_focus");
  });

  it("returns undefined when there are no templates yet", () => {
    expect(activeTemplatesContext(new Set())).toBeUndefined();
  });
});
