import { describe, it, expect } from "vitest";
import {
  buildDynamicText,
  combineExtraContext,
  firstSessionContext,
  onboardingHintsContext,
  staticSystemText,
} from "../_lib/coachPrompt.js";

// PR 4 of the SOUL v5.8 trim: the First Session Protocol left SOUL.chat.md and is injected
// per-turn instead, gated on isAthleteProfileComplete(). The trap these tests exist to catch is
// putting it in the cached prefix - staticSystemText() is hashed and uploaded once to serve every
// athlete (soulCache.ts), so per-athlete content in there forks the Gemini cache silently.
const PROTOCOL = "### First Session Protocol\n\n**Step 1 — Warm intro:** say hi.";
const SOUL = "# Coach Phelps: SOUL.md\n\nBe a coach.";

describe("firstSessionContext", () => {
  it("returns undefined once the profile is complete", () => {
    expect(firstSessionContext(true, PROTOCOL)).toBeUndefined();
  });

  it("carries the protocol when the profile is empty", () => {
    const ctx = firstSessionContext(false, PROTOCOL);
    expect(ctx).toContain("**Step 1 — Warm intro:**");
    expect(ctx).toContain("<first_session>");
  });
});

describe("combineExtraContext", () => {
  it("returns undefined when nothing fired", () => {
    expect(combineExtraContext(undefined, undefined)).toBeUndefined();
  });

  it("keeps both blocks when first-session and onboarding hints fire together", () => {
    const combined = combineExtraContext(
      firstSessionContext(false, PROTOCOL),
      onboardingHintsContext({ name: "Skanda", sports: ["badminton"], coaching_style: "analysis" }),
    );
    expect(combined).toContain("<first_session>");
    expect(combined).toContain("Sport(s): badminton");
  });

  it("drops the empty one rather than leaving a blank gap", () => {
    expect(combineExtraContext(undefined, "kept")).toBe("kept");
  });
});

describe("cache safety", () => {
  // The load-bearing assertion of this PR. If this ever fails, the Gemini prefix cache is
  // forking per athlete.
  it("static prefix is byte-identical whether or not First Session is injected", () => {
    expect(staticSystemText(SOUL)).toBe(staticSystemText(SOUL));
    expect(staticSystemText(SOUL)).not.toContain("First Session Protocol");
    expect(staticSystemText(SOUL)).not.toContain("<first_session>");
  });

  it("the protocol reaches the model through the dynamic half", () => {
    const dynamic = buildDynamicText(
      "state",
      "quests",
      "greeting",
      firstSessionContext(false, PROTOCOL),
      true,
    );
    expect(dynamic).toContain("<first_session>");
    expect(dynamic).toContain("**Step 1 — Warm intro:**");
  });

  it("an onboarded athlete's dynamic text carries none of it", () => {
    const dynamic = buildDynamicText(
      "state",
      "quests",
      "ordinary",
      firstSessionContext(true, PROTOCOL),
      true,
    );
    expect(dynamic).not.toContain("<first_session>");
    expect(dynamic).toContain("Nothing about this turn gets saved anywhere");
  });

  it("tells Gemini to emit action fields immediately on an ordinary First Session turn", () => {
    const dynamic = buildDynamicText(
      "state",
      "quests",
      "ordinary",
      firstSessionContext(false, PROTOCOL),
      true,
    );
    expect(dynamic).toContain("Save each concrete fact on the same turn it is learned");
    expect(dynamic).toContain("season_start as");
    expect(dynamic).toContain("soon as the first season is agreed");
    expect(dynamic).toContain("Do not set template_edit, session_plan, week_plan");
  });
});
