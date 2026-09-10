/**
 * The Gemini adapter's HTTP boundary: header auth, the schema/token-budget shape Gemini's
 * `generateContent` wants, and the #827 MAX_TOKENS guard, now exercised through `LlmAdapter`
 * rather than a coach-message-specific function.
 *
 * #713 M2 PR 2 adds `cachePrefix` (its cache-active/cache-inactive/retry branches, below) - the
 * explicit soul cache itself (`getCachedSoulName`/`invalidateCachedSoulName`) is mocked at the
 * module level rather than through `fetcher`, since it calls `fetchWithTimeout` directly, not the
 * fetcher this adapter's `generate()` uses for its own `generateContent` call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGeminiAdapter } from "../../llmAdapters/geminiAdapter.js";
import type { LlmRequest } from "../../llmClient.js";

const { getCachedSoulName, invalidateCachedSoulName } = vi.hoisted(() => ({
  getCachedSoulName: vi.fn(),
  invalidateCachedSoulName: vi.fn(),
}));
vi.mock("../../llmAdapters/geminiSoulCache.js", () => ({
  getCachedSoulName,
  invalidateCachedSoulName,
}));

const REQUEST: LlmRequest = {
  system: "",
  messages: [{ role: "user", text: "prompt" }],
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
  timeoutMs: 45_000,
};

function okResponse(body: string) {
  return Response.json({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ body }) }] } }],
  });
}

describe("createGeminiAdapter", () => {
  beforeEach(() => {
    // Default: no cachePrefix in most tests below means these should never even be called -
    // a resolved value here would only matter for the "cachePrefix (#713 M2 PR 2)" describe block.
    getCachedSoulName.mockReset();
    invalidateCachedSoulName.mockReset().mockResolvedValue(undefined);
  });

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

  it("strips additionalProperties at every nesting level, not just the top (#713 M2 PR 2)", async () => {
    // Regression: a shallow top-level-only strip passed this file's other test (a flat,
    // one-property schema, coach-message's real shape) but sent a nested `additionalProperties`
    // straight through to Gemini on a schema this deep - confirmed live, Gemini's 400 named the
    // exact nested path (generation_config.response_schema.properties[...].value...items). Chat's
    // real schema nests this deep (coachReplySchema.ts's week_plan/season_start).
    const nestedRequest: LlmRequest = {
      ...REQUEST,
      responseSchema: {
        name: "coach_reply",
        schema: {
          type: "object",
          properties: {
            week_plan: {
              type: "object",
              properties: {
                days: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { date: { type: "string" } },
                    required: ["date"],
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
    };
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain(
        "additionalProperties",
      );
      expect(body.generationConfig.responseSchema).toEqual({
        type: "object",
        properties: {
          week_plan: {
            type: "object",
            properties: {
              days: {
                type: "array",
                items: {
                  type: "object",
                  properties: { date: { type: "string" } },
                  required: ["date"],
                },
              },
            },
          },
        },
        required: [],
      });
      return okResponse("fine");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(nestedRequest);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("omits systemInstruction and sends one user content block when system is empty (#713)", async () => {
    // coach-message has no natural system/user split — this must be the exact wire shape it
    // always sent: no systemInstruction field at all, one user content block.
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("systemInstruction");
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "prompt" }] }]);
      return okResponse("That looked controlled.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(REQUEST);
  });

  it("maps a non-empty system plus multi-turn messages to systemInstruction/contents (#713)", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.systemInstruction).toEqual({ parts: [{ text: "You are Coach." }] });
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "How was my run?" }] },
        { role: "model", parts: [{ text: "Solid effort." }] },
        { role: "user", parts: [{ text: "Thanks." }] },
      ]);
      return okResponse("That looked controlled.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate({
      ...REQUEST,
      system: "You are Coach.",
      messages: [
        { role: "user", text: "How was my run?" },
        { role: "model", text: "Solid effort." },
        { role: "user", text: "Thanks." },
      ],
    });
  });

  it("threads request.timeoutMs through to fetchWithTimeout, not a hardcoded constant (#713)", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit, timeoutMs?: number) => {
      expect(timeoutMs).toBe(12_345);
      return okResponse("That looked controlled.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate({ ...REQUEST, timeoutMs: 12_345 });
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

  it("preserves a 503/504 upstream status rather than collapsing it to 502 (#713)", async () => {
    // coach-chat's friendlyGeminiErrorMessage (coachTurn.ts) branches on 503/504 specifically to
    // tell a timeout from a generic failure - this adapter must not flatten that distinction now
    // that chat shares it with coach-message.
    const fetcher = vi.fn(async () => new Response("overloaded", { status: 503 }));
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 503 });
  });

  it.each([400, 403, 500])(
    "preserves a %i upstream status too, not just 429/503/504 (review finding)",
    async (status) => {
      // Found in review: an earlier version of this adapter collapsed anything outside
      // {429,503,504} to a generic 502, losing the real upstream status pre-#713 code preserved
      // and showing the athlete the wrong message.
      const fetcher = vi.fn(async () => new Response("bad request", { status }));
      const adapter = createGeminiAdapter(
        { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
        fetcher,
      );
      await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status });
    },
  );
});

// #713 M2 PR 2: the explicit soul cache and its retry logic, moved here from coach-chat's
// geminiClient.ts. Gated on `request.cachePrefix` being set - a request with no cachePrefix
// (coach-message, tested above with REQUEST which carries none) must never call the cache at all
// and must never retry, exactly its pre-#713 behavior.
describe("createGeminiAdapter cachePrefix (#713 M2 PR 2)", () => {
  beforeEach(() => {
    getCachedSoulName.mockReset();
    invalidateCachedSoulName.mockReset().mockResolvedValue(undefined);
  });

  const CACHED_REQUEST: LlmRequest = {
    ...REQUEST,
    system: "ATHLETE STATE BLOCK",
    cachePrefix: "STABLE PERSONA PREFIX",
    messages: [{ role: "user", text: "How was my run?" }],
  };

  it("sends cachedContent and moves system into a synthetic user/model turn when the cache hits", async () => {
    getCachedSoulName.mockResolvedValue("cachedContents/abc123");
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.cachedContent).toBe("cachedContents/abc123");
      expect(body).not.toHaveProperty("systemInstruction");
      expect(body.contents[0]).toEqual({
        role: "user",
        parts: [{ text: expect.stringContaining("ATHLETE STATE BLOCK") }],
      });
      expect(body.contents[0].parts[0].text).toContain("[SYSTEM CONTEXT");
      expect(body.contents[1]).toEqual({
        role: "model",
        parts: [{ text: expect.stringContaining("Understood") }],
      });
      expect(body.contents[2]).toEqual({ role: "user", parts: [{ text: "How was my run?" }] });
      return okResponse("Solid effort.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(CACHED_REQUEST);
    expect(getCachedSoulName).toHaveBeenCalledWith(
      "test-key",
      "gemini-pro-latest",
      "STABLE PERSONA PREFIX",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("falls back to concatenating cachePrefix + system into systemInstruction when the cache misses", async () => {
    getCachedSoulName.mockResolvedValue(null);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("cachedContent");
      expect(body.systemInstruction).toEqual({
        parts: [{ text: "STABLE PERSONA PREFIX\nATHLETE STATE BLOCK" }],
      });
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: "How was my run?" }] }]);
      return okResponse("Solid effort.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(CACHED_REQUEST);
  });

  it("never looks up or invalidates the cache when cachePrefix is absent (coach-message shape)", async () => {
    const fetcher = vi.fn(async () => okResponse("fine"));
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await adapter.generate(REQUEST); // no cachePrefix
    expect(getCachedSoulName).not.toHaveBeenCalled();
    expect(invalidateCachedSoulName).not.toHaveBeenCalled();
  });

  it("retries once as no-cache when a cached-content name is rejected with 400, and invalidates it", async () => {
    getCachedSoulName.mockResolvedValue("cachedContents/stale");
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.cachedContent) return new Response("stale cache", { status: 400 });
      expect(body.systemInstruction.parts[0].text).toBe(
        "STABLE PERSONA PREFIX\nATHLETE STATE BLOCK",
      );
      return okResponse("Recovered without cache.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(CACHED_REQUEST);
    expect(result.text).toBe(JSON.stringify({ body: "Recovered without cache." }));
    expect(invalidateCachedSoulName).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries once with a fixed backoff on 503/504 when cachePrefix is set", async () => {
    getCachedSoulName.mockResolvedValue(null);
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response("overloaded", { status: 503 })
        : okResponse("Recovered after backoff.");
    });
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(CACHED_REQUEST);
    expect(result.text).toBe(JSON.stringify({ body: "Recovered after backoff." }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 503 when cachePrefix is absent (coach-message keeps its pre-#713 behavior)", async () => {
    const fetcher = vi.fn(async () => new Response("overloaded", { status: 503 }));
    const adapter = createGeminiAdapter(
      { GEMINI_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
