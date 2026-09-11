import { describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/decide/coachWeekFiles.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../_lib/decide/coachWeekFiles.js")>();
  return {
    ...orig,
    applyWeekUpdate: vi.fn(orig.applyWeekUpdate),
  };
});

vi.mock("../../_lib/decide/coachChatFiles.js", () => ({
  getFileRaw: vi.fn(),
}));

import {
  applyWeekUpdate,
  CURRENT_WEEK_PATH,
  type WeekUpdate,
} from "../../_lib/decide/coachWeekFiles.js";
import { getFileRaw } from "../../_lib/decide/coachChatFiles.js";
import { buildCurrentWeekWrite } from "../../_lib/decide/turnWrites/weekWrite.js";

function validKickoff(): WeekUpdate {
  const days = [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ].map((date) => ({ date, sessions: [] as WeekUpdate["days"][number]["sessions"] }));
  days[0].sessions = [{ discipline: "run", kind: "easy", title: "Easy 5k" }];
  return {
    headline: "Steady week ahead.",
    body: "Focus on consistency over intensity this week.",
    days,
  };
}

describe("buildCurrentWeekWrite", () => {
  it("returns undefined when week_update is absent", () => {
    expect(
      buildCurrentWeekWrite("owner/repo", "token", "UTC", "t1", undefined, new Set()),
    ).toBeUndefined();
  });

  it("rejects invalid week JSON from a kickoff applier and does not return a write", () => {
    vi.mocked(applyWeekUpdate).mockReturnValueOnce(JSON.stringify({ schema_version: 1 }));
    expect(() =>
      buildCurrentWeekWrite("owner/repo", "token", "UTC", "t1", validKickoff(), new Set()),
    ).toThrow(/failed validation/);
  });

  it("rejects a missing required field on the patch resolve path and does not treat it as success", async () => {
    vi.mocked(getFileRaw).mockResolvedValueOnce("{}");
    vi.mocked(applyWeekUpdate).mockReturnValueOnce(JSON.stringify({ schema_version: 1 }));
    const patch: WeekUpdate = {
      days: [
        {
          date: "2026-08-17",
          sessions: [{ session_id: "sess_20260817_1", status: "done" }],
        },
      ],
    };
    const write = buildCurrentWeekWrite("owner/repo", "token", "UTC", "t1", patch, new Set());
    expect(write?.path).toBe(CURRENT_WEEK_PATH);
    await expect(
      write && "resolve" in write ? write.resolve() : Promise.resolve(""),
    ).rejects.toThrow(/failed validation/);
  });
});
