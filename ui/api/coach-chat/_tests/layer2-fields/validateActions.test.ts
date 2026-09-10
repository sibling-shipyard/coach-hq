import { describe, it, expect } from "vitest";
import {
  validateQuestEvents,
  validateInjuryEvents,
  validateTemplateEdit,
  validateSessionPlan,
  validateSessionReconcile,
  validatePlanEdit,
  synthesizeQuestEventFromUnrecordedFacts,
  type QuestForSynthesis,
  type ExistingSessionForDiff,
} from "../../_lib/decide/turnWrites/validateActions.js";

// D1 layer 3 (#736): pre-validate before any write is built, so a bad reference never reaches
// the applier's own throw-inside-commit guard in normal operation.
describe("validateQuestEvents", () => {
  it("keeps events whose quest_id is in the valid set", () => {
    const events = [{ quest_id: "q1", status: "completed" as const }];
    const { valid, dropped } = validateQuestEvents(events, new Set(["q1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose quest_id is not in the valid set, keeping the rest", () => {
    const good = { quest_id: "q1", status: "completed" as const };
    const bad = { quest_id: "q99", status: "completed" as const };
    const { valid, dropped } = validateQuestEvents([good, bad], new Set(["q1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([{ field: "quest_event", reason: expect.stringContaining('"q99"') }]);
  });
});

describe("validateInjuryEvents", () => {
  it("keeps events whose flag_id is in the valid set", () => {
    const events = [{ status: "resolved" as const, flag_id: "inj_1" }];
    const { valid, dropped } = validateInjuryEvents(events, new Set(["inj_1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose flag_id is not in the valid set, keeping the rest", () => {
    const good = { status: "resolved" as const, flag_id: "inj_1" };
    const bad = { status: "active" as const, flag_id: "inj_bogus" };
    const { valid, dropped } = validateInjuryEvents([good, bad], new Set(["inj_1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([
      { field: "injury_event", reason: expect.stringContaining('"inj_bogus"') },
    ]);
  });
});

describe("validateTemplateEdit", () => {
  it("passes through a template_edit whose template_id is in the valid set", () => {
    const edit = { template_id: "t1", note: "swap in a bench press" };
    const { valid, dropped } = validateTemplateEdit(edit, new Set(["t1"]));
    expect(valid).toEqual(edit);
    expect(dropped).toEqual([]);
  });

  it("drops a template_edit whose template_id is not in the valid set", () => {
    const edit = { template_id: "t_bogus", note: "swap in a bench press" };
    const { valid, dropped } = validateTemplateEdit(edit, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "template_edit", reason: expect.stringContaining('"t_bogus"') },
    ]);
    expect(dropped[0].kind).toBeUndefined();
  });

  it("passes through undefined untouched", () => {
    const { valid, dropped } = validateTemplateEdit(undefined, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([]);
  });
});

describe("validateSessionPlan", () => {
  it("passes through a session_plan whose template_id is in the valid set", () => {
    const plan = { template_id: "t1" };
    const { valid, dropped } = validateSessionPlan(plan, new Set(["t1"]));
    expect(valid).toEqual(plan);
    expect(dropped).toEqual([]);
  });

  it("drops a session_plan whose template_id is not in the valid set", () => {
    const plan = { template_id: "t_bogus" };
    const { valid, dropped } = validateSessionPlan(plan, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "session_plan", reason: expect.stringContaining('"t_bogus"') },
    ]);
  });
});

describe("validateSessionReconcile", () => {
  it("keeps events whose session_id is in the valid set", () => {
    const events = [{ session_id: "s1", status: "done" as const }];
    const { valid, dropped } = validateSessionReconcile(events, new Set(["s1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose session_id is not in the valid set, keeping the rest", () => {
    const good = { session_id: "s1", status: "done" as const };
    const bad = { session_id: "s_bogus", status: "skipped" as const };
    const { valid, dropped } = validateSessionReconcile([good, bad], new Set(["s1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([
      { field: "session_reconcile", reason: expect.stringContaining('"s_bogus"') },
    ]);
  });
});

describe("validatePlanEdit", () => {
  it("keeps events whose session_id is in the valid set", () => {
    const events = [{ session_id: "s1", discipline: "run", kind: "easy", title: "Easy run" }];
    const { valid, dropped } = validatePlanEdit(events, new Set(["s1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose session_id is not in the valid set, keeping the rest", () => {
    const good = { session_id: "s1", discipline: "run", kind: "easy", title: "Easy run" };
    const bad = {
      session_id: "s_bogus",
      discipline: "strength",
      kind: "full_body",
      title: "Full body",
    };
    const { valid, dropped } = validatePlanEdit([good, bad], new Set(["s1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([{ field: "plan_edit", reason: expect.stringContaining('"s_bogus"') }]);
  });
});

// Finding E (2026-09-10 pro baseline): the model confabulates a false refusal instead of
// complying with a correctly-detected, correctly-reprompted quest completion - a compliance
// failure a third model call has already been shown live not to fix. This synthesizes the
// completion deterministically instead, but only when unambiguous.
describe("synthesizeQuestEventFromUnrecordedFacts", () => {
  const proteinQuest: QuestForSynthesis = {
    id: "protein",
    name: "Protein Target",
    status: "active",
  };
  const coldShowerQuest: QuestForSynthesis = {
    id: "cold_shower",
    name: "Cold Shower",
    status: "active",
  };
  const retiredQuest: QuestForSynthesis = { id: "old_quest", name: "Old Quest", status: "retired" };

  it("returns null when there are no unrecorded facts", () => {
    expect(synthesizeQuestEventFromUnrecordedFacts(null, [proteinQuest], new Set())).toBeNull();
    expect(synthesizeQuestEventFromUnrecordedFacts([], [proteinQuest], new Set())).toBeNull();
  });

  it("returns null when no unrecorded fact reads as a completion claim", () => {
    const facts = ["Athlete mentioned moving to a new apartment next month."];
    expect(synthesizeQuestEventFromUnrecordedFacts(facts, [proteinQuest], new Set())).toBeNull();
  });

  it("synthesizes when exactly one active quest exists and a completion fact is present", () => {
    const facts = ["Completed protein target for today, but quest_event wasn't set."];
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [proteinQuest], new Set());
    expect(result).toEqual({ quest_id: "protein", status: "completed" });
  });

  it("synthesizes when multiple quests exist but exactly one name-matches the fact", () => {
    const facts = ["Hit the protein target again today, but no quest_event was set."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest, coldShowerQuest],
      new Set(),
    );
    expect(result).toEqual({ quest_id: "protein", status: "completed" });
  });

  it("returns null (genuine ambiguity) when multiple quests exist and none name-match", () => {
    const facts = ["Finished the workout today, but nothing was logged."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest, coldShowerQuest],
      new Set(),
    );
    expect(result).toBeNull();
  });

  it("excludes quests already handled this turn", () => {
    const facts = ["Completed protein target for today."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest],
      new Set(["protein"]),
    );
    expect(result).toBeNull();
  });

  it("excludes non-active quests entirely", () => {
    const facts = ["Completed the old quest again today."];
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [retiredQuest], new Set());
    expect(result).toBeNull();
  });
});

// Bug 3 (2026-09-10 pro baseline, real diff-confirmed): a real conversation showed the coach ask
// an unanswered clarifying question, then silently overwrite a real scheduled football match with
// a recovery walk anyway - a real session_id, so the plain existence check never caught it. These
// tests exercise the content-diff guard added to validatePlanEdit/validateSessionReconcile.
describe("validatePlanEdit content-diff guard (Bug 3)", () => {
  const footballSession: ExistingSessionForDiff = {
    id: "s_saturday",
    discipline: "football",
    kind: "match",
  };
  const existingSessions = new Map([["s_saturday", footballSession]]);

  it("drops a category-changing edit when the athlete's message has no confirmation cue", () => {
    const event = {
      session_id: "s_saturday",
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validatePlanEdit(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toEqual([]);
    expect(dropped).toEqual([
      { field: "plan_edit", reason: expect.stringContaining("unconfirmed assumption") },
    ]);
  });

  it("keeps a category-changing edit when the athlete's message contains a confirmation cue", () => {
    const event = {
      session_id: "s_saturday",
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validatePlanEdit(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "Yes, drop the football and do the walk instead.",
    );
    expect(valid).toEqual([event]);
    expect(dropped).toEqual([]);
  });

  it("keeps an edit that doesn't change the session's category, confirmation or not", () => {
    const event = {
      session_id: "s_saturday",
      discipline: "football",
      kind: "match",
      title: "Football - away game",
    };
    const { valid, dropped } = validatePlanEdit(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toEqual([event]);
    expect(dropped).toEqual([]);
  });

  it("keeps working with no existing-session data supplied (default empty map, backward compatible)", () => {
    const event = { session_id: "s1", discipline: "run", kind: "easy", title: "Easy run" };
    const { valid, dropped } = validatePlanEdit([event], new Set(["s1"]));
    expect(valid).toEqual([event]);
    expect(dropped).toEqual([]);
  });
});

describe("validateSessionReconcile content-diff guard (Bug 3)", () => {
  const footballSession: ExistingSessionForDiff = {
    id: "s_saturday",
    discipline: "football",
    kind: "match",
  };
  const existingSessions = new Map([["s_saturday", footballSession]]);

  it("drops a category-changing actual when the athlete's message has no confirmation cue", () => {
    const event = {
      session_id: "s_saturday",
      status: "done" as const,
      actual: { discipline: "walk", kind: "recovery", title: "Easy Recovery Walk" },
    };
    const { valid, dropped } = validateSessionReconcile(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toEqual([]);
    expect(dropped).toEqual([
      { field: "session_reconcile", reason: expect.stringContaining("unconfirmed assumption") },
    ]);
  });

  it("keeps a category-changing actual when the athlete's message confirms it", () => {
    const event = {
      session_id: "s_saturday",
      status: "done" as const,
      actual: { discipline: "walk", kind: "recovery", title: "Easy Recovery Walk" },
    };
    const { valid, dropped } = validateSessionReconcile(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "Yeah, swapped it for a walk instead.",
    );
    expect(valid).toEqual([event]);
    expect(dropped).toEqual([]);
  });

  it("does not gate a status-only reconcile with no actual field at all", () => {
    const event = { session_id: "s_saturday", status: "done" as const };
    const { valid, dropped } = validateSessionReconcile(
      [event],
      new Set(["s_saturday"]),
      existingSessions,
      "Done, just as planned.",
    );
    expect(valid).toEqual([event]);
    expect(dropped).toEqual([]);
  });
});
