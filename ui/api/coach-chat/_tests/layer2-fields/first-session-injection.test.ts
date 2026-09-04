import { describe, it, expect } from "vitest";
import {
  buildDynamicText,
  combineExtraContext,
  firstSessionContext,
  onboardingHintsContext,
  staticSystemText,
} from "../../_lib/gemini/coachPromptText.js";
import { generationConfigFor, type TurnMode } from "../../_lib/gemini/coachReplySchema.js";

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
  it("allows no write actions on greetings or activity syncs", () => {
    expect(schemaFields("greeting", true)).toEqual(["reply"]);
    expect(schemaFields("activity_sync", false)).toEqual(["reply"]);
  });

  it("allows only incremental intake actions during a First Session turn - no session artifacts", () => {
    const fields = schemaFields("ordinary", true);
    expect(fields).toEqual([
      "coach_note",
      "season_start",
      "quest_create",
      "memory_update",
      "coaching_style_update",
      "sports_update",
      "injury_flag",
      "injury_event",
      "profile_update",
      "reply",
    ]);
    expect(fields).not.toContain("quest_event");
    expect(fields).not.toContain("template_edit");
  });

  // C1: no more closing turn - a returning athlete's turn gets every action field (data-fact
  // and session-artifact alike) every time, not just data-fact ones (#616) or only at a close.
  it("unlocks every action field, data-fact and session-artifact, on a returning turn (C1, C2)", () => {
    const fields = schemaFields("ordinary", false);
    expect(fields).toEqual([
      "coach_note",
      "season_start",
      "quest_create",
      "memory_update",
      "coaching_style_update",
      "sports_update",
      "injury_flag",
      "injury_event",
      "quest_event",
      "profile_update",
      "template_edit",
      "session_plan",
      "week_plan",
      "session_reconcile",
      "plan_edit",
      "reply",
    ]);
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
    expect(dynamic).toContain("save any concrete fact they state on this same turn");
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
    expect(dynamic).toContain("season_start as soon as the first season and goal are agreed");
    expect(dynamic).toContain("main_quest (the goal) and new_habits");
    expect(dynamic).toContain("Do not set template_edit, session_plan, week_plan");
  });

  // C1: the closing turn is gone, so there is no separate closing+FSP checklist any more - the
  // single first-session block above (tested in "tells Gemini to emit action fields immediately
  // on an ordinary First Session turn") already covers save-immediately guidance without ever
  // burying quest_create among session-artifact fields that don't apply to a first-session
  // athlete in the first place (they're structurally excluded, not just discouraged - see the
  // "not a closing" schema test above).
  it("a first-session athlete's dynamic text never mentions session-artifact fields", () => {
    const dynamic = buildDynamicText(
      "state",
      "quests",
      "ordinary",
      true,
      firstSessionContext(true, PROTOCOL),
      true,
    );
    expect(dynamic).not.toContain("Weekly Kick-off Ritual");
    expect(dynamic).not.toContain("the phase's plain-language name");
  });

  // C1: session-artifact guidance (template_edit/session_plan/week_plan/session_reconcile/
  // plan_edit) used to live only in the closing-mode branch - now it's part of every returning
  // athlete's ordinary turn, since there's no closing turn left to gate it behind.
  it("a returning athlete's ordinary text covers session-artifact fields too (no more closing turn)", () => {
    const dynamic = buildDynamicText("state", "quests", "ordinary", false, undefined, true);
    expect(dynamic).toContain("Weekly Kick-off Ritual");
    expect(dynamic).toContain("template_edit");
    expect(dynamic).toContain("session_plan");
    expect(dynamic).toContain("session_reconcile");
    expect(dynamic).toContain("plan_edit");
  });
});
