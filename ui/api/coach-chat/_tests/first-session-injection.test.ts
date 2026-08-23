import { describe, it, expect } from "vitest";
import {
  buildDynamicText,
  combineExtraContext,
  firstSessionContext,
  onboardingHintsContext,
  staticSystemText,
} from "../_lib/coachPromptText.js";
import { generationConfigFor, type TurnMode } from "../_lib/coachReplySchema.js";

// PR 4 of the SOUL v5.8 trim: the First Session Protocol left SOUL.chat.md and is injected
// per-turn instead, gated on isAthleteProfileComplete(). The trap these tests exist to catch is
// putting it in the cached prefix - staticSystemText() is hashed and uploaded once to serve every
// athlete (soulCache.ts), so per-athlete content in there forks the Gemini cache silently.
const PROTOCOL = "### First Session Protocol\n\n**Step 1 — Warm intro:** say hi.";
const SOUL = "# Coach Phelps: SOUL.md\n\nBe a coach.";

function schemaFields(mode: TurnMode, firstSession: boolean): string[] {
  return Object.keys(generationConfigFor(mode, firstSession).responseSchema.properties);
}

describe("mode-specific response schemas", () => {
  it("allows no write actions on greetings or returning ordinary turns", () => {
    expect(schemaFields("greeting", true)).toEqual(["session_closed", "reply"]);
    expect(schemaFields("activity_sync", false)).toEqual(["session_closed", "reply"]);
    expect(schemaFields("ordinary", false)).toEqual(["session_closed", "reply"]);
  });

  it("allows only incremental intake actions during an ordinary First Session turn", () => {
    expect(schemaFields("ordinary", true)).toEqual([
      "memory_update",
      "sports_update",
      "injury_event",
      "profile_update",
      "season_start",
      "quest_create",
      "session_closed",
      "reply",
    ]);
  });

  it("adds coach_note at First Session close but excludes returning-athlete actions", () => {
    const fields = schemaFields("closing", true);
    expect(fields).toContain("coach_note");
    expect(fields).toContain("quest_create");
    expect(fields).not.toContain("quest_event");
    expect(fields).not.toContain("template_edit");
    expect(fields).not.toContain("week_plan");
  });

  it("allows operational actions at returning close but excludes intake creation", () => {
    const fields = schemaFields("closing", false);
    expect(fields).toContain("quest_event");
    expect(fields).toContain("template_edit");
    expect(fields).toContain("week_plan");
    expect(fields).not.toContain("season_start");
    expect(fields).not.toContain("quest_create");
  });
});

describe("firstSessionContext", () => {
  it("returns undefined once the profile is complete", () => {
    expect(firstSessionContext(false, PROTOCOL)).toBeUndefined();
  });

  it("carries the protocol when the profile is empty", () => {
    const ctx = firstSessionContext(true, PROTOCOL);
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
      firstSessionContext(true, PROTOCOL),
      onboardingHintsContext({ name: "Skanda", sports: ["badminton"] }),
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
      true,
      firstSessionContext(true, PROTOCOL),
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
      false,
      firstSessionContext(false, PROTOCOL),
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
      true,
      firstSessionContext(true, PROTOCOL),
      true,
    );
    expect(dynamic).toContain("Save each concrete fact on the same turn it is learned");
    expect(dynamic).toContain("season_start as");
    expect(dynamic).toContain("soon as the first season is agreed");
    expect(dynamic).toContain("Do not set template_edit, session_plan, week_plan");
  });

  // Found live testing Part A: on the turn that both closes AND is still mid-First-Session, the
  // mode==="closing" branch won outright and the dedicated FSP reminder (firstSessionTurn branch,
  // tested above) was never reached - quest_create got buried as one paragraph among ~15 mostly
  // irrelevant ones (template_edit/session_plan/week_plan/etc, none of which apply to a
  // first-session athlete). Real athlete stated habit quests on a closing turn, Gemini's reply
  // claimed they were saved, but quest_create never fired - confirmed from the raw response, not
  // just the missing commit. Fixed with a dedicated, focused closing+FSP instruction block.
  it("gives the closing turn its own focused FSP checklist when it's also a First Session close", () => {
    const dynamic = buildDynamicText(
      "state",
      "quests",
      "closing",
      true,
      firstSessionContext(true, PROTOCOL),
      true,
    );
    expect(dynamic).toContain("LAST CHANCE");
    expect(dynamic).toContain("Their main goal AND any daily habits or routines they want to track");
    expect(dynamic).toContain("quest_create's quests[]");
    expect(dynamic).not.toContain("Weekly Kick-off Ritual");
    expect(dynamic).not.toContain("the phase's plain-language name");
  });

  it("still uses the generic closing checklist for a returning athlete's close (not First Session)", () => {
    const dynamic = buildDynamicText("state", "quests", "closing", false, undefined, true);
    expect(dynamic).not.toContain("LAST CHANCE");
    expect(dynamic).toContain("session-close signal");
  });
});
