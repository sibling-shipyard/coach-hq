import { beforeEach, describe, it, expect, vi } from "vitest";
import { coachDayNumber } from "../../_lib/decide/coachDay.js";

const { captureServerException, applyJsonMergePatchMock, realApplyHolder } = vi.hoisted(() => ({
  captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
  applyJsonMergePatchMock: vi.fn(),
  realApplyHolder: {} as {
    fn?: typeof import("../../../_lib/fileEdits.js").applyJsonMergePatch;
  },
}));

vi.mock("../../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../_lib/sentry.js")>();
  return { ...original, captureServerException };
});

vi.mock("../../../_lib/fileEdits.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../_lib/fileEdits.js")>();
  realApplyHolder.fn = original.applyJsonMergePatch;
  applyJsonMergePatchMock.mockImplementation(original.applyJsonMergePatch);
  return { ...original, applyJsonMergePatch: applyJsonMergePatchMock };
});

import { injectCoachSinceIfNeeded } from "../../_lib/decide/coachSinceStamp.js";

// ADR 0018: coach_since is a durable, write-once day-number anchor. These tests cover the two
// pure pieces - the fallback chain that resolves "day N" for a commit message, and the
// transition-detection + merge logic that stamps coach_since exactly once, on the turn that
// finishes the First Session Protocol.
describe("coachDayNumber", () => {
  const timezoneUTC = "UTC";

  it("uses coach_since when present", () => {
    const challenge = JSON.stringify({ coach_since: "2026-07-30" });
    expect(coachDayNumber(challenge, timezoneUTC, new Date("2026-08-02T12:00:00Z"))).toBe(4);
  });

  it("falls back to season.start_date when coach_since is absent", () => {
    const challenge = JSON.stringify({ season: { start_date: "2026-08-01" } });
    expect(coachDayNumber(challenge, timezoneUTC, new Date("2026-08-02T12:00:00Z"))).toBe(2);
  });

  it("falls back to challenge.start_date when neither coach_since nor season is present", () => {
    const challenge = JSON.stringify({ challenge: { start_date: "2026-08-02" } });
    expect(coachDayNumber(challenge, timezoneUTC, new Date("2026-08-02T12:00:00Z"))).toBe(1);
  });

  it("prefers coach_since over season/challenge start dates when all three are present", () => {
    const challenge = JSON.stringify({
      coach_since: "2026-01-01",
      season: { start_date: "2026-07-01" },
      challenge: { start_date: "2026-08-01" },
    });
    expect(coachDayNumber(challenge, timezoneUTC, new Date("2026-01-02T12:00:00Z"))).toBe(2);
  });

  it("returns null when challengeJson is null", () => {
    expect(coachDayNumber(null, timezoneUTC, new Date())).toBeNull();
  });

  it("returns null when challengeJson is undefined (ordinary turn, never fetched)", () => {
    expect(coachDayNumber(undefined, timezoneUTC, new Date())).toBeNull();
  });

  it("returns null when none of coach_since/season/challenge start dates are present", () => {
    expect(coachDayNumber(JSON.stringify({ phase: "base" }), timezoneUTC, new Date())).toBeNull();
  });

  it("returns null for unparsable JSON", () => {
    expect(coachDayNumber("{not valid", timezoneUTC, new Date())).toBeNull();
  });
});

describe("injectCoachSinceIfNeeded", () => {
  const timezoneUTC = "UTC";
  // Found live testing Part A: this used to target user_data/ledger/challenge_v2.json - the file
  // Part 2's ledger split deleted. coach_since lives in profile.json (ProfileJson.coach_since)
  // and was never migrated when that redesign landed - the false->true transition this gates was
  // dead code until Part A made it reachable, so the wrong target never surfaced until now.
  const closingFiles = { profile: '{"name":"Skanda","timezone":"UTC"}' };

  beforeEach(() => {
    captureServerException.mockClear();
    applyJsonMergePatchMock.mockReset();
    applyJsonMergePatchMock.mockImplementation(realApplyHolder.fn!);
  });

  it("does nothing when the profile was already complete before this turn", async () => {
    const updates = [{ path: "user_data/coach/profile.json", content: "filled in" }];
    const result = await injectCoachSinceIfNeeded(updates, closingFiles, true, true, timezoneUTC);
    expect(result).toBe(updates);
  });

  it("does nothing when the profile still isn't complete after this turn", async () => {
    const updates: { path: string; content: string }[] = [];
    const result = await injectCoachSinceIfNeeded(updates, closingFiles, false, false, timezoneUTC);
    expect(result).toBe(updates);
  });

  it("does nothing on an ordinary turn where closingFiles was never fetched", async () => {
    const updates: { path: string; content: string }[] = [];
    const result = await injectCoachSinceIfNeeded(updates, undefined, false, true, timezoneUTC);
    expect(result).toBe(updates);
  });

  it("stamps coach_since onto profile.json on the false→true transition", async () => {
    const result = await injectCoachSinceIfNeeded([], closingFiles, false, true, timezoneUTC);
    const entry = result.find((u) => u.path === "user_data/coach/profile.json");
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content);
    expect(parsed.name).toBe("Skanda");
    expect(typeof parsed.coach_since).toBe("string");
    expect(parsed.coach_since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("merges onto a profile.json write Gemini already proposed this same turn, instead of adding a second write", async () => {
    const geminiUpdate = {
      path: "user_data/coach/profile.json",
      content: '{"name":"Skanda","timezone":"America/Chicago"}',
    };
    const result = await injectCoachSinceIfNeeded(
      [geminiUpdate],
      closingFiles,
      false,
      true,
      timezoneUTC,
    );
    const profileEntries = result.filter((u) => u.path === "user_data/coach/profile.json");
    expect(profileEntries).toHaveLength(1);
    const parsed = JSON.parse(profileEntries[0].content);
    expect(parsed.timezone).toBe("America/Chicago");
    expect(typeof parsed.coach_since).toBe("string");
  });

  it("never overwrites an existing coach_since, even if the transition logic somehow fires again", async () => {
    const files = { profile: '{"coach_since":"2026-01-01"}' };
    const result = await injectCoachSinceIfNeeded([], files, false, true, timezoneUTC);
    expect(result).toEqual([]);
  });

  it("handles profile.json not existing yet (null)", async () => {
    const files = { profile: null };
    const result = await injectCoachSinceIfNeeded([], files, false, true, timezoneUTC);
    const entry = result.find((u) => u.path === "user_data/coach/profile.json");
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content);
    expect(typeof parsed.coach_since).toBe("string");
  });

  it("captures and skips when profile.json is unparsable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const files = { profile: "{not valid" };
    const updates: { path: string; content: string }[] = [];
    const result = await injectCoachSinceIfNeeded(updates, files, false, true, timezoneUTC);
    expect(result).toBe(updates);
    expect(captureServerException).toHaveBeenCalledTimes(1);
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("unparsable");
    warnSpy.mockRestore();
  });

  it("captures and skips when the coach_since merge patch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyJsonMergePatchMock.mockReturnValueOnce({ ok: false, error: "forced merge failure" });
    const updates: { path: string; content: string }[] = [];
    const result = await injectCoachSinceIfNeeded(updates, closingFiles, false, true, timezoneUTC);
    expect(result).toBe(updates);
    expect(captureServerException).toHaveBeenCalledTimes(1);
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain(
      "forced merge failure",
    );
    warnSpy.mockRestore();
  });
});
