import { beforeEach, describe, expect, it, vi } from "vitest";

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));

vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
const { getFileRaw } = vi.hoisted(() => ({ getFileRaw: vi.fn(async () => null) }));
vi.mock("../../_lib/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw,
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

import { buildTurnWrites, commitTurn, parseTurnRequest } from "../../_lib/coachTurn.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "Done for today",
    geminiMessage: "Done for today",
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
    now: Date.now(),
    traceId: "trace-1",
    reply: { reply: "Good work." },
    ...overrides,
  };
}

describe("coach turn stages", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    getFileRaw.mockClear();
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
    });
  });

  it("builds only the writes represented by Gemini actions", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Logged.",
          injury_flag: [{ text: "Sore ankle" }],
        },
      }) as never,
    );
    // coach_note is dormant since C1 (see coachReplySchema.ts) - Gemini never sets it, so it
    // never appears in optionalWrites even though buildCoachNoteWrite still exists for C2.
    expect(turn.optionalWrites.map((write) => write.path)).toEqual([
      "user_data/coach/injuries.json",
    ]);
    expect(turn.chatWrite.path).toBe("user_data/coach/chat_history.json");
    await turn.chatWrite.resolve?.();
    expect(turn.latestThreads).toHaveLength(1);
  });

  // C1: template_edit/session_plan/week_plan/session_reconcile/plan_edit are available on any
  // returning-athlete turn now, not gated to a closing turn any more - this turn has no close
  // signal at all (there's no such concept left to signal). Also exercises the lazy
  // templates-manifest fetch (correction #4): it only fires because this reply asked for
  // template_edit.
  it("commits a template_edit on an ordinary turn, no close signal needed", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        firstSession: false,
        reply: {
          reply: "Removing that phase.",
          template_edit: { template_id: "tpl-1" },
        },
      }) as never,
    );
    expect(turn.optionalWrites.map((write) => write.path)).toContain(
      "user_data/activities/workout_plans/templates/tpl-1.json",
    );
    // The manifest fetch only happens because this reply carried template_edit - an ordinary
    // turn with none of the session-artifact fields never pays for it (see the earlier test).
    expect(getFileRaw).toHaveBeenCalledWith(
      "owner/repo",
      "user_data/activities/workout_plans/templates/_manifest.json",
      "token",
    );
  });

  it("commits incremental First Session writes on an ordinary turn", async () => {
    const response = await commitTurn({
      ...baseTurn(),
      wasProfileComplete: false,
      profileComplete: false,
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [],
      latestThreads: [],
      finalThreadId: "thread-1",
      computedTitle: "Felt strong",
    } as never);
    expect(commitFilesAtomic).toHaveBeenCalledWith(
      expect.any(Array),
      "coach: chat — Felt strong",
      expect.objectContaining({ repo: "owner/repo" }),
    );
    expect(await response.json()).toMatchObject({
      reply: "Good work.",
      repoSha: "commit-sha",
    });
  });

  it("commits chat and action writes together for a returning, profile-complete athlete (#616)", async () => {
    const latestThreads = [
      {
        id: "thread-1",
        createdAt: 1,
        title: "Done",
        preview: "Good work.",
        messages: [],
      },
    ];
    const response = await commitTurn({
      ...baseTurn(),
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [{ path: "user_data/coach/injuries.json", content: "{}" }],
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
      "user_data/coach/injuries.json",
    ]);
    expect(await response.json()).toMatchObject({
      reply: "Good work.",
      threadId: "thread-1",
      repoSha: "commit-sha",
    });
  });
});
