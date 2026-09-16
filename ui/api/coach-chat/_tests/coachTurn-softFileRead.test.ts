/**
 * Soft getFileRaw sites in coachTurn (#1108 PR1): same contract as getHeadShaOrNull —
 * 404 quiet; other faults capture once then null. Covers validate-path soft reads in
 * buildTurnWrites (prefetch uses the same try/catch shape).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getFileRaw, captureServerException } = vi.hoisted(() => ({
  getFileRaw: vi.fn(),
  captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
}));

vi.mock("../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw, invalidateCoachContext: vi.fn() };
});

vi.mock("../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/sentry.js")>();
  return { ...original, captureServerException };
});

vi.mock("../../_lib/githubGitData.js", () => ({
  commitFilesAtomic: vi.fn(async () => ({ commitSha: "sha" })),
}));

vi.mock("../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_lib/chatThreads.js")>();
  return { ...original, loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })) };
});

import { buildTurnWrites } from "../_lib/coachTurn.js";
import { TEMPLATES_MANIFEST_PATH } from "../_lib/decide/coachWorkoutFiles.js";
import { CURRENT_WEEK_PATH } from "../_lib/decide/coachWeekFiles.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "plan",
    geminiMessage: "plan",
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
    reply: {
      reply: "ok",
      // Patch-shaped week_update forces soft CURRENT_WEEK + TEMPLATES_MANIFEST reads.
      week_update: {
        days: [{ date: "2026-09-15", sessions: [{ session_id: "s1", action: "remove" }] }],
      },
    },
    finalReplyText: "ok",
    prefetchedTemplatesManifestContent: undefined,
    prefetchedCurrentWeekContent: undefined,
    ...overrides,
  };
}

describe("buildTurnWrites soft getFileRaw (#1108)", () => {
  beforeEach(() => {
    getFileRaw.mockReset();
    captureServerException.mockClear();
  });

  it("captures once and continues when manifest soft-read hits a non-404 fault", async () => {
    const err = Object.assign(new Error("Failed to fetch manifest (503)"), { status: 503 });
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path === TEMPLATES_MANIFEST_PATH) throw err;
      if (path === CURRENT_WEEK_PATH) {
        return JSON.stringify({
          version: 1,
          week_start: "2026-09-15",
          days: [{ date: "2026-09-15", intent: "train", sessions: [{ id: "s1" }] }],
        });
      }
      return null;
    });
    await expect(buildTurnWrites(baseTurn() as never)).resolves.toBeTruthy();
    expect(captureServerException).toHaveBeenCalledWith(err);
  });

  it("stays quiet when soft-read is a true 404", async () => {
    const missing = Object.assign(new Error("Failed to fetch week (404)"), { status: 404 });
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path === TEMPLATES_MANIFEST_PATH) return JSON.stringify({ template_ids: [] });
      if (path === CURRENT_WEEK_PATH) throw missing;
      return null;
    });
    await expect(buildTurnWrites(baseTurn() as never)).resolves.toBeTruthy();
    expect(captureServerException).not.toHaveBeenCalled();
  });
});
