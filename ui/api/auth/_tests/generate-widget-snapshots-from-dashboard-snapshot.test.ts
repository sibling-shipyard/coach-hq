import { describe, it, expect, vi, afterEach } from "vitest";
import {
  needsLiveRecomputation,
  projectLatestCoachMessage,
  splitLedgerAsChallenge,
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
it("adapts a complete split ledger for the existing widget models", () => {
  const challenge = splitLedgerAsChallenge({
    seasons: { version: 1, _meta: { updated_at: "", updated_by: "", trace_id: "" }, current_season_id: "s1", seasons: [{ id: "s1", name: "Build", start_date: "2026-01-01", end_date: "2026-12-31", status: "active" }] },
    quests: { version: 1, _meta: { updated_at: "", updated_by: "", trace_id: "" }, weekly_targets: { run: { target: 3 } }, main_quest: { id: "main", name: "Run", type: "count_target", target: 20 }, quests: [{ id: "q1", name: "Mobility", type: "daily_streak", start_date: "2026-01-01", end_date: null, status: "active", source: "model" }] },
    progress: { version: 1, rows: [{ id: "r1", quest_id: "q1", season_id: "s1", date: "2026-08-19", status: "completed", value: null, source: "model", ts: "2026-08-19T00:00:00Z", trace_id: "t" }] },
    progressions: {},
  });
  expect(challenge?.season?.name).toBe("Build");
  expect(challenge?.weekly_targets).toMatchObject({ run: 3 });
  expect(challenge?.quests[0].completed_dates).toEqual(["2026-08-19"]);
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
