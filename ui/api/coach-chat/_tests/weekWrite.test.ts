import { describe, expect, it, vi } from "vitest";

vi.mock("../_lib/coachWeekFiles.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../_lib/coachWeekFiles.js")>();
  return {
    ...orig,
    applyWeekPlan: vi.fn(orig.applyWeekPlan),
    applySessionReconcile: vi.fn(orig.applySessionReconcile),
  };
});

vi.mock("../_lib/coachChatFiles.js", () => ({
  getFileRaw: vi.fn(),
}));

import { applyWeekPlan, applySessionReconcile, CURRENT_WEEK_PATH, type WeekPlan } from "../_lib/coachWeekFiles.js";
import { getFileRaw } from "../_lib/coachChatFiles.js";
import { buildCurrentWeekWrite } from "../_lib/turnWrites/weekWrite.js";

function validPlan(): WeekPlan {
  const days = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"].map(
    (date) => ({ date, sessions: [] as WeekPlan["days"][number]["sessions"] }),
  );
  days[0].sessions = [{ discipline: "run", kind: "easy", title: "Easy 5k" }];
  return {
    headline: "Steady week ahead.",
    body: "Focus on consistency over intensity this week.",
    days,
  };
}

describe("buildCurrentWeekWrite", () => {
  it("rejects invalid week JSON from the applier and does not return a write", () => {
    vi.mocked(applyWeekPlan).mockReturnValueOnce(JSON.stringify({ schema_version: 1 }));
    expect(() =>
      buildCurrentWeekWrite("owner/repo", "token", "UTC", "t1", validPlan(), [], [], new Set()),
    ).toThrow(/failed validation/);
  });

  it("rejects a missing required field on the resolve path and does not treat it as success", async () => {
    vi.mocked(getFileRaw).mockResolvedValueOnce("{}");
    vi.mocked(applySessionReconcile).mockReturnValueOnce(JSON.stringify({ schema_version: 1 }));
    const write = buildCurrentWeekWrite(
      "owner/repo",
      "token",
      "UTC",
      "t1",
      undefined,
      [{ session_id: "sess_20260817_1", status: "done" }],
      [],
      new Set(),
    );
    expect(write?.path).toBe(CURRENT_WEEK_PATH);
    await expect(write && "resolve" in write ? write.resolve() : Promise.resolve("")).rejects.toThrow(
      /failed validation/,
    );
  });
});
