import { describe, it, expect, vi, afterEach } from "vitest";
import { buildQuestSnapshot } from "./warmHomeSnapshots";
import type { SplitLedger, Quest } from "@/lib/challenge";
import type { WarmHomeModel } from "./warmHomeModel";

// Regression coverage for the "side quests always show 0/1" bug: buildQuestSnapshot only ever
// implemented default_not_done via a value/target fallback that happened to work for progress
// quests, but a default_done daily_streak quest (or a default_not_done one relying on the real
// eligible-days target, not Math.max(value,1)) always zeroed or lucky-matched out. This ports the
// legacy SideQuestTracker.tsx's computeQuestProgress formulas.
describe("buildQuestSnapshot", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function quest(overrides: Partial<Quest> = {}): Quest {
    return {
      id: "q1",
      name: "Test Quest",
      type: "daily_streak",
      category: "side",
      start_date: "2026-06-01",
      status: "active",
      tracking: "manual",
      ...overrides,
    };
  }

  function ledger(quests: Quest[]): SplitLedger {
    return {
      seasons: { current_season_id: null, seasons: [] },
      quests: { weekly_targets: {}, main_quest: { id: "main", name: "Main", type: "count_target", target: 1 }, quests: quests as any },
      progress: {
        rows: quests.flatMap(q => {
          const rows: any[] = [];
          if (q.completed_dates) rows.push(...q.completed_dates.map(d => ({ quest_id: q.id, date: d, status: "completed" })));
          if (q.missed_dates) rows.push(...q.missed_dates.map(d => ({ quest_id: q.id, date: d, status: "missed" })));
          if (q.excused_dates) rows.push(...q.excused_dates.map(d => ({ quest_id: q.id, date: d, status: "excused" })));
          if (q.current != null) rows.push({ quest_id: q.id, date: "2026-06-10", status: "completed", value: q.current });
          return rows;
        })
      },
      progressions: null,
    };
  }

  const questModel: WarmHomeModel["quest"] = {
    name: "Main",
    completed: 0,
    floor: 0,
    loaded: 0,
    skill: 0,
    percent: 0,
  };

  it("default_not_done: value is completed_dates.length, target is eligible days since start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00"));
    const q = quest({
      polarity: "default_not_done",
      completed_dates: ["2026-06-01", "2026-06-03", "2026-06-05"],
      excused_dates: [],
    });
    const result = buildQuestSnapshot(ledger([q]), questModel);
    // 2026-06-01 through 2026-06-10 inclusive = 10 eligible days
    expect(result.sideQuests[0].value).toBe(3);
    expect(result.sideQuests[0].target).toBe(10);
  });

  it("default_done: value is eligible minus missed minus excused, target is eligible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00"));
    const q = quest({
      polarity: "default_done",
      missed_dates: ["2026-06-02"],
      excused_dates: ["2026-06-04"],
    });
    const result = buildQuestSnapshot(ledger([q]), questModel);
    expect(result.sideQuests[0].value).toBe(8); // 10 eligible - 1 missed - 1 excused
    expect(result.sideQuests[0].target).toBe(10);
  });

  it("progress type: reads current/target directly, unaffected by polarity logic", () => {
    const q = quest({ type: "progress", current: 4, target: 10, polarity: undefined });
    const result = buildQuestSnapshot(ledger([q]), questModel);
    expect(result.sideQuests[0].value).toBe(4);
    expect(result.sideQuests[0].target).toBe(10);
  });

  it("eligible days is capped by the quest's own end_date, not just today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T12:00:00"));
    const q = quest({
      polarity: "default_not_done",
      start_date: "2026-06-01",
      end_date: "2026-06-05",
      completed_dates: ["2026-06-01"],
      excused_dates: [],
    });
    const result = buildQuestSnapshot(ledger([q]), questModel);
    expect(result.sideQuests[0].target).toBe(5); // 06-01 through 06-05, not through today
  });
});
