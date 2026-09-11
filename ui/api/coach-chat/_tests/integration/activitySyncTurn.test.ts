import { beforeEach, describe, expect, it, vi } from "vitest";
// Type-only, so these survive vi.hoisted running before the imports below. Without them the
// mock bodies infer never[] / Promise<null> and reject every mockResolvedValue in this file.
import type { DirectoryEntry } from "../../_lib/decide/coachChatFiles.js";
import type { ChatHistoryFile } from "../../_lib/chatThreads.js";
import type { ActivityFileEntry } from "../../../coach-message/_lib/coachMessage.js";
import type { LlmAdapter } from "../../../_lib/llmClient.js";

const {
  captureGeminiFailure,
  commitFilesAtomic,
  getFileRaw,
  listDirectory,
  listActivityFiles,
  loadCoachContext,
  loadChatHistory,
  generate,
} = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { path: string; resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
  getFileRaw: vi.fn(async (_repo: string, _path: string): Promise<string | null> => null),
  listDirectory: vi.fn(
    async (_repo: string, _path: string): Promise<DirectoryEntry[] | null> => [],
  ),
  listActivityFiles: vi.fn(
    async (_repo: string, _token: string): Promise<ActivityFileEntry[]> => [],
  ),
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
  loadChatHistory: vi.fn(async (): Promise<ChatHistoryFile> => ({ threads: [] })),
  captureGeminiFailure: vi.fn(async (_error: unknown, _details: unknown) => ({
    eventId: "event-id",
    sent: true,
  })),
  // generateProactiveBody's own contract: a strict-schema `{body}` string, not the old
  // coach-chat askGemini conversational reply shape.
  generate: vi.fn(async () => ({
    text: JSON.stringify({ body: "Nice work on Easy Run." }),
    telemetry: { adapter: "gemini" as const, model: "gemini-pro-latest" },
  })),
}));

vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
vi.mock("../../../_lib/sentry.js", () => ({ captureGeminiFailure }));
vi.mock("../../../_lib/llmClient.js", () => ({
  selectLlmAdapter: vi.fn(
    (): LlmAdapter => ({ name: "gemini", model: "gemini-pro-latest", generate }),
  ),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw,
    listDirectory,
    loadCoachContext,
    getHeadSha: vi.fn(async () => "head-sha"),
    invalidateCoachContext: vi.fn(),
  };
});
vi.mock("../../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/chatThreads.js")>();
  return {
    ...original,
    loadChatHistory,
  };
});
// One generator (#918): activitySyncTurn.ts now calls the same body-generation logic
// /api/coach-message uses. Keep it real (so buildProactivePrompt/loadProactiveContext get
// genuine coverage through this integration test) and only stand in for the GitHub tree read,
// which would otherwise need real HTTP mocking.
vi.mock("../../../coach-message/_lib/coachMessage.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../coach-message/_lib/coachMessage.js")>();
  return {
    ...original,
    listActivityFiles,
  };
});

import {
  activitySyncBatchId,
  commitActivitySyncHistory,
  findThreadForActivitySyncBatch,
} from "../../_lib/decide/activitySync.js";
import { handleActivitySync } from "../../_lib/commit/activitySyncTurn.js";
import { CHAT_FILE_PATH, type ChatThread } from "../../_lib/chatThreads.js";
import { isActivitySyncRequest, parseTurnRequest } from "../../_lib/coachTurn.js";
import {
  LATEST_COACH_MESSAGE_PATH,
  parseLatestMessageFile,
} from "../../../coach-message/_lib/coachMessage.js";

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
    // source/id: loadProactiveContext's authoritative-activity lookup (shared with
    // /api/coach-message) matches on these, unlike the older loadVerifiedActivities path,
    // which only ever matched by filename.
    id: UUID_A,
    source: "healthkit",
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

// Stubs both the verification path (loadVerifiedActivities, keyed by "hk:" ids and matched by
// filename only) and the shared proactive-context path (loadProactiveContext, keyed by the
// canonicalized "healthkit:" id and matched by filename + source/id) for one activity, UUID_A.
function stubVerifiedBatch(uuid = UUID_A, overrides: Record<string, unknown> = {}) {
  listDirectory.mockResolvedValue([histEntry(uuid)]);
  listActivityFiles.mockResolvedValue([histEntry(uuid)]);
  getFileRaw.mockImplementation(async (_repo: string, path: string) => {
    if (path.endsWith(`hk_2026-08-22_${uuid}.json`)) {
      return JSON.stringify(activityJson({ id: uuid, ...overrides }));
    }
    return null;
  });
}

function defaultCommitImpl(writes: { path: string; resolve?: () => Promise<string> }[]) {
  return (async () => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  })();
}

function matchingBatchThreads(threads: ChatThread[], batchId: string): ChatThread[] {
  return threads.filter((thread) => findThreadForActivitySyncBatch([thread], batchId));
}

