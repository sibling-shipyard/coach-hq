import { describe, expect, it, vi, afterEach } from "vitest";
import type { Activity } from "./activities";
import { resolveMatchSessions } from "./matchParser";
import { buildBadmintonLensModel } from "@/components/sport-analytics/badmintonLensModel";
import { buildWarmHomeModel } from "@/components/home-warm/warmHomeModel";
import { GOLDEN_CURRENT_WEEK } from "./goldenDataset";

function activity(
  id: number,
  file: string,
  time: string,
  description: string | null = null,
): Activity {
  return {
    id,
    history_file: file,
    name: "Badminton: Ranked #1",
    category: "badminton_ranked",
    sport_type: "Badminton",
    start_date_local: `2026-09-16T${time}:00`,
    elapsed_time: 3600,
    moving_time: 3600,
    calories: 0,
    distance: 0,
    total_elevation_gain: 0,
    average_heartrate: null,
    max_heartrate: null,
    has_heartrate: false,
    hr_zones: null,
    description,
    max_speed: 0,
    device_name: null,
  };
}

function session(historyFile: string | undefined, result: "W" | "L", category = "ranked") {
  return {
    date: "2026-09-16",
    ...(historyFile ? { historyFile } : {}),
    games: [
      {
        result,
        scoreFor: result === "W" ? 21 : 15,
        scoreAgainst: result === "W" ? 18 : 21,
        partner: null,
        opponents: ["Alex"],
        format: "singles",
        category,
      },
    ],
  };
}

describe("structured badminton match history", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps two same-day sessions distinct in lens and Home records", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00"));
    const activities = [activity(1, "first.json", "09:00"), activity(2, "second.json", "18:00")];
    const history = {
      version: 1,
      sessions: [session("first.json", "W"), session("second.json", "L", "friendly")],
    };

    const resolved = resolveMatchSessions(activities, history);
    expect(resolved.map((match) => match.activity?.id)).toEqual([1, 2]);
    const lens = buildBadmintonLensModel(activities, "all", history);
    expect(lens.header).toMatchObject({
      sessionsWithMatchData: 2,
      rankedGameCount: 1,
      allGameCount: 2,
    });
    expect(lens.winRate.eightWeek).toMatchObject({ wins: 1, losses: 1, games: 2 });
    expect(lens.winRate.eightWeek.trend.map((point) => point.activityId)).toEqual([1, 2]);

    const home = buildWarmHomeModel(
      activities,
      { quests: { main_quest: null } },
      { timestamp: null, status: "none" },
      GOLDEN_CURRENT_WEEK,
      history,
    );
    expect(home.commitments.find((item) => item.id === "badminton")).toMatchObject({
      allRecord: "1W-1L",
      rankedRecord: "1W-0L",
    });
  });

  it("joins a date-only record only when its activity is unambiguous", () => {
    const lone = activity(1, "first.json", "09:00");
    const legacy = { sessions: [session(undefined, "W")] };
    expect(resolveMatchSessions([lone], legacy)[0].activity?.id).toBe(1);
    expect(
      resolveMatchSessions([lone, activity(2, "second.json", "18:00")], legacy)[0].activity,
    ).toBeNull();
    expect(
      resolveMatchSessions([lone], {
        sessions: [session(undefined, "W"), session(undefined, "L")],
      }).every((match) => match.activity === null),
    ).toBe(true);
  });

  it("never uses a date or description to rescue a keyed record", () => {
    const lone = activity(1, "first.json", "09:00", "2W-0L (100%)\nGames:\nW 21-18 vs Alex");
    const matches = resolveMatchSessions([lone], { sessions: [session("missing.json", "W")] });
    expect(matches).toHaveLength(1);
    expect(matches[0].activity).toBeNull();
    expect(
      resolveMatchSessions([lone], {
        sessions: [{ ...session(undefined, "W"), historyFile: "" }],
      })[0].activity,
    ).toBeNull();
    expect(
      buildBadmintonLensModel([lone], "all", { sessions: [] }).header.sessionsWithMatchData,
    ).toBe(0);
  });
});
