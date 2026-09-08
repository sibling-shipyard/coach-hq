/**
 * OpenRouter adapter — Gemini reached through OpenRouter's provider routing, selected only when
 * `LLM_PROVIDER=openrouter`. Pinned to `google-vertex`, never AI Studio: the account requires ZDR
 * and AI Studio endpoints are excluded by it (verified live, see #713's readiness gate in
 * docs/plans/chat-openrouter-migration.md). Named without a `~` alias — a floating alias exposes
 * no endpoint list, so a provider allow-list cannot be pinned to one.
 *
 * `reasoning: {enabled: false}` returns a 400 on this model; `{effort: "low"}` is what gets 0
 * reasoning tokens instead (verified live, 3/3 at `max_tokens: 1024`). Give it too small a budget
 * and reasoning eats the whole thing: at 64 it came back `finish_reason: "length"` with null
 * content, which is the truncation branch below.
 *
 * The response cannot confirm the pin. OpenRouter reports `provider: "Google"` and echoes the slug
 * it was asked for, so `gen_ai.response.provider` reads the same whether the request pinned Vertex
 * or not (observed 2026-09-05, 4 runs). ZDR rests on this request body and the account setting —
 * do not read a span as proof of it.
 */
import { fetchWithTimeout } from "../httpTimeout.js";
import { withGeminiSpan } from "../sentry.js";
import type { LlmAdapter, LlmRequest, LlmResult } from "../llmClient.js";

export const OPENROUTER_MODEL = "google/gemini-3.8-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  // OpenRouter reports an upstream refusal, a moderation block or a provider outage as HTTP 200
  // with this object and no `choices` at all — the transport succeeded, the generation did not.
  error?: { code?: number | string; message?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    // Both populated only when the request sends `usage: {include: true}` — the readiness gate's
    // finding that `/api/v1/generation` 404s under this account's `data_collection: "deny"`
    // (docs/eng-docs/chat-provider-bench.md § Gotchas). `cost` is USD for the whole call.
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  provider?: string;
  model?: string;
}

/**
 * OpenRouter's `completion_tokens` counts reasoning tokens; Gemini's `candidatesTokenCount` does
 * not. Both feed `gen_ai.usage.output_tokens`, so without this the same attribute would mean two
 * different things and any cross-provider comparison would be wrong by exactly the reasoning
 * count. Subtracting leaves visible output on both sides, with reasoning still reported on its
 * own as `thinkingTokens`. `total_tokens` stays inclusive, which both providers already agree on.
 *
 * Measured 2026-09-05, `reasoning: {effort: "high"}`: completion 372, reasoning 332, and a
 * 176-character reply — 372 - 332 = the 40 tokens actually shown to the athlete.
 */
export function visibleOutputTokens(usage: OpenRouterResponse["usage"]): number | undefined {
  const completion = usage?.completion_tokens;
  if (completion === undefined) return undefined;
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  // Never negative: a provider that reports these inconsistently must not produce a nonsense span.
  return Math.max(completion - reasoning, 0);
}

/**
 * `prompt_tokens_details.cached_tokens` only arrives when the request sends `usage: {include:
 * true}`. Passed through undefined-safe on purpose: absent and zero are different facts on the
 * wire — absent means the field never arrived (caching status unknown), zero means it arrived
 * and reported no cached prefix (a real cache miss, e.g. #713's finding that a varying athlete
 * block never earns Vertex's exact-repeat discount). `usageAttributes` (sentry.ts) already omits
 * `undefined` rather than sending a false zero, so this must not collapse the two either.
 */
export function cachedPromptTokens(usage: OpenRouterResponse["usage"]): number | undefined {
  return usage?.prompt_tokens_details?.cached_tokens;
}

/**
 * `LlmMessage.role` speaks Gemini's vocabulary (`"user"` | `"model"`) since callers build one
 * request shape for both providers. OpenAI-style chat completions calls the same turn
 * `"assistant"`, and puts a system turn ahead of the conversation as its own message rather than
 * a separate top-level field. Empty `system` is omitted rather than sent as an empty message — a
 * caller with no system/user split (coach-message) gets the exact wire shape it always sent: one
 * user message, nothing else.
 */
