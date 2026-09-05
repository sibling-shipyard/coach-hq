/**
 * OpenRouter adapter — Gemini reached through OpenRouter's provider routing, selected only when
 * `LLM_PROVIDER=openrouter`. Pinned to `google-vertex`, never AI Studio: the account requires ZDR
 * and AI Studio endpoints are excluded by it (verified live, see #713's readiness gate in
 * docs/plans/chat-openrouter-migration.md). Named without a `~` alias — a floating alias exposes
 * no endpoint list, so a provider allow-list cannot be pinned to one.
 *
 * `reasoning: {enabled: false}` returns a 400 on this model; `{effort: "low"}` is what gets 0
 * reasoning tokens instead (verified live).
 */
import { fetchWithTimeout } from "../httpTimeout.js";
import { withGeminiSpan } from "../sentry.js";
import type { LlmAdapter, LlmRequest, LlmResult } from "../llmClient.js";

export const OPENROUTER_MODEL = "google/gemini-3.8-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 45_000;

interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  provider?: string;
  model?: string;
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
                messages: [{ role: "user", content: request.prompt }],
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
                provider: {
                  only: ["google-vertex"],
                  require_parameters: true,
                  data_collection: "deny",
                },
              }),
            },
            OPENROUTER_TIMEOUT_MS,
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
            completionTokens: payload.usage?.completion_tokens,
            totalTokens: payload.usage?.total_tokens,
            thinkingTokens: payload.usage?.completion_tokens_details?.reasoning_tokens,
            resolvedProvider,
            resolvedModel,
          });
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
