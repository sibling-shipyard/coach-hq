import { describe, it, expect } from "vitest";
import { renderQuestContext } from "../_lib/coachContext.js";
import type { SeasonsJson, QuestsJson, ProgressJson, ProgressionsJson } from "../_lib/coachQuestFiles.js";

// Part 2 ledger split (coach-redesign-part2-ledger.md) replaces the retired precomputed artifact with
// seasons.json/quests.json/progress.json/progressions.json read directly.
describe("renderQuestContext", () => {
  const seasons: SeasonsJson = {
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "t0" },
    current_season_id: "s1",
    seasons: [{ id: "s1", name: "Load Bearing Season", start_date: "2026-08-04", end_date: "2026-12-31", status: "active" }],
  };

  const quests: QuestsJson = {
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "t0" },
    weekly_targets: {},
    main_quest: { id: "main", name: "20 Strength Sessions", type: "count_target", target: 20 },
    quests: [
      { id: "cold_shower", name: "Cold Shower", type: "daily_streak", start_date: "2026-08-04", end_date: null, status: "active", source: "model" },
      {
        id: "reading_book",
        name: "Inner Game of Tennis",
        type: "progress",
        start_date: "2026-08-04",
        end_date: null,
        status: "active",
        target: 20,
        unit: "chapters",
        source: "athlete",
      },
    ],
  };

  const progress: ProgressJson = {
    version: 1,
    rows: [
      { id: "pr_main_1", quest_id: "main", season_id: "s1", date: "2026-08-05", status: "completed", value: null, source: "model", ts: "2026-08-05T00:00:00Z", trace_id: "t0" },
      {
        id: "pr_reading_1",
        quest_id: "reading_book",
        season_id: "s1",
        date: "2026-08-10",
        status: "completed",
        value: "9",
        source: "model",
        ts: "2026-08-10T00:00:00Z",
        trace_id: "t0",
      },
    ],
  };

  const progressions: ProgressionsJson = {
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "t0" },
    progressions: [{ id: "pull_up", name: "Pull-up", current: "3x5 negatives", target: "3x5 strict", unit: null, history: [] }],
  };

  it("renders a Milestones section from progressions.json - found missing in review, was fetched but never rendered", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions, today: "2026-08-18" });
    expect(text).toContain("## Milestones");
    expect(text).toContain("**Pull-up**");
    expect(text).toContain("3x5 negatives");
    expect(text).toContain("3x5 strict");
  });

  it("Milestones degrades to a placeholder when progressions is null or empty", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null, today: "2026-08-18" });
    expect(text).toContain("## Milestones");
    expect(text).toContain("*(None set)*");
  });

  it("uses completed-count for a count_target main quest, not latestValue", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null, today: "2026-08-18" });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("1/20");
  });

  it("uses latestValue for a progress-type main quest, not completed-count - the numerator bug found in review", () => {
    const progressMainQuest: QuestsJson = {
      ...quests,
      main_quest: { id: "main", name: "Read the Book", type: "progress", target: 20 },
    };
    const text = renderQuestContext({ seasons, quests: progressMainQuest, progress: { version: 1, rows: [{ ...progress.rows[0], quest_id: "main", value: "12" }] }, progressions: null, today: "2026-08-18" });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("12/20");
    expect(section).not.toContain("1/20"); // would be the old (wrong) completed-count behavior
  });

  it("still uses latestValue for a progress-type side quest", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null, today: "2026-08-18" });
    const section = text.split("## Side Quests")[1].split("## Weekly Targets")[0];
    expect(section).toContain("9/20 chapters");
  });

  // Found in review: questProgressCounts filtered by quest_id only - progress.json accumulates
  // rows across every season forever, so a quest reused in a later season had its counts computed
  // across ALL history, not just the current season.
  it("scopes progress counts to the current season, ignoring rows from a prior season", () => {
    const multiSeasonProgress: ProgressJson = {
      version: 1,
      rows: [
        ...progress.rows,
        // Same quest_id, a completely different (older) season - must not count toward "today's" numbers.
        { id: "pr_old_1", quest_id: "main", season_id: "s0_old_season", date: "2026-01-05", status: "completed", value: null, source: "model", ts: "2026-01-05T00:00:00Z", trace_id: "t0" },
        { id: "pr_old_2", quest_id: "main", season_id: "s0_old_season", date: "2026-01-06", status: "completed", value: null, source: "model", ts: "2026-01-06T00:00:00Z", trace_id: "t0" },
      ],
    };
    const text = renderQuestContext({ seasons, quests, progress: multiSeasonProgress, progressions: null, today: "2026-08-18" });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("1/20"); // only the current-season row counts, not the 2 old-season ones too
  });

  // Found in review, second pass: when there's no current season at all, the filter used to
  // fall back to showing ALL history instead of nothing - backwards, since that reintroduces the
  // exact season-leakage this filter exists to prevent.
  it("shows zero progress (not all-time history) when there is no current season", () => {
    const noSeasonSeasons: SeasonsJson = { ...seasons, current_season_id: "" };
    const text = renderQuestContext({ seasons: noSeasonSeasons, quests, progress, progressions: null, today: "2026-08-18" });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("0/20"); // not 1/20 - no current season means nothing counts as current-season progress
  });

  // Found in review: the write path (coach-chat.ts's quest_event handler) falls back to
  // `seasons?.current_season_id ?? ""` when there's no active season, but this read path used to
  // fall back to `?? null` - a row written as season_id:"" could never match a read-side filter
  // looking for null, orphaning it forever. Simulates the real round trip: current_season_id is
  // genuinely null (missing), and a row was already written with the write side's "" sentinel.
  it("finds a row written with the write path's \"\" season sentinel, when current_season_id is genuinely null", () => {
    const seasonsWithNullId: SeasonsJson = { ...seasons, current_season_id: null };
    const orphanRiskProgress: ProgressJson = {
      version: 1,
      rows: [{ id: "pr_main_noseason", quest_id: "main", season_id: "", date: "2026-08-18", status: "completed", value: null, source: "model", ts: "2026-08-18T00:00:00Z", trace_id: "t0" }],
    };
    const text = renderQuestContext({ seasons: seasonsWithNullId, quests, progress: orphanRiskProgress, progressions: null, today: "2026-08-18" });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("1/20"); // the "" row must be found, not orphaned
  });

  // Found in review: weekly_frequency fell into the generic all-time completed/excused/missed
  // tally, when its actual semantics need a week-scoped count instead.
  describe("weekly_frequency quests", () => {
    const weeklyQuests: QuestsJson = {
      ...quests,
      quests: [{ id: "badminton", name: "Badminton", type: "weekly_frequency", start_date: "2026-08-04", end_date: null, status: "active", target: 2, source: "model" }],
    };
    // 2026-08-18 is a Tuesday - that week is Mon 2026-08-17 to Sun 2026-08-23.
    const weeklyProgress: ProgressJson = {
      version: 1,
      rows: [
        { id: "pr_bad_1", quest_id: "badminton", season_id: "s1", date: "2026-08-17", status: "completed", value: null, source: "model", ts: "2026-08-17T00:00:00Z", trace_id: "t0" },
        // Last week - must not count toward "this week"'s total.
        { id: "pr_bad_2", quest_id: "badminton", season_id: "s1", date: "2026-08-10", status: "completed", value: null, source: "model", ts: "2026-08-10T00:00:00Z", trace_id: "t0" },
      ],
    };

    it("counts only this-week completions, not all-time", () => {
      const text = renderQuestContext({ seasons, quests: weeklyQuests, progress: weeklyProgress, progressions: null, today: "2026-08-18" });
      const section = text.split("## Side Quests")[1].split("## Weekly Targets")[0];
      expect(section).toContain("1/2 this week"); // only 08-17, not the 08-10 row from last week
    });
  });
});
