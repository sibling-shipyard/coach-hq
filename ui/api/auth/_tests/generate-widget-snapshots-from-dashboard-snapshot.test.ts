import { describe, it, expect, vi, afterEach } from "vitest";
import {
  generateWidgetSnapshotsFromDashboardSnapshot,
  needsLiveRecomputation,
  projectLatestCoachMessage,
} from "../_lib/generate-widget-snapshots-from-dashboard-snapshot.js";

const VALID_LATEST_MESSAGE = {
  schema_version: 1,
  message: {
    id: "cm-11111111-2222-4333-8444-555555555555",
    created_at: "2026-08-23T09:00:00.000Z",
    activity_ids: ["healthkit:AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
    body: "You held that together late.  That's the part I noticed.",
    conversation_seed_id: "local-proactive-cm-11111111-2222-4333-8444-555555555555",
  },
};

describe("projectLatestCoachMessage", () => {
  it("projects exactly the public fields and preserves body text byte-for-byte", () => {
    const projected = projectLatestCoachMessage(JSON.stringify(VALID_LATEST_MESSAGE));
    expect(projected).toEqual({
      id: VALID_LATEST_MESSAGE.message.id,
      created_at: VALID_LATEST_MESSAGE.message.created_at,
      body: VALID_LATEST_MESSAGE.message.body,
      conversation_seed_id: VALID_LATEST_MESSAGE.message.conversation_seed_id,
    });
    expect(Object.keys(projected ?? {})).toEqual([
      "id",
      "created_at",
      "body",
      "conversation_seed_id",
    ]);
    expect(projected?.body).toBe(VALID_LATEST_MESSAGE.message.body);
  });

  // #918: a batch synced with a thread already open points conversation_seed_id at that real
  // chat-thread id (`t-<epoch ms>`) instead of minting `local-proactive-<id>` - this projector
  // must accept both shapes, not just the local-proactive one.
  it("accepts a real chat-thread seed id", () => {
    const message = { ...VALID_LATEST_MESSAGE.message, conversation_seed_id: "t-1756540800000" };
    const projected = projectLatestCoachMessage(JSON.stringify({ schema_version: 1, message }));
    expect(projected?.conversation_seed_id).toBe("t-1756540800000");
  });

  it("omits a null message", () => {
    expect(projectLatestCoachMessage({ schema_version: 1, message: null })).toBeUndefined();
  });

  it("omits a missing message file", () => {
    expect(projectLatestCoachMessage(undefined)).toBeUndefined();
  });

  it.each([
    "not json",
    { schema_version: 1, message: { ...VALID_LATEST_MESSAGE.message, body: "" } },
    {
      schema_version: 1,
      message: { ...VALID_LATEST_MESSAGE.message, conversation_seed_id: "another-thread" },
    },
    { ...VALID_LATEST_MESSAGE, unexpected: true },
  ])("fails closed for malformed latest-message data", (value) => {
    expect(projectLatestCoachMessage(value)).toBeUndefined();
  });
});

// Regression coverage for the stale current_week bug: a "placeholder" week (the real value the
// ledger ships once the coach has planned a week) used to pass straight through unmodified even
// once its start_date/end_date no longer covered today, leaking a prior week's data into Home's
// Weekly Log and Main Quest widgets. needsLiveRecomputation now also triggers a live recompute
// for a stale placeholder, while leaving a still-accurate one untouched.
describe("needsLiveRecomputation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is true when there is no week at all", () => {
    expect(needsLiveRecomputation(undefined)).toBe(true);
  });

  it("is true for an unavailable week", () => {
    expect(needsLiveRecomputation({ data_status: "unavailable" })).toBe(true);
  });

  it("is false for a placeholder week whose stored range brackets today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-08-03", end_date: "2026-08-09" },
      } as never),
    ).toBe(false);
  });

  it("is true for a placeholder week whose stored range is a prior week", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-07-27", end_date: "2026-08-02" },
      } as never),
    ).toBe(true);
  });

  it("is true for a placeholder week whose stored range is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    expect(
      needsLiveRecomputation({
        data_status: "placeholder",
        week: { start_date: "2026-08-10", end_date: "2026-08-16" },
      } as never),
    ).toBe(true);
  });
});

