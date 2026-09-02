import { beforeEach, describe, expect, it, vi } from "vitest";

const { askGemini } = vi.hoisted(() => ({ askGemini: vi.fn() }));
vi.mock("../../_lib/geminiClient.js", () => ({ askGemini, GEMINI_MODEL: "gemini-flash-latest" }));

import { requestCoachReply } from "../../_lib/coachTurn.js";
import { COACH_LOG_TEXT_CAP } from "../../_lib/text-caps.bundle.js";

function baseTurnState(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "how's my week looking",
    geminiMessage: "how's my week looking",
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
    now: Date.now(),
    traceId: "trace-1",
    ...overrides,
  } as unknown as Parameters<typeof requestCoachReply>[0];
}

// No mode ever requests coach_note from Gemini (see coachReplySchema.ts), so it can't exercise
// the reprompt below. The reprompt is generic across every capped free-text field regardless, so
// memory_update.text stands in for it here instead.
describe("requestCoachReply text-cap reprompt (issue #462, layer 2)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts exactly once when a capped field comes back oversized, then returns the corrected reply", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    const corrected = "A short note within budget.";
    askGemini
      .mockResolvedValueOnce({ memory_update: { label: "baseline", text: oversized }, reply: "ok" })
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: corrected },
        reply: "ok",
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.memory_update?.text).toBe(corrected);
  });

  it("does not reprompt a second time if the reprompt also comes back oversized, but logs it", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    askGemini
      .mockResolvedValueOnce({ memory_update: { label: "baseline", text: oversized }, reply: "ok" })
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: oversized },
        reply: "ok",
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.memory_update?.text).toBe(oversized);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still over its text cap after reprompt, capText will truncate it:",
      expect.objectContaining({ field: "memory_update.text" }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when the reply is already within every cap", async () => {
    askGemini.mockResolvedValueOnce({
      memory_update: { label: "baseline", text: "Fine." },
      reply: "ok",
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});
