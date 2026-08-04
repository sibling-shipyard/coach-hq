import { describe, it, expect } from "vitest";
import { questMonthStats } from "./monthlyAnalyticsModel";
import type { Quest } from "@/lib/challenge";

// Regression coverage: questMonthStats used to check `polarity === "default_not_done"` and
// `polarity === "default_done"` as two separate explicit branches, falling through to the
// progress-quest fallback (done: quest.current ?? 0) for a daily_streak quest with an absent
// polarity - silently rendering 0/0/0 for a real quest instead of treating it as
// default_not_done, the unified challenge_v2 schema's actual default.
describe("questMonthStats", () => {
  function quest(overrides: Partial<Quest> = {}): Quest {
    return {
      id: "q1",
      name: "Test Quest",
      type: "daily_streak",
      category: "side",
      start_date: "2026-08-01",
      status: "active",
      tracking: "manual",
      ...overrides,
    };
  }

  it("treats an absent polarity as default_not_done, not the progress fallback", () => {
    const q = quest({
      polarity: undefined,
      completed_dates: ["2026-08-01", "2026-08-02"],
      excused_dates: ["2026-08-03"],
    });
    const stats = questMonthStats(q, 2026, 7); // month is 0-indexed - 7 = August
    expect(stats.done).toBe(2);
    expect(stats.excused).toBe(1);
  });

  it("still computes default_done correctly when polarity is explicit", () => {
    const q = quest({
      polarity: "default_done",
      missed_dates: ["2026-08-05"],
      excused_dates: ["2026-08-06"],
    });
    const stats = questMonthStats(q, 2026, 7); // month is 0-indexed - 7 = August
    // eligible dates for the month are capped by "today" elsewhere in the module for the
    // current month, but questMonthStats itself just uses the full calendar month here since
    // no "today" cutoff is passed in - 31 days in August, minus 1 missed minus 1 excused.
    expect(stats.miss).toBe(1);
    expect(stats.excused).toBe(1);
    expect(stats.done).toBe(29);
  });

  it("progress-type quests still use current, unaffected by the daily_streak branch", () => {
    const q = quest({ type: "progress", polarity: undefined, current: 4 });
    const stats = questMonthStats(q, 2026, 7); // month is 0-indexed - 7 = August
    expect(stats.done).toBe(4);
    expect(stats.miss).toBe(0);
  });
});