describe("activity-sync turn contract", () => {
  beforeEach(() => {
    commitFilesAtomic.mockReset();
    commitFilesAtomic.mockImplementation(defaultCommitImpl);
    generate.mockClear();
    generate.mockResolvedValue({
      text: JSON.stringify({ body: "Nice work on Easy Run." }),
      telemetry: { adapter: "gemini" as const, model: "gemini-pro-latest" },
    });
    captureGeminiFailure.mockClear();
    getFileRaw.mockReset();
    getFileRaw.mockResolvedValue(null);
    listDirectory.mockReset();
    listDirectory.mockResolvedValue([]);
    listActivityFiles.mockReset();
    listActivityFiles.mockResolvedValue([]);
    loadChatHistory.mockReset();
    loadChatHistory.mockResolvedValue({ threads: [] });
    loadCoachContext.mockClear();
  });

  it("computes the same batch_id for the same ids in any order", () => {
    expect(activitySyncBatchId([ID_B, ID_A])).toBe(activitySyncBatchId([ID_A, ID_B]));
    expect(activitySyncBatchId([ID_A, ID_A, ID_B])).toBe(activitySyncBatchId([ID_B, ID_A]));
  });

  it("computes the same batch_id whichever endpoint's id prefix supplied it", () => {
    // #918: /api/coach-chat's activity_sync request qualifies as "hk:<uuid>";
    // /api/coach-message's stricter validator requires "healthkit:<UUID>". Same activity - the
    // batch id has to match or the two callers never find each other's thread.
    expect(activitySyncBatchId([ID_A])).toBe(activitySyncBatchId([`healthkit:${UUID_A}`]));
  });

  it("returns the existing thread for a duplicate batch without generating or writing", async () => {
    const batchId = activitySyncBatchId([ID_A, ID_B]);
    loadChatHistory.mockResolvedValue({
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
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reply: "Already said.",
      closed: false,
      duplicate: true,
      threadId: "t-existing",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("returns the coach message carrying this batch's attachment, not the thread's last coach message", async () => {
    // A thread can accumulate later, unrelated coach turns after the sync reply that seeded it
    // (#918/#922) - the duplicate-batch reply has to find the tagged message, not just reverse-scan
    // for "most recent coach message", or a later unrelated reply shadows the real sync reply.
    const batchId = activitySyncBatchId([ID_A, ID_B]);
    loadChatHistory.mockResolvedValue({
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
            {
              id: "c-2",
              role: "coach",
              paragraphs: ["Unrelated later reply."],
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
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(await response.json()).toMatchObject({
      reply: "Already said.",
      duplicate: true,
      threadId: "t-existing",
    });
  });

  it("returns 422 when a requested activity is missing, without generating or writing", async () => {
    listDirectory.mockResolvedValue([histEntry(UUID_A)]);
    getFileRaw.mockResolvedValue(null);
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A, ID_B],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(generate).not.toHaveBeenCalled();
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
    const response = await handleActivitySync("owner/repo", "token", parsed);
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

  it("orders attachment rows by start time, not id", async () => {
    listDirectory.mockResolvedValue([histEntry(UUID_A), histEntry(UUID_B)]);
    listActivityFiles.mockResolvedValue([histEntry(UUID_A), histEntry(UUID_B)]);
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path.endsWith(`_${UUID_A}.json`)) {
        return JSON.stringify(
          activityJson({
            id: UUID_A,
            name: "Later",
            start_date_local: "2026-08-22T09:00:00",
          }),
        );
      }
      if (path.endsWith(`_${UUID_B}.json`)) {
        return JSON.stringify(
          activityJson({
            id: UUID_B,
            name: "Earlier",
            start_date_local: "2026-08-22T06:00:00",
          }),
        );
      }
      return null;
    });
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A, ID_B],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    const body = await response.json();
    const coach = body.threads[0].messages.find(
      (message: { role: string }) => message.role === "coach",
    );
    expect(coach.attachments[0].activities.map((row: { title: string }) => row.title)).toEqual([
      "Earlier",
      "Later",
    ]);
  });

  it("rejects an unknown activity_ids prefix with 400", async () => {
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: ["strava:123"],
    });
    expect(parsed).toBeInstanceOf(Response);
    if (!(parsed instanceof Response)) return;
    expect(parsed.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("generates through the shared proactive-message body and commits one coach message with the attachment", async () => {
    stubVerifiedBatch();
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(200);
    expect(loadCoachContext).toHaveBeenCalledWith("owner/repo", "token", {
      fresh: true,
    });
    // The same {body}-schema call /api/coach-message makes - not the old conversational
    // askGemini(...) activity_sync mode.
    expect(generate).toHaveBeenCalledExactlyOnceWith({
      system: "",
      messages: [{ role: "user", text: expect.stringContaining("Easy Run") }],
      maxOutputTokens: 3_072,
      responseSchema: expect.objectContaining({ name: "proactive" }),
      timeoutMs: 45_000,
    });
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    // chatWrite + latestMessageWrite, committed atomically (#918/#925) - see the dedicated
    // "mints a new activity-sync thread" test below for the latest_message.json content itself.
    expect(commitFilesAtomic.mock.calls[0]?.[0]).toHaveLength(2);
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
      body.threads[0].messages.some((message: { role: string }) => message.role === "user"),
    ).toBe(false);
  });

  it("mints a new activity-sync thread and writes latest_message.json in the same commit", async () => {
    // Home reads latest_message.json for its coach-message card. If minting a thread here
    // succeeds but the iOS app's separate /api/coach-message call never lands (#918/#925), Home
    // must not go stale - so this path writes both files atomically, not just the chat thread.
    stubVerifiedBatch();
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(200);
    const body = await response.json();
    const newThreadId = body.threadId as string;

    const writes = commitFilesAtomic.mock.calls[0]?.[0] as {
      path: string;
      resolve: () => Promise<string>;
    }[];
    expect(writes.map((write) => write.path)).toEqual(
      expect.arrayContaining([CHAT_FILE_PATH, LATEST_COACH_MESSAGE_PATH]),
    );
    const latestMessageWrite = writes.find((write) => write.path === LATEST_COACH_MESSAGE_PATH);
    const latestMessageRaw = await latestMessageWrite?.resolve();
    const latest = parseLatestMessageFile(latestMessageRaw ?? null).message;
    expect(latest?.conversation_seed_id).toBe(newThreadId);
  });

  it("commitActivitySyncHistory does not add a thread when the batch already exists", () => {
    const batchId = activitySyncBatchId([ID_A]);
    const existing: ChatThread = {
      id: "t-existing",
      createdAt: 1,
      title: "Easy Run",
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
    };
    const incoming: ChatThread = {
      id: "t-new",
      createdAt: 2,
      title: "Easy Run",
      preview: "Second reply.",
      messages: [
        { id: "d-2", role: "divider", label: "TODAY" },
        {
          id: "c-2",
          role: "coach",
          paragraphs: ["Second reply."],
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
    };
    const result = commitActivitySyncHistory([existing], batchId, incoming);
    expect(result.duplicate).toBe(true);
    expect(result.thread).toBe(existing);
    expect(result.threads).toEqual([existing]);
    expect(result.threads).toHaveLength(1);
  });

  it("keeps one thread when two concurrent writes race the same batch", async () => {
    stubVerifiedBatch();
    const batchId = activitySyncBatchId([ID_A]);
    let storedThreads: ChatThread[] = [];
    loadChatHistory.mockImplementation(async () => ({
      version: 1,
      threads: structuredClone(storedThreads),
    }));

    let writeChain = Promise.resolve();
    commitFilesAtomic.mockImplementation(
      async (writes: { path: string; resolve?: () => Promise<string> }[]) => {
        const run = writeChain.then(async () => {
          for (const write of writes) {
            const content = await write.resolve?.();
            // Two writes land in this array now (chatWrite + latestMessageWrite, #918/#925) -
            // only the chat-history one is shaped like { threads }; matching on path keeps this
            // race test's bookkeeping about the chat thread list, not the coach-message file.
            if (write.path === CHAT_FILE_PATH && typeof content === "string") {
              const parsed = JSON.parse(content) as { threads?: ChatThread[] };
              storedThreads = parsed.threads ?? [];
            }
          }
          return { commitSha: "commit-sha" };
        });
        writeChain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    );

    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }

    const [first, second] = await Promise.all([
      handleActivitySync("owner/repo", "token", parsed),
      handleActivitySync("owner/repo", "token", parsed),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(commitFilesAtomic).toHaveBeenCalledTimes(2);

    const bodies = [await first.json(), await second.json()];
    expect(matchingBatchThreads(storedThreads, batchId)).toHaveLength(1);
    expect(
      bodies.some((body) => body.duplicate === true) ||
        matchingBatchThreads(storedThreads, batchId).length === 1,
    ).toBe(true);
  });

  it("returns an error and writes nothing when generation fails", async () => {
    stubVerifiedBatch();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    generate.mockRejectedValueOnce(Object.assign(new Error("model down"), { status: 503 }));
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "model down" });
    expect(commitFilesAtomic).not.toHaveBeenCalled();
    // generateProactiveBody itself captures the failure - handleActivitySync just shapes the
    // Response, it doesn't double-report.
    expect(captureGeminiFailure).toHaveBeenCalledTimes(1);
    expect(captureGeminiFailure.mock.calls[0][1]).toMatchObject({
      model: "gemini-pro-latest",
      upstreamStatus: 503,
      turnMode: "proactive_message",
    });
    errorSpy.mockRestore();
  });

  it("returns 502 and does not persist when the commit fails after generation", async () => {
    stubVerifiedBatch();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    commitFilesAtomic.mockRejectedValueOnce(new Error("github 409"));
    const parsed = await parseBody({
      action: "activity_sync",
      activity_ids: [ID_A],
    });
    if (parsed instanceof Response || !isActivitySyncRequest(parsed)) {
      throw new Error("expected an activity_sync request");
    }
    const response = await handleActivitySync("owner/repo", "token", parsed);
    expect(response.status).toBe(502);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("saving failed"),
    });
    errorSpy.mockRestore();
  });
});
