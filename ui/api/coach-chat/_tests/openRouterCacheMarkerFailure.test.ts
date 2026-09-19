/**
 * If a provider rejects the content-array system message (the cache_control shape), the real
 * OpenRouter adapter throws on the 400. Both callers must hand that throw to captureLlmFailure,
 * because it is the only Sentry event a failed turn produces. Only the network edge and the
 * capture function are faked; the adapter, askLlm and both catch blocks are real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchWithTimeout, captureLlmFailure, getFileRaw } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  captureLlmFailure: vi.fn(async (_error: unknown, _details: unknown) => ({ sent: true })),
  getFileRaw: vi.fn(async () => null as string | null),
}));

vi.mock("../../_lib/httpTimeout.js", () => ({ fetchWithTimeout, UPSTREAM_TIMEOUT_MS: 25_000 }));
vi.mock("../../_lib/sentry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../_lib/sentry.js")>()),
  captureLlmFailure,
}));
vi.mock("../_lib/decide/coachChatFiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_lib/decide/coachChatFiles.js")>()),
  getFileRaw,
}));

import { createOpenRouterAdapter } from "../../_lib/llmAdapters/openRouterAdapter.js";
import { generateProactiveBody } from "../../coach-message/_lib/coachMessage.js";
import { requestCoachReply } from "../_lib/requestCoachReply.js";

const REJECTION = "provider rejected content array";

beforeEach(() => {
  captureLlmFailure.mockClear();
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockImplementation(async () => new Response(REJECTION, { status: 400 }));
  vi.stubEnv("LLM_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("OpenRouter 400 on the request reaches captureLlmFailure", () => {
  it("chat path: requestCoachReply captures with the OpenRouter model and a 502", async () => {
    const turn = {
      threadId: "thread-1",
      priorMessages: [],
      trimmed: "how's my week looking",
      athleteMessage: "how's my week looking",
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
      validQuestIds: new Set<string>(),
      validInjuryFlagIds: new Set<string>(),
    } as unknown as Parameters<typeof requestCoachReply>[0];

    const result = await requestCoachReply(turn);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(502);
    expect(captureLlmFailure).toHaveBeenCalledOnce();
    const [error, details] = captureLlmFailure.mock.calls[0]!;
    expect((error as Error).message).toContain(`OpenRouter request failed (400): ${REJECTION}`);
    expect(details).toMatchObject({
      model: "google/gemini-3.8-flash",
      upstreamStatus: 502,
      traceId: "trace-1",
    });
    // The content-array shape is what was actually sent.
    const body = JSON.parse(fetchWithTimeout.mock.calls[0]![1].body as string);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
  });

  it("coach-message path: generateProactiveBody captures and rethrows", async () => {
    const adapter = createOpenRouterAdapter({
      OPENROUTER_API_KEY: "test-key",
    } as NodeJS.ProcessEnv);

    await expect(generateProactiveBody(adapter, "prompt")).rejects.toMatchObject({ status: 502 });

    expect(captureLlmFailure).toHaveBeenCalledOnce();
    expect(captureLlmFailure.mock.calls[0]![1]).toMatchObject({
      model: "google/gemini-3.8-flash",
      upstreamStatus: 502,
      turnMode: "proactive_message",
    });
  });
});
