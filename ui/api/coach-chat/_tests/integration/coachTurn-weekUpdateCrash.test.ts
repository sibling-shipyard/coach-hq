import { beforeEach, describe, expect, it, vi } from "vitest";

// Live-verified (#727): a full-week-kickoff week_update is built and structurally validated
// eagerly inside buildCurrentWeekWrite, with no error boundary in its caller - a real validation
// failure (reproduced live: two days with a missing/empty `intent`) threw straight out of
// buildTurnWrites, crashing the whole turn. Confirms the fix: this drops week_update as one bad
// action and keeps the rest of the turn's writes, same discipline as every other action field.

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async () => null),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw, invalidateCoachContext: vi.fn() };
});
vi.mock("../../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/chatThreads.js")>();
  return { ...original, loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })) };
});
vi.mock("../../_lib/decide/coachWeekFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachWeekFiles.js")>();
  return {
    ...original,
    applyWeekUpdate: vi.fn(() => {
      throw new Error(
        "week_update: kickoff result failed current_week.json validation: current_week.days[2].intent must be a non-empty string",
      );
    }),
  };
});

import { buildTurnWrites } from "../../_lib/coachTurn.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "Let's plan the week",
    geminiMessage: "Let's plan the week",
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
    firstSession: false,
    now: Date.now(),
    traceId: "trace-1",
    validQuestIds: new Set<string>(),
    validInjuryFlagIds: new Set<string>(),
    activeInjuryFlagIds: new Set<string>(),
    reply: { reply: "Good work." },
    finalReplyText: "Good work.",
    ...overrides,
  };
}

describe("coach turn stages - week_update kickoff failure (#727 live-test regression)", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    getFileRaw.mockClear();
  });

  it("drops week_update as a dropped action instead of throwing out of buildTurnWrites", async () => {
    const days = [
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ].map((date) => ({ date, sessions: [] as never[] }));

    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Locked in the week.",
          week_update: {
            headline: "Trek prep week",
            body: "Strength and stairs.",
            days,
          },
        },
      }) as never,
    );

    expect(turn.droppedActions).toEqual([
      expect.objectContaining({ field: "week_update", reason: expect.stringContaining("intent") }),
    ]);
    expect(turn.optionalWrites.some((write) => write.path.includes("current_week"))).toBe(false);
  });
});
