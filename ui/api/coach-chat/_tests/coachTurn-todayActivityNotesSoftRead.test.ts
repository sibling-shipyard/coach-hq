/**
 * Soft reads for #1147's today's-activity-notes step (ADR 0032, #1078): a GitHub fault while
 * re-reading a synced activity's hist file has nothing to do with whether a note exists, so it
 * must capture once and degrade to "no note," never throw past loadTurnState. Same contract as
 * coachTurn-softFileRead.test.ts's TEMPLATES_MANIFEST/CURRENT_WEEK soft reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFileRaw, listDirectory, getHeadShaOrNull, loadCoachContext, captureServerException } =
  vi.hoisted(() => ({
    getFileRaw: vi.fn(),
    listDirectory: vi.fn(),
    getHeadShaOrNull: vi.fn(async () => "sha-1"),
    loadCoachContext: vi.fn(),
    captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
  }));

vi.mock("../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw, listDirectory, getHeadShaOrNull, loadCoachContext };
});

vi.mock("../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/sentry.js")>();
  return { ...original, captureServerException };
});

import { loadTurnState, type TurnRequest } from "../_lib/turnRequest.js";
import { ACTIVITIES_HIST_DIR } from "../_lib/decide/activitySync.js";

const UUID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";

function baseContext() {
  return {
    soul: "soul",
    profile: { version: 1, timezone: "UTC" },
    memory: { version: 1, sports: [], coaching_style: null, notes: {} },
    injuries: { flags: [] },
    coachLog: { version: 1, rows: [] },
    seasons: { seasons: [], current_season_id: null },
    quests: { quests: [] },
    progress: { rows: [] },
    progressions: { progressions: [] },
    athleteInsights: null,
  };
}

function todaySyncedRequest(today: string): TurnRequest {
  return {
    threadId: "thread-1",
    priorMessages: [
      {
        id: "c-1",
        role: "coach",
        paragraphs: ["Nice work."],
        attachments: [
          {
            version: 1,
            kind: "synced_activity_list",
            batch_id: "batch-1",
            activities: [
              {
                id: UUID,
                title: "Morning badminton",
                sport: "Badminton",
                start: `${today}T08:00:00`,
                duration_s: 3600,
                load: null,
              },
            ],
          },
        ],
      },
    ],
    trimmed: "How did that look?",
    geminiMessage: "How did that look?",
  };
}

describe("loadTurnState today-activity-notes soft reads (#1147)", () => {
  beforeEach(() => {
    getFileRaw.mockReset();
    listDirectory.mockReset();
    captureServerException.mockClear();
    loadCoachContext.mockResolvedValue(baseContext());
  });

  // today is computed inside loadTurnState from the real clock (todayDateString(timezone, new
  // Date())), so every fixture uses "today" relative to whenever the suite runs rather than a
  // fixed date.
  function today(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date());
  }

  it("captures once and still returns a usable turn state when the hist listing 5xxs", async () => {
    const err = Object.assign(new Error("Failed to list user_data/activities/hist (503)"), {
      status: 503,
    });
    listDirectory.mockRejectedValue(err);

    const result = await loadTurnState(todaySyncedRequest(today()), "owner/repo", "token", "key");
    expect(result).not.toBeInstanceOf(Response);
    expect(captureServerException).toHaveBeenCalledWith(err);
    expect((result as { athleteContext: string }).athleteContext).not.toContain(
      "Today's Activity Notes",
    );
  });

  it("captures once and still returns a usable turn state when the hist file read 5xxs", async () => {
    listDirectory.mockResolvedValue([
      {
        name: `hk_${today()}_${UUID}.json`,
        type: "file",
        path: `${ACTIVITIES_HIST_DIR}/hk_${today()}_${UUID}.json`,
      },
    ]);
    const err = Object.assign(new Error("Failed to fetch hist file (503)"), { status: 503 });
    getFileRaw.mockRejectedValue(err);

    const result = await loadTurnState(todaySyncedRequest(today()), "owner/repo", "token", "key");
    expect(result).not.toBeInstanceOf(Response);
    expect(captureServerException).toHaveBeenCalledWith(err);
    expect((result as { athleteContext: string }).athleteContext).not.toContain(
      "Today's Activity Notes",
    );
  });

  it("stays quiet on a true 404 from the hist file read", async () => {
    listDirectory.mockResolvedValue([
      {
        name: `hk_${today()}_${UUID}.json`,
        type: "file",
        path: `${ACTIVITIES_HIST_DIR}/hk_${today()}_${UUID}.json`,
      },
    ]);
    const missing = Object.assign(new Error("Failed to fetch hist file (404)"), { status: 404 });
    getFileRaw.mockRejectedValue(missing);

    const result = await loadTurnState(todaySyncedRequest(today()), "owner/repo", "token", "key");
    expect(result).not.toBeInstanceOf(Response);
    expect(captureServerException).not.toHaveBeenCalled();
  });
});