// #1027: current_week.json on disk never carries coach_comments (ADR 0042 dropped it - nothing
// writes it anymore), so an unchecked `as CurrentWeekContract` cast of the raw stored contract
// crashed warmHomeModel.ts's activeComment() on `contract.coach_comments.filter(...)`. The fix
// normalizes the stored contract the same way currentWeekAdapter.ts/liveWeekContract.ts already
// do for their callers, defaulting the missing field to [] before it reaches the model.
describe("generateWidgetSnapshotsFromDashboardSnapshot missing coach_comments", () => {
  const minimalLedger = {
    seasons: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      current_season_id: "s1",
      seasons: [
        {
          id: "s1",
          name: "Season",
          start_date: "2026-06-01",
          end_date: "2026-08-31",
          status: "active" as const,
        },
      ],
    },
    quests: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      weekly_targets: {},
      main_quest: {
        id: "main",
        name: "Main",
        type: "count_target" as const,
        target: 10,
        season_id: "s1",
      },
      quests: [],
    },
    progress: { version: 1 as const, rows: [] },
    progressions: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      progressions: [],
    },
  };

  it("does not throw when a live current_week has no coach_comments key", () => {
    // Real on-disk shape: no coach_comments key at all, not even an empty array.
    const currentWeek = {
      schema_version: 1,
      data_status: "live",
      week: {
        id: "2026-08-03_2026-08-09",
        start_date: "2026-08-03",
        end_date: "2026-08-09",
        status: "active",
        focus: "Build week",
        guardrails: [],
      },
      coach_read: {
        headline: "Build week",
        body: "Steady load this week.",
        valid_from: "2026-08-03",
        valid_until: "2026-08-09",
      },
      days: [],
      updated_at: "2026-08-03T00:00:00.000Z",
      updated_by: "coach",
      trace_id: "t-current-week",
    };

    expect(() =>
      generateWidgetSnapshotsFromDashboardSnapshot({
        ledger: minimalLedger,
        activities: [],
        current_week: currentWeek as never,
      }),
    ).not.toThrow();
  });

  it("passes structured same-day match history through to Home commitments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00"));
    const activities = [
      {
        id: 1,
        history_file: "first.json",
        name: "Badminton: Ranked #1",
        category: "badminton_ranked",
        sport_type: "Badminton",
        start_date_local: "2026-09-16T09:00:00",
        elapsed_time: 3600,
      },
      {
        id: 2,
        history_file: "second.json",
        name: "Badminton: Friendly",
        category: "badminton_friendly",
        sport_type: "Badminton",
        start_date_local: "2026-09-16T18:00:00",
        elapsed_time: 3600,
      },
    ] as any;
    const snapshots = generateWidgetSnapshotsFromDashboardSnapshot({
      ledger: minimalLedger,
      activities,
      match_history: {
        version: 1,
        sessions: [
          {
            date: "2026-09-16",
            historyFile: "first.json",
            games: [
              {
                result: "W",
                scoreFor: 21,
                scoreAgainst: 18,
                partner: null,
                opponents: ["Alex"],
                format: "singles",
                category: "ranked",
              },
            ],
          },
          {
            date: "2026-09-16",
            historyFile: "second.json",
            games: [
              {
                result: "L",
                scoreFor: 15,
                scoreAgainst: 21,
                partner: null,
                opponents: ["Alex"],
                format: "singles",
                category: "friendly",
              },
            ],
          },
        ],
      },
    });

    expect(snapshots?.home.commitments.find((item) => item.id === "badminton")).toMatchObject({
      allRecord: "1W-1L",
      rankedRecord: "1W-0L",
    });
  });
});

// COACH-HQ-IOS-4 / #308: split-ledger progressions often have short_target and no target.
// Undefined target is omitted from JSON; iOS requires PhaseMilestoneSnapshot.target → empty Home.
describe("generateWidgetSnapshotsFromDashboardSnapshot phase milestones", () => {
  const splitLedger = {
    seasons: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      current_season_id: "s1",
      seasons: [
        {
          id: "s1",
          name: "Season",
          start_date: "2026-06-01",
          end_date: "2026-08-31",
          status: "active" as const,
        },
      ],
    },
    quests: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      weekly_targets: {},
      main_quest: {
        id: "main",
        name: "Main",
        type: "count_target" as const,
        target: 10,
        season_id: "s1",
      },
      quests: [],
    },
    progress: { version: 1 as const, rows: [] },
    progressions: {
      version: 1 as const,
      _meta: { updated_at: "2026-08-01", updated_by: "test", trace_id: "t0" },
      progressions: [
        {
          id: "fl_single_leg",
          name: "Front lever",
          current: "9S",
          // no target — real athlete progressions often only ship short_target
          short_target: "FULL 5S",
          unit: null,
          history: [],
        },
      ],
    },
  };

  it("emits a non-empty string target from short_target when target is missing", () => {
    const snapshots = generateWidgetSnapshotsFromDashboardSnapshot({
      ledger: splitLedger,
      activities: [],
    });
    expect(snapshots).not.toBeNull();
    const milestone = snapshots!.home.phase.milestones[0];
    expect(milestone.target).toBe("FULL 5S");
    expect(typeof milestone.target).toBe("string");
    expect(milestone.target.length).toBeGreaterThan(0);
    // Survive JSON round-trip the way /api/widget-snapshots ships to iOS
    const wire = JSON.parse(JSON.stringify(snapshots!.home.phase.milestones[0]));
    expect(wire.target).toBe("FULL 5S");
    expect(wire.name).toBe("Front lever");
    expect(wire.current).toBe("9S");
  });
});
