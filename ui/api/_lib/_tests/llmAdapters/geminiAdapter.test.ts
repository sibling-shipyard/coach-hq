/**
 * The Gemini adapter's HTTP boundary: header auth, the schema/token-budget shape Gemini's
 * `generateContent` wants, and the #827 MAX_TOKENS guard, now exercised through `LlmAdapter`
 * rather than a coach-message-specific function.
 */
import { describe, expect, it, vi } from "vitest";
import { createGeminiAdapter } from "../../llmAdapters/geminiAdapter.js";
import type { LlmRequest } from "../../llmClient.js";

const REQUEST: LlmRequest = {
  prompt: "prompt",
  maxOutputTokens: 3_072,
  responseSchema: {
    name: "proactive",
    schema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
      additionalProperties: false,
    },
  },
};

function okResponse(body: string) {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ body }) }] } }],
  });
}

describe("createGeminiAdapter", () => {
  it("authenticates with the x-goog-api-key header, not a URL query param", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent",
      );
      expect(url).not.toContain("key=");
      expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
      return okResponse("That looked controlled.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(REQUEST);
    expect(result.text).toBe(JSON.stringify({ body: "That looked controlled." }));
    expect(result.telemetry).toEqual({ adapter: "gemini", model: "gemini-pro-latest" });
  });

  it("strips additionalProperties before sending Gemini's own responseSchema shape", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseSchema).toEqual({
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
      });
      expect(body.generationConfig.maxOutputTokens).toBe(3_072);
      return okResponse("That looked controlled.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(REQUEST);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("surfaces a truncated MAX_TOKENS response as a specific failure, not a generic parse error", async () => {
    // Reproduces the #827 shape: thinking ate the whole budget, so content is a truncated
    // fragment that is not valid JSON.
    const fetcher = vi.fn(async () =>
      Response.json({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: "Here is the JSON requested:" }] },
          },
        ],
        usageMetadata: { thoughtsTokenCount: 1_680, candidatesTokenCount: 8 },
      }),
    );
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toThrow(/MAX_TOKENS.*thinkingTokens=1680/);
  });

  it("rejects when GEMINI_API_KEY is unset, before making a request", async () => {
    const fetcher = vi.fn();
    const adapter = createGeminiAdapter({} as NodeJS.ProcessEnv, fetcher);
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 500 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to a 429 or 502, matching Gemini's own status", async () => {
    const fetcher = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 429 });
  });
});
