import { describe, it, expect } from "vitest";
import { buildCountTargetQuest } from "./warmHomeModel";
import type { Activity } from "@/lib/activities";
import type { ChallengeV2, MainQuest } from "@/lib/challenge";

// Regression coverage for the "Main Quest always shows 0/0" bug: buildQuest() only ever
// implemented the weekly-floor main-quest model (sessions/weekly_floor), so a count_target main
// quest (season-long, count activities matching a name pattern) silently zeroed out. This ports
// the legacy SideQuestTracker.tsx's MainQuestCard formula - not Strava-specific, a generic
// case-insensitive name match against whatever synced the activity.
describe("buildCountTargetQuest", () => {
  function activity(overrides: Partial<Activity> = {}): Activity {
    return {
      id: 1,
      name: "WeightTraining #1",
      sport_type: "WeightTraining",
      start_date_local: "2026-06-01T08:00:00",
      elapsed_time: 1800,
      moving_time: 1800,
      calories: 200,
      distance: 0,
      total_elevation_gain: 0,
      average_heartrate: null,
      max_heartrate: null,
      has_heartrate: false,
      hr_zones: null,
      description: null,
      max_speed: 0,
      device_name: null,
      ...overrides,
    };
  }

  function challenge(mainQuest: MainQuest, seasonStart = "2026-06-01"): ChallengeV2 {
    return {
      version: 4,
      main_quest: mainQuest,
      quests: [],
      season: { name: "Test Season", start_date: seasonStart, end_date: "2026-12-31" },
    };
  }

  const mainQuest: MainQuest = {
    id: "main",
    name: "Load Bearing",
    type: "count_target",
    target: 38,
    count_pattern: "^WeightTraining\\s*#",
  };

  it("counts activities matching count_pattern case-insensitively", () => {
    const activities = [
      activity({ name: "weighttraining #2" }),
      activity({ name: "WeightTraining #3" }),
      activity({ name: "Badminton: Casual #1" }),
    ];
    const result = buildCountTargetQuest(mainQuest, activities, challenge(mainQuest));
    expect(result.completed).toBe(2);
    expect(result.floor).toBe(38);
  });

  it("excludes activities before the season start date", () => {
    const activities = [
      activity({ name: "WeightTraining #1", start_date_local: "2026-05-31T08:00:00" }),
      activity({ name: "WeightTraining #2", start_date_local: "2026-06-01T08:00:00" }),
    ];
    const result = buildCountTargetQuest(mainQuest, activities, challenge(mainQuest, "2026-06-01"));
    expect(result.completed).toBe(1);
  });

  it("returns 0/target when no count_pattern is set", () => {
    const bare: MainQuest = { id: "main", name: "No pattern", type: "count_target", target: 10 };
    const result = buildCountTargetQuest(bare, [activity()], challenge(bare));
    expect(result.completed).toBe(0);
    expect(result.floor).toBe(10);
  });
});
