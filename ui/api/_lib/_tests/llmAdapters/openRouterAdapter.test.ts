/**
 * The OpenRouter adapter's HTTP boundary: the verified request shape (provider allow-list,
 * `reasoning: {effort: "low"}`, strict json_schema), and that the resolved provider/model reach
 * the caller — the whole point of provider routing (docs/plans/chat-openrouter-migration.md).
 */
import { describe, expect, it, vi } from "vitest";
import type { GeminiUsage } from "../../sentry.js";

/**
 * `withGeminiSpan` owns the `recordUsage` callback, so the only way to see what the adapter
 * actually hands the span is to stand in for it. The stand-in still runs the callback and
 * returns its value, so every other test in this file behaves exactly as it did against the
 * real one.
 */
const { withGeminiSpan, recordedUsage } = vi.hoisted(() => {
  const recordedUsage: GeminiUsage[] = [];
  return {
    recordedUsage,
    withGeminiSpan: vi.fn(
      async (
        _model: string,
        run: (record: (usage: GeminiUsage) => void) => Promise<string>,
        _attributes?: Record<string, string>,
      ) => run((usage) => void recordedUsage.push(usage)),
    ),
  };
});

vi.mock("../../sentry.js", () => ({ withGeminiSpan }));

import {
  cachedPromptTokens,
  createOpenRouterAdapter,
  OPENROUTER_MODEL,
  visibleOutputTokens,
} from "../../llmAdapters/openRouterAdapter.js";
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

function okResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify({ body: "That looked controlled." }) } }],
    usage: {
      prompt_tokens: 6_924,
      completion_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
    // Observed live on 2026-09-05 with `only: ["google-vertex"]` pinned, 4 runs: OpenRouter names
    // the provider `Google` and echoes the slug we asked for. It does not report a Vertex-specific
    // provider or model, so these strings cannot confirm the ZDR pin held — the request body does.
    provider: "Google",
    model: OPENROUTER_MODEL,
    ...overrides,
  });
}

