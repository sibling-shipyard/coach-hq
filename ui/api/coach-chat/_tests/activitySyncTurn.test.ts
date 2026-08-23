import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  commitFilesAtomic,
  askGemini,
  getFileRaw,
  listDirectory,
  loadCoachContext,
  loadChatHistory,
} = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(
    async (writes: { resolve?: () => Promise<string> }[]) => {
      for (const write of writes) await write.resolve?.();
      return { commitSha: "commit-sha" };
    },
  ),
  askGemini: vi.fn(async () => ({
    reply: "Nice work on Easy Run.",
    session_closed: false,
  })),
  getFileRaw: vi.fn(async () => null),
  listDirectory: vi.fn(async () => []),
  loadCoachContext: vi.fn(async () => ({
    soul: "soul",
    profile: { timezone: "UTC" },
    memory: null,
    injuries: null,
    coachLog: null,
    seasons: null,
    quests: null,
    progress: null,
    progressions: null,
    athleteInsights: null,
  })),
  loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })),
}));

vi.mock("../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
vi.mock("../_lib/geminiClient.js", () => ({ askGemini }));
vi.mock("../_lib/coachChatFiles.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../_lib/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw,
    listDirectory,
    loadCoachContext,
    getHeadSha: vi.fn(async () => "head-sha"),
    invalidateCoachContext: vi.fn(),
  };
});
vi.mock("../_lib/chatThreads.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../_lib/chatThreads.js")>();
  return {
    ...original,
    loadChatHistory,
  };
});

import {
  ACTIVITY_SYNC_USER_TEXT,
  activitySyncBatchId,
} from "../_lib/activitySync.js";
import { handleActivitySync } from "../_lib/activitySyncTurn.js";
import {
  isActivitySyncRequest,
  parseTurnRequest,
} from "../_lib/coachTurn.js";

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const ID_A = `hk:${UUID_A}`;
const ID_B = `hk:${UUID_B}`;

function histEntry(uuid: string, date = "2026-08-22") {
  const name = `hk_${date}_${uuid}.json`;
  return {
    name,
    type: "file",
    path: `user_data/activities/hist/${name}`,
  };
}

function activityJson(overrides: Record<string, unknown> = {}) {
  return {
    name: "Easy Run",
    sport_type: "Run",
    start_date_local: "2026-08-22T06:30:00",
    elapsed_time: 2400,
    hr_zones: {
      "Zone 1": { seconds: 60 },
      "Zone 2": { seconds: 60 },
    },
    ...overrides,
  };
}

function parseBody(body: Record<string, unknown>) {
  return parseTurnRequest(
    new Request("https://coach.test", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

function stubVerifiedBatch() {
  listDirectory.mockResolvedValue([histEntry(UUID_A)]);
  getFileRaw.mockImplementation(async (_repo: string, path: string) => {
    if (path.endsWith(`hk_2026-08-22_${UUID_A}.json`)) {
      return JSON.stringify(activityJson());
    }
    return null;
  });
}

describe("activity-sync turn contract", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    askGemini.mockClear();
    getFileRaw.mockReset();
    getFileRaw.mockResolvedValue(null);
    listDirectory.mockReset();
    listDirectory.mockResolvedValue([]);
    loadChatHistory.mockReset();
    loadChatHistory.mockResolvedValue({ version: 1, threads: [] });
    loadCoachContext.mockClear();
  });

  it("computes the same batch_id for the same ids in any order", () => {
    expect(activitySyncBatchId([ID_B, ID_A])).toBe(activitySyncBatchId([ID_A, ID_B]));
    expect(activitySyncBatchId([ID_A, ID_A, ID_B])).toBe(
      activitySyncBatchId([ID_B, ID_A]),
    );
  });

  it("returns the existing thread for a duplicate batch without Gemini or a write", async () => {
    const batchId = activitySyncBatchId([ID_A, ID_B]);
    loadChatHistory.mockResolvedValue({
      version: 1,
      threads: [
        {
          id: "t-existing",
          createdAt: 1,
          title: "2 sessions synced",
          preview: "Already said.",
          messages: [
            { id: "d-1", role: "divider", label: "TODAY" },
            {
              id: "c-1",
              role: "coach",
              paragraphs: ["Already said."],
              attachments: [
                {
                  version: 1,
                  kind: "synced_activity_list",
                  batch_id: batchId,
                  activities: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_B, ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync(
      "owner/repo",
      "token",
      "key",
      parsed,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reply: "Already said.",
      closed: false,
      duplicate: true,
      threadId: "t-existing",
    });
    expect(askGemini).not.toHaveBeenCalled();
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("returns 422 when a requested activity is missing, without Gemini or a write", async () => {
    listDirectory.mockResolvedValue([histEntry(UUID_A)]);
    getFileRaw.mockResolvedValue(null);
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A, ID_B],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync(
      "owner/repo",
      "token",
      "key",
      parsed,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(askGemini).not.toHaveBeenCalled();
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("builds attachment title, sport, duration, and load from reread JSON", async () => {
    stubVerifiedBatch();
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
      title: "CLIENT TITLE",
      sport: "CLIENT SPORT",
      duration_s: 999,
      load: 99,
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync(
      "owner/repo",
      "token",
      "key",
      parsed,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const coach = body.threads[0].messages.find(
      (message: { role: string }) => message.role === "coach",
    );
    expect(coach.attachments).toEqual([
      {
        version: 1,
        kind: "synced_activity_list",
        batch_id: activitySyncBatchId([ID_A]),
        activities: [
          {
            id: UUID_A,
            title: "Easy Run",
            sport: "Run",
            start: "2026-08-22T06:30:00",
            duration_s: 2400,
            load: 3,
          },
        ],
      },
    ]);
    expect(JSON.stringify(coach.attachments)).not.toContain("CLIENT TITLE");
    expect(JSON.stringify(coach.attachments)).not.toContain("CLIENT SPORT");
  });

  it("rejects an unknown activity_ids prefix with 400", async () => {
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: ["strava:123"],
    });
    expect(parsed).toBeInstanceOf(Response);
    if (!(parsed instanceof Response)) return;
    expect(parsed.status).toBe(400);
    expect(askGemini).not.toHaveBeenCalled();
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("sends verified titles to Gemini and commits one coach message with the attachment", async () => {
    stubVerifiedBatch();
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync(
      "owner/repo",
      "token",
      "key",
      parsed,
    );
    expect(response.status).toBe(200);
    expect(loadCoachContext).toHaveBeenCalledWith("owner/repo", "token", {
      fresh: true,
    });
    expect(askGemini).toHaveBeenCalledWith(
      "key",
      "soul",
      expect.any(String),
      expect.any(String),
      [],
      ACTIVITY_SYNC_USER_TEXT,
      "activity_sync",
      false,
      expect.stringContaining("Easy Run"),
      undefined,
      "UTC",
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    expect(commitFilesAtomic.mock.calls[0]?.[0]).toHaveLength(1);
    const body = await response.json();
    expect(body).toMatchObject({
      reply: "Nice work on Easy Run.",
      closed: false,
      duplicate: false,
      repoSha: "commit-sha",
    });
    const coach = body.threads[0].messages.find(
      (message: { role: string }) => message.role === "coach",
    );
    expect(coach.paragraphs).toEqual(["Nice work on Easy Run."]);
    expect(coach.attachments[0]).toMatchObject({
      kind: "synced_activity_list",
      activities: [expect.objectContaining({ title: "Easy Run" })],
    });
    expect(
      body.threads[0].messages.some(
        (message: { role: string }) => message.role === "user",
      ),
    ).toBe(false);
  });
});
