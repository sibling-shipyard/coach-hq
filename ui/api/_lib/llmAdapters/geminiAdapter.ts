/**
 * Direct Gemini adapter — the path production selects when `LLM_PROVIDER` is unset or "gemini".
 * Header auth (`x-goog-api-key`), not the URL query param the old single call site used: #638
 * (PR 823) was rewriting that same call site to header auth when this replaced it outright, so
 * there is nothing to retrofit onto (see the PR body for the pointer if 823 lands later).
 *
 * Keeps everything #827 established, now caller-supplied per request rather than hardcoded here:
 * the measured output-token ceiling, the `finishReason === "MAX_TOKENS"` guard, and thinking
 * tokens reaching the usage span.
 */
import { GEMINI_MODEL } from "../geminiModel.js";
import { fetchWithTimeout } from "../httpTimeout.js";
import { withGeminiSpan } from "../sentry.js";
import type { LlmAdapter, LlmRequest, LlmResult } from "../llmClient.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_GENERATE_TIMEOUT_MS = 45_000;

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
  };
}

export function createGeminiAdapter(
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): LlmAdapter {
  const apiKey = env.GEMINI_API_KEY;
  return {
    name: "gemini",
    model: GEMINI_MODEL,
    async generate(request: LlmRequest): Promise<LlmResult> {
      if (!apiKey) {
        throw Object.assign(new Error("Coach message generation is not configured"), {
          status: 500,
        });
      }
      const text = await withGeminiSpan(
        GEMINI_MODEL,
        async (recordUsage) => {
          const response = await fetcher(
            `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: request.prompt }] }],
                generationConfig: {
                  responseMimeType: "application/json",
                  // Gemini's responseSchema has no additionalProperties field — OpenRouter's
                  // strict json_schema needs one, Gemini rejects fields it doesn't recognize, so
                  // only the three fields it understands cross over.
                  responseSchema: {
                    type: request.responseSchema.schema.type,
                    properties: request.responseSchema.schema.properties,
                    required: request.responseSchema.schema.required,
                  },
                  maxOutputTokens: request.maxOutputTokens,
                },
              }),
            },
            GEMINI_GENERATE_TIMEOUT_MS,
          );
          if (!response.ok) {
            const detail = await response.text();
            throw Object.assign(
              new Error(`Gemini request failed (${response.status}): ${detail}`),
              { status: response.status === 429 ? 429 : 502 },
            );
          }
          const payload = (await response.json()) as GeminiGenerateResponse;
          if (payload.usageMetadata) {
            recordUsage({
              promptTokens: payload.usageMetadata.promptTokenCount,
              completionTokens: payload.usageMetadata.candidatesTokenCount,
              totalTokens: payload.usageMetadata.totalTokenCount,
              thinkingTokens: payload.usageMetadata.thoughtsTokenCount,
            });
          }
          const finishReason = payload.candidates?.[0]?.finishReason;
          if (finishReason === "MAX_TOKENS") {
            // Distinguish from a generic parse failure: this is a budget problem, not a
            // malformed response, and the thinking token count says whether the caller's
            // maxOutputTokens needs to grow again (#827).
            throw Object.assign(
              new Error(
                `Gemini truncated its response before finishing (MAX_TOKENS, thinkingTokens=${payload.usageMetadata?.thoughtsTokenCount ?? "unknown"})`,
              ),
              { status: 502 },
            );
          }
          const responseText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!responseText) {
            throw Object.assign(new Error("Gemini returned no content"), { status: 502 });
          }
          return responseText;
        },
        { "llm.adapter": "gemini" },
      );
      return { text, telemetry: { adapter: "gemini", model: GEMINI_MODEL } };
    },
  };
}
