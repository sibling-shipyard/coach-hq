import { describe, it, expect } from "vitest";
import {
  validateQuestEvents,
  validateInjuryEvents,
  validateTemplateEdit,
  validateSessionPlan,
  validateSessionReconcile,
  validatePlanEdit,
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
