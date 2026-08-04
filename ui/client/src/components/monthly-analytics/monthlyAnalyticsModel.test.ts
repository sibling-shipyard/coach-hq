import { describe, it, expect } from "vitest";
import { buildSideQuests, type QuestHistory } from "./monthlyAnalyticsModel";

// Regression coverage for issue #93 (future days counted as done/miss) and the missing
// archived-season data: buildSideQuests now reads pre-computed gen/quest_history.json entries
// instead of recomputing from challenge_v2.json's raw date arrays against every calendar day.
// generate_quest_history.py caps entries at "today" for the live season and walks every
// archived season directory, so both bugs are structural non-issues here - there's nothing to
// clamp, because future days and old-season boundaries never enter this data at all. Ported
// from the legacy pre-Warm-Instrument dashboard's QuestSummaryCard.tsx (monthRate).
describe("buildSideQuests", () => {
  function history(quests: QuestHistory["quests"]): QuestHistory {
    return { generated_at: "2026-08-04", quests };
  }

  it("only counts entries within the queried month, never a full unclamped range", () => {
    const questHistory = history({
      cold_shower: {
        name: "Cold Shower",
        entries: [
          { date: "2026-07-30", status: "done" },
          { date: "2026-07-31", status: "missed" },
          { date: "2026-08-01", status: "done" },
          { date: "2026-08-02", status: "done" },
          { date: "2026-08-03", status: "missed" },
          { date: "2026-08-04", status: "done" },
        ],
      },
    });
    // month is 0-indexed - 7 = August
    const result = buildSideQuests(questHistory, 2026, 7);
    const row = result.quests[0];
    expect(row.done).toBe(3);
    expect(row.miss).toBe(1);
    expect(row.rate).toBe(75); // 3/(3+1)
  });

  it("aggregates entries that span an archived-season boundary the same as any other month", () => {
    // generate_quest_history.py already merges archived-season entries and current-season
    // entries into one continuous array per quest id before this ever reaches the UI - from
    // here it's indistinguishable from a quest that was never re-seasoned. A season transition
    // landing mid-month (e.g. old season ends 2026-06-07, new one starts 2026-06-18) just means
    // some June days have no entry at all, which the month-key filter handles by construction.
    const questHistory = history({
      cold_shower: {
        name: "Cold Shower",
        entries: [
          { date: "2026-06-05", status: "done" }, // archived season
          { date: "2026-06-06", status: "done" }, // archived season
          { date: "2026-06-07", status: "missed" }, // archived season, season closes
          // gap: 06-08 through 06-17, no season active, no entries
          { date: "2026-06-18", status: "done" }, // new season starts
          { date: "2026-06-19", status: "done" }, // new season
        ],
      },
    });
    const result = buildSideQuests(questHistory, 2026, 5); // June (0-indexed)
    const row = result.quests[0];
    expect(row.done).toBe(4);
    expect(row.miss).toBe(1);
  });

  it("computes rateDeltaVsPrevious against the prior calendar month, handling year rollover", () => {
    const questHistory = history({
      cold_shower: {
        name: "Cold Shower",
        entries: [
          { date: "2025-12-31", status: "done" },
          { date: "2026-01-01", status: "done" },
          { date: "2026-01-02", status: "missed" },
        ],
      },
    });
    const result = buildSideQuests(questHistory, 2026, 0); // January (0-indexed)
    const row = result.quests[0];
    // January: 1 done / 1 miss = 50%. December (prev): 1 done / 0 miss = 100%.
    expect(row.rate).toBe(50);
    expect(row.rateDeltaVsPrevious).toBe(-50);
  });

  it("a quest with no entries this month has a null rate, not a crash", () => {
    const questHistory = history({
      cold_shower: { name: "Cold Shower", entries: [] },
    });
    const result = buildSideQuests(questHistory, 2026, 7);
    expect(result.quests[0].rate).toBeNull();
    expect(result.quests[0].done).toBe(0);
  });
});
