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
      main_quest: { id: "main", name: "Main", type: "count_target" as const, target: 10 },
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
