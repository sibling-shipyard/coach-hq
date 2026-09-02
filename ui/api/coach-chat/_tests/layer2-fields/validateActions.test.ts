import { describe, it, expect } from "vitest";
import {
  validateQuestEvents,
  validateInjuryEvents,
} from "../../_lib/turnWrites/validateActions.js";

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