describe("createOpenRouterAdapter", () => {
  it("sends the verified request shape: provider allow-list, low reasoning, strict schema", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("google/gemini-3.8-flash");
      expect(body.messages).toEqual([{ role: "user", content: "prompt" }]);
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(body.max_tokens).toBe(3_072);
      // Without this OpenRouter omits `cost` and `prompt_tokens_details.cached_tokens` from the
      // response — the generation-stats endpoint that would otherwise carry cost 404s under this
      // account's `data_collection: "deny"` (#889).
      expect(body.usage).toEqual({ include: true });
      expect(body.provider).toEqual({
        only: ["google-vertex"],
        require_parameters: true,
        data_collection: "deny",
      });
      expect(body.response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "proactive",
          strict: true,
          schema: REQUEST.responseSchema.schema,
        },
      });
      return okResponse();
    });
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(REQUEST);
    expect(result.text).toBe(JSON.stringify({ body: "That looked controlled." }));
  });

  it("carries OpenRouter's resolved provider and model back to the caller", async () => {
    const fetcher = vi.fn(async () => okResponse());
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(REQUEST);
    expect(result.telemetry).toEqual({
      adapter: "openrouter",
      model: "google/gemini-3.8-flash",
      resolvedProvider: "Google",
      resolvedModel: "google/gemini-3.8-flash",
    });
  });

  it("surfaces a length-truncated response as a specific failure", async () => {
    const fetcher = vi.fn(async () =>
      okResponse({
        choices: [{ finish_reason: "length", message: { content: "trunc" } }],
      }),
    );
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toThrow(/finish=length/);
  });

  it("surfaces OpenRouter's own code and message when a 200 carries an error (#852)", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code: 429, message: "Provider returned error" } }),
    );
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toThrow(
      /HTTP 200 \(429\): Provider returned error/,
    );
  });

  it("reports a 200 with neither choices nor an error as its own case (#852)", async () => {
    const fetcher = vi.fn(async () => Response.json({ provider: "Google" }));
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toThrow(/no choices and no error/);
  });

  it("reports visible output tokens, not OpenRouter's reasoning-inclusive count (#853)", () => {
    // The live shape: completion 372 = 40 shown to the athlete + 332 reasoning (2026-09-05).
    expect(
      visibleOutputTokens({
        completion_tokens: 372,
        completion_tokens_details: { reasoning_tokens: 332 },
      }),
    ).toBe(40);
    // No reasoning reported is the common case on `effort: "low"` and must pass through unchanged.
    expect(visibleOutputTokens({ completion_tokens: 40 })).toBe(40);
    // Absent usage stays absent — `usageAttributes` omits it rather than sending a zero.
    expect(visibleOutputTokens(undefined)).toBeUndefined();
    // A provider reporting more reasoning than completion must not yield a negative span value.
    expect(
      visibleOutputTokens({
        completion_tokens: 10,
        completion_tokens_details: { reasoning_tokens: 99 },
      }),
    ).toBe(0);
  });

  it("passes prompt_tokens_details.cached_tokens through, absent and zero kept distinct (#889)", () => {
    // Present: the exact-repeat discount landed.
    expect(cachedPromptTokens({ prompt_tokens_details: { cached_tokens: 8_169 } })).toBe(8_169);
    // Absent: the field never arrived — usage: {include: true} wasn't honored, or the provider
    // doesn't report caching. Must stay undefined so the span omits it rather than sending a
    // false zero (usageAttributes filters undefined, not zero).
    expect(cachedPromptTokens({ prompt_tokens_details: {} })).toBeUndefined();
    expect(cachedPromptTokens(undefined)).toBeUndefined();
    // Zero: the field arrived and reported a real cache miss (#713 — a varying athlete block
    // never earns Vertex's exact-repeat discount). Distinct from absent above.
    expect(cachedPromptTokens({ prompt_tokens_details: { cached_tokens: 0 } })).toBe(0);
  });

  it("rejects when OPENROUTER_API_KEY is unset, before making a request", async () => {
    const fetcher = vi.fn();
    const adapter = createOpenRouterAdapter({} as NodeJS.ProcessEnv, fetcher);
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 500 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hands the span the cached-token count and the cost it read off the wire (#889)", async () => {
    // The two fields exist to be *seen*. Deleting both lines from the adapter's `recordUsage`
    // call left the whole api/ suite green (41 files, 552 tests) before this test existed: the
    // parser was covered and the span mapping was covered, but nothing joined them.
    recordedUsage.length = 0;
    const fetcher = vi.fn(async () =>
      okResponse({
        usage: {
          prompt_tokens: 12_226,
          completion_tokens: 40,
          completion_tokens_details: { reasoning_tokens: 0 },
          prompt_tokens_details: { cached_tokens: 8_169 },
          cost: 0.0102,
        },
      }),
    );
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );

    await adapter.generate(REQUEST);

    expect(recordedUsage).toHaveLength(1);
    expect(recordedUsage[0]).toMatchObject({
      promptTokens: 12_226,
      cachedPromptTokens: 8_169,
      costUsd: 0.0102,
    });
  });

  it("leaves cached tokens and cost off the span when the wire omits them (#889)", async () => {
    // A provider that reports no caching, or a request where `usage: {include: true}` was not
    // honored. Absent must stay absent: `usageAttributes` filters `undefined`, so a 0 here would
    // publish a false "no cache hit" instead of "we do not know".
    recordedUsage.length = 0;
    const fetcher = vi.fn(async () => okResponse());
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );

    await adapter.generate(REQUEST);

    expect(recordedUsage[0].cachedPromptTokens).toBeUndefined();
    expect(recordedUsage[0].costUsd).toBeUndefined();
  });

  it("maps a non-2xx response to a 429 or 502", async () => {
    const fetcher = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 429 });
  });
});
