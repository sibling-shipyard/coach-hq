import { beforeEach, describe, expect, it, vi } from "vitest";

const { askGemini } = vi.hoisted(() => ({ askGemini: vi.fn() }));
vi.mock("../_lib/geminiClient.js", () => ({ askGemini }));

import { requestCoachReply } from "../_lib/coachTurn.js";
import { COACH_LOG_TEXT_CAP } from "../_lib/text-caps.bundle.js";

function baseTurnState(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "wrap session",
    geminiMessage: "wrap session",
    endConversationRequested: true,
    repo: "owner/repo",
    token: "token",
    apiKey: "key",
    currentSha: "sha",
    stale: false,
    context: { soul: "soul" },
    timezone: "UTC",
    athleteContext: "",
    questContext: "",
    firstSession: false,
    closeIntent: true,
    now: Date.now(),
    traceId: "trace-1",
    validTemplateIds: new Set<string>(),
    weekSessionsForContext: [],
    ...overrides,
  } as Parameters<typeof requestCoachReply>[0];
}

describe("requestCoachReply text-cap reprompt (issue #462, layer 2)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts exactly once when coach_note comes back oversized, then returns the corrected reply", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    const corrected = "A short closing note within budget.";
    askGemini
      .mockResolvedValueOnce({ coach_note: oversized, session_closed: true, reply: "ok" })
      .mockResolvedValueOnce({ coach_note: corrected, session_closed: true, reply: "ok" });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.coach_note).toBe(corrected);
  });

  it("does not reprompt a second time if the reprompt also comes back oversized, but logs it", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    askGemini
      .mockResolvedValueOnce({ coach_note: oversized, session_closed: true, reply: "ok" })
      .mockResolvedValueOnce({ coach_note: oversized, session_closed: true, reply: "ok" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.coach_note).toBe(oversized);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still over its text cap after reprompt, capText will truncate it:",
      expect.objectContaining({ field: "coach_note" }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when the reply is already within every cap", async () => {
    askGemini.mockResolvedValueOnce({
      coach_note: "Fine.",
      session_closed: true,
      reply: "ok",
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});
