import { describe, it, expect } from "vitest";
import { renderQuestContext } from "../_lib/coachContext.js";
import type { SeasonsJson, QuestsJson, ProgressJson, ProgressionsJson } from "../_lib/coachQuestFiles.js";

// Part 2 ledger split (coach-redesign-part2-ledger.md) replaces gen/quest_log.md with
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
    const text = renderQuestContext({ seasons, quests, progress, progressions });
    expect(text).toContain("## Milestones");
    expect(text).toContain("**Pull-up**");
    expect(text).toContain("3x5 negatives");
    expect(text).toContain("3x5 strict");
  });

  it("Milestones degrades to a placeholder when progressions is null or empty", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null });
    expect(text).toContain("## Milestones");
    expect(text).toContain("*(None set)*");
  });

  it("uses completed-count for a count_target main quest, not latestValue", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("1/20");
  });

  it("uses latestValue for a progress-type main quest, not completed-count - the numerator bug found in review", () => {
    const progressMainQuest: QuestsJson = {
      ...quests,
      main_quest: { id: "main", name: "Read the Book", type: "progress", target: 20 },
    };
    const text = renderQuestContext({ seasons, quests: progressMainQuest, progress: { version: 1, rows: [{ ...progress.rows[0], quest_id: "main", value: "12" }] }, progressions: null });
    const section = text.split("## Main Quest")[1].split("## Side Quests")[0];
    expect(section).toContain("12/20");
    expect(section).not.toContain("1/20"); // would be the old (wrong) completed-count behavior
  });

  it("still uses latestValue for a progress-type side quest", () => {
    const text = renderQuestContext({ seasons, quests, progress, progressions: null });
    const section = text.split("## Side Quests")[1].split("## Weekly Targets")[0];
    expect(section).toContain("9/20 chapters");
  });
});