export function toOpenRouterMessages(
  request: Pick<LlmRequest, "system" | "messages">,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const turns = request.messages.map((message) => ({
    role: message.role === "model" ? ("assistant" as const) : ("user" as const),
    content: message.text,
  }));
  return request.system ? [{ role: "system" as const, content: request.system }, ...turns] : turns;
}

export function createOpenRouterAdapter(
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): LlmAdapter {
  const apiKey = env.OPENROUTER_API_KEY;
  return {
    name: "openrouter",
    model: OPENROUTER_MODEL,
    async generate(request: LlmRequest): Promise<LlmResult> {
      if (!apiKey) {
        throw Object.assign(new Error("Coach message generation is not configured"), {
          status: 500,
        });
      }
      let resolvedProvider: string | undefined;
      let resolvedModel: string | undefined;
      const text = await withGeminiSpan(
        OPENROUTER_MODEL,
        async (recordUsage) => {
          const response = await fetcher(
            OPENROUTER_URL,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: OPENROUTER_MODEL,
                messages: toOpenRouterMessages(request),
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: request.responseSchema.name,
                    strict: true,
                    schema: request.responseSchema.schema,
                  },
                },
                max_tokens: request.maxOutputTokens,
                reasoning: { effort: "low" },
                // Without this OpenRouter omits `cost` and `prompt_tokens_details.cached_tokens`
                // from the response, and the generation-stats endpoint that would otherwise carry
                // cost 404s under this account's `data_collection: "deny"` (#889, bench doc).
                usage: { include: true },
                provider: {
                  only: ["google-vertex"],
                  require_parameters: true,
                  data_collection: "deny",
                },
              }),
            },
            request.timeoutMs,
          );
          if (!response.ok) {
            const detail = await response.text();
            throw Object.assign(
              new Error(`OpenRouter request failed (${response.status}): ${detail}`),
              { status: response.status === 429 ? 429 : 502 },
            );
          }
          const payload = (await response.json()) as OpenRouterResponse;
          resolvedProvider = payload.provider;
          resolvedModel = payload.model;
          // Recorded even when `usage` is absent — the resolved provider/model is the whole
          // point of provider routing and must reach the span regardless (locked decision).
          recordUsage({
            promptTokens: payload.usage?.prompt_tokens,
            completionTokens: visibleOutputTokens(payload.usage),
            totalTokens: payload.usage?.total_tokens,
            cachedPromptTokens: cachedPromptTokens(payload.usage),
            thinkingTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
            costUsd: payload.usage?.cost,
            resolvedProvider,
            resolvedModel,
          });
          if (payload.error) {
            // Carry OpenRouter's own code and message through. Without them a 200-with-error is
            // indistinguishable from an empty reply, and Sentry records a failure with no cause.
            const code = payload.error.code ?? "no code";
            const detail = payload.error.message ?? "no message";
            throw Object.assign(
              new Error(`OpenRouter returned an error with HTTP 200 (${code}): ${detail}`),
              { status: 502 },
            );
          }
          if (!payload.choices?.length) {
            // Distinct from the empty-content case below: no choice was produced at all, and
            // OpenRouter said nothing about why.
            throw Object.assign(new Error("OpenRouter returned no choices and no error"), {
              status: 502,
            });
          }
          const finishReason = payload.choices?.[0]?.finish_reason;
          if (finishReason === "length") {
            // OpenRouter's truncation signal, the equivalent of Gemini's MAX_TOKENS guard (#827).
            throw Object.assign(
              new Error(
                `OpenRouter truncated its response before finishing (finish=length, reasoningTokens=${payload.usage?.completion_tokens_details?.reasoning_tokens ?? "unknown"})`,
              ),
              { status: 502 },
            );
          }
          const responseText = payload.choices?.[0]?.message?.content;
          if (!responseText) {
            throw Object.assign(new Error("OpenRouter returned no content"), { status: 502 });
          }
          return responseText;
        },
        { "llm.adapter": "openrouter", "gen_ai.system": "openrouter" },
      );
      return {
        text,
        telemetry: {
          adapter: "openrouter",
          model: OPENROUTER_MODEL,
          resolvedProvider,
          resolvedModel,
        },
      };
    },
  };
}
