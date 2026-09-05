/**
 * The OpenRouter adapter's HTTP boundary: the verified request shape (provider allow-list,
 * `reasoning: {effort: "low"}`, strict json_schema), and that the resolved provider/model reach
 * the caller — the whole point of provider routing (docs/plans/chat-openrouter-migration.md).
 */
import { describe, expect, it, vi } from "vitest";
import { createOpenRouterAdapter, OPENROUTER_MODEL } from "../../llmAdapters/openRouterAdapter.js";
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
    provider: "google-vertex",
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
    const fetcher = vi.fn(async () =>
      okResponse({ provider: "google-vertex", model: "vertex/gemini-3.8-flash-001" }),
    );
    const adapter = createOpenRouterAdapter(
      { OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
      fetcher,
    );
    const result = await adapter.generate(REQUEST);
    expect(result.telemetry).toEqual({
      adapter: "openrouter",
      model: "google/gemini-3.8-flash",
      resolvedProvider: "google-vertex",
      resolvedModel: "vertex/gemini-3.8-flash-001",
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

  it("rejects when OPENROUTER_API_KEY is unset, before making a request", async () => {
    const fetcher = vi.fn();
    const adapter = createOpenRouterAdapter({} as NodeJS.ProcessEnv, fetcher);
    await expect(adapter.generate(REQUEST)).rejects.toMatchObject({ status: 500 });
    expect(fetcher).not.toHaveBeenCalled();
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
