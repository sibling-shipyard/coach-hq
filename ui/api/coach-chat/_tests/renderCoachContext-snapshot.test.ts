import { describe, it, expect } from "vitest";
import { buildDynamicText } from "../_lib/coachPrompt.js";
import { renderCoachContext } from "../_lib/coachContext.js";

// Step 1's safety bar (coach-redesign-part1-memory.md): renderCoachContext must produce
// character-for-character identical output to today's buildDynamicText across every mode/cache/
// extraContext combination, before any file actually moves to the new JSON shapes.
describe("renderCoachContext snapshot parity", () => {
  const stateMd = "# Coach Phelps: state.md\n## Athlete Profile\n- **Name:** Test Athlete\n";
  const questLog = "## Quests\n- Run 5k\n";

  const cases: {
    name: string;
    tier: "greeting" | "ordinary" | "closing";
    extraContext: string | undefined;
    useCache: boolean;
  }[] = [
    { name: "greeting, cached, no extra context", tier: "greeting", extraContext: undefined, useCache: true },
    { name: "greeting, uncached", tier: "greeting", extraContext: undefined, useCache: false },
    { name: "ordinary, cached, with extra context", tier: "ordinary", extraContext: "Onboarding hints:\n- Sport(s): running", useCache: true },
    { name: "ordinary, uncached", tier: "ordinary", extraContext: undefined, useCache: false },
    { name: "closing, cached, with extra context", tier: "closing", extraContext: "<first_session>...</first_session>", useCache: true },
    { name: "closing, uncached", tier: "closing", extraContext: undefined, useCache: false },
  ];

  for (const c of cases) {
    it(`matches buildDynamicText exactly - ${c.name}`, () => {
      const expected = buildDynamicText(stateMd, questLog, c.tier, c.extraContext, c.useCache);
      const actual = renderCoachContext(
        { stateMd, questLog, extraContext: c.extraContext, useCache: c.useCache },
        c.tier,
      );
      expect(actual).toBe(expected);
    });
  }
});
