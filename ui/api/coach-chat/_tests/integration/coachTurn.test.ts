import { beforeEach, describe, expect, it, vi } from "vitest";

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));

vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
vi.mock("../../_lib/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw: vi.fn(async () => null),
    invalidateCoachContext: vi.fn(),
  };
});
vi.mock("../../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/chatThreads.js")>();
  return {
    ...original,
    loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })),
  };
});

import {
  buildTurnWrites,
  commitClosingTurn,
  commitOrdinaryTurn,
  parseTurnRequest,
} from "../../_lib/coachTurn.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "Done for today",
    geminiMessage: "Done for today",
    endConversationRequested: false,
    repo: "owner/repo",
    token: "token",
    apiKey: "key",
    currentSha: "old-sha",
    stale: false,
    context: {
      soul: "soul",
      profile: null,
      memory: null,
      injuries: null,
      coachLog: null,
      seasons: null,
      quests: null,
      progress: null,
      progressions: null,
      athleteInsights: null,
    },
    timezone: "UTC",
    athleteContext: "",
    questContext: "",
    firstSession: true,
    closeIntent: false,
    now: Date.now(),
    traceId: "trace-1",
    validTemplateIds: new Set<string>(),
    weekSessionsForContext: [],
    reply: { reply: "Good work.", session_closed: false },
    closing: false,
    ...overrides,
  };
}

describe("coach turn stages", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
  });

  it("parses an ordinary message without carrying the transport body forward", async () => {
    const result = await parseTurnRequest(
      new Request("https://coach.test", {
        method: "POST",
        body: JSON.stringify({ message: "  Felt strong  ", messages: [] }),
      }),
    );
    expect(result).toMatchObject({
      trimmed: "Felt strong",
      priorMessages: [],
      endConversationRequested: false,
    });
  });

  it("builds only the writes represented by Gemini actions", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Logged.",
          session_closed: true,
          coach_note: "Strong session",
          injury_event: [{ text: "Sore ankle", status: "active" }],
        },
        closing: true,
      }) as never,
    );
    expect(turn.optionalWrites.map((write) => write.path)).toEqual([
      "user_data/coach/coach_log.json",
      "user_data/coach/injuries.json",
    ]);
    expect(turn.chatWrite.path).toBe("user_data/coach/chat_history.json");
    await turn.chatWrite.resolve?.();
    expect(turn.latestThreads).toHaveLength(1);
  });

  it("commits incremental First Session writes on an ordinary turn", async () => {
    const response = await commitOrdinaryTurn({
      ...baseTurn(),
      wasProfileComplete: false,
      profileComplete: false,
      fspCandidates: [{ path: "user_data/coach/profile.json", content: "{}" }],
    } as never);
    expect(commitFilesAtomic).toHaveBeenCalledWith(
      expect.any(Array),
      "coach: first session details recorded",
      expect.objectContaining({ repo: "owner/repo" }),
    );
    expect(await response.json()).toMatchObject({
      reply: "Good work.",
      closed: false,
      repoSha: "commit-sha",
    });
  });

  it("commits chat and action writes together on a closing turn", async () => {
    const latestThreads = [
      {
        id: "thread-1",
        createdAt: 1,
        title: "Done",
        preview: "Good work.",
        messages: [],
      },
    ];
    const response = await commitClosingTurn({
      ...baseTurn({
        closing: true,
        reply: { reply: "Good work.", session_closed: true },
      }),
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [{ path: "user_data/coach/coach_log.json", content: "{}" }],
      latestThreads,
      finalThreadId: "thread-1",
      computedTitle: "Done",
      wasProfileComplete: true,
      profileComplete: true,
    } as never);
    expect(
      commitFilesAtomic.mock.calls[0]?.[0].map((write) => (write as { path: string }).path),
    ).toEqual([
      "user_data/coach/profile.json",
      "user_data/coach/chat_history.json",
      "user_data/coach/coach_log.json",
    ]);
    expect(await response.json()).toMatchObject({
      closed: true,
      threadId: "thread-1",
      repoSha: "commit-sha",
    });
  });
});
