/**
 * Direct Gemini adapter - the path production selects when `LLM_PROVIDER` is unset or "gemini".
 * Header auth (`x-goog-api-key`), not the URL query param the old single call site used: #638
 * (PR 823) was rewriting that same call site to header auth when this replaced it outright, so
 * there is nothing to retrofit onto (see the PR body for the pointer if 823 lands later).
 *
 * Keeps everything #827 established, now caller-supplied per request rather than hardcoded here:
 * the measured output-token ceiling, the `finishReason === "MAX_TOKENS"` guard, and thinking
 * tokens reaching the usage span.
 *
 * #713 M2 PR 2 moves coach-chat's explicit soul cache and its retry logic in here from
 * `coach-chat/_lib/gemini/geminiClient.ts` (docs/plans/openrouter-m2-chat-lld.md). Both are gated
 * on `request.cachePrefix` being set, not on whether the cache lookup actually succeeds - that's
 * the signal that this is a chat-shaped request at all, and it's what keeps coach-message (which
 * never sets `cachePrefix`) on its exact pre-#713 behavior: one call, no retry.
 */
import { GEMINI_MODEL } from "../geminiModel.js";
import { fetchWithTimeout } from "../httpTimeout.js";
import { withGeminiSpan } from "../sentry.js";
import type { LlmAdapter, LlmJsonSchemaNode, LlmRequest, LlmResult } from "../llmClient.js";
import { getCachedSoulName, invalidateCachedSoulName } from "./geminiSoulCache.js";

type GeminiSchemaNode =
  | { type: "string"; enum?: readonly string[]; maxLength?: number }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: GeminiSchemaNode }
  | { type: "object"; properties: Record<string, GeminiSchemaNode>; required?: readonly string[] };

/**
 * Gemini's own `responseSchema` has no `additionalProperties` field, at any nesting level -
 * unlike OpenRouter's strict `json_schema`, which requires it on every object node
 * (`LlmJsonSchemaNode`, `llmClient.ts`). A shallow strip at the top level was enough for
 * coach-message's flat one-property schema (#713 M2 PR 1); chat's schema nests up to five levels
 * deep (`coachReplySchema.ts`'s `week_plan`/`season_start`), and Gemini rejects the field wherever
 * it survives, naming the exact nested path in its 400 (confirmed live, #713 M2 PR 2). Recurse.
 */
function toGeminiResponseSchema(node: LlmJsonSchemaNode): GeminiSchemaNode {
  if (node.type === "array") return { type: "array", items: toGeminiResponseSchema(node.items) };
  if (node.type !== "object") return node;
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(node.properties).map(([key, value]) => [key, toGeminiResponseSchema(value)]),
    ),
    ...(node.required ? { required: node.required } : {}),
  };
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// A cache-active request cannot carry `systemInstruction` alongside `cachedContent` (Gemini
// rejects both together) - `request.system` moves into `contents` instead, as a synthetic
// user/model exchange ahead of real history. This wrapper is what tells the model that turn
// carries the same binding authority as a system instruction would. `request.system` itself
// carries no cache-awareness of its own - callers build one dynamic-text shape regardless of
// whether a cache ends up active, and this file is the only place that wraps it differently.
const CACHE_ACTIVE_SYSTEM_WRAPPER =
  "[SYSTEM CONTEXT - not a message from the athlete. Everything below carries the same binding " +
  "authority as your system instructions above: follow every directive in it exactly, even " +
  "though it arrives as a turn rather than a system field.]";
const CACHE_ACTIVE_ACK =
  "Understood - I'll follow those instructions exactly, same as my system instructions.";

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
    cachedContentTokenCount?: number;
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

      // `cachedName` truthy means this call actually carries `cachedContent`; `request.cachePrefix`
      // being set (regardless of whether the lookup above succeeded) is the broader "this is a
      // chat-shaped request" signal that gates the retry branches below.
      const buildBody = (cachedName: string | null) => ({
        ...(cachedName
          ? { cachedContent: cachedName }
          : request.system || request.cachePrefix
            ? {
                systemInstruction: {
                  parts: [
                    {
                      // Same concatenation as pre-#713's cache-inactive path: static prefix,
                      // then dynamic system text, one newline apart.
                      text: request.cachePrefix
                        ? `${request.cachePrefix}\n${request.system}`
                        : request.system,
                    },
                  ],
                },
              }
            : {}),
        contents: cachedName
          ? [
              {
                role: "user",
                parts: [{ text: `${CACHE_ACTIVE_SYSTEM_WRAPPER}\n${request.system}` }],
              },
              { role: "model", parts: [{ text: CACHE_ACTIVE_ACK }] },
              ...request.messages.map((message) => ({
                role: message.role,
                parts: [{ text: message.text }],
              })),
            ]
          : request.messages.map((message) => ({
              role: message.role,
              parts: [{ text: message.text }],
            })),
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiResponseSchema({
            type: "object",
            properties: request.responseSchema.schema.properties,
            required: request.responseSchema.schema.required,
            additionalProperties: false,
          }),
          maxOutputTokens: request.maxOutputTokens,
        },
      });

      const callGemini = (cachedName: string | null): Promise<Response> =>
        fetcher(
          `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(buildBody(cachedName)),
          },
          request.timeoutMs,
        ).catch((err) => {
          // fetchWithTimeout throws a 504-tagged Error on its own abort rather than resolving a
          // Response - convert it so the retry branch below can treat a timeout like a real 504.
          const status = (err as { status?: number }).status;
          if (status === 504) return new Response(null, { status: 504 });
          throw err;
        });

      const text = await withGeminiSpan(
        GEMINI_MODEL,
        async (recordUsage) => {
          let cachedName: string | null = null;
          if (request.cachePrefix) {
            cachedName = await getCachedSoulName(apiKey, GEMINI_MODEL, request.cachePrefix).catch(
              () => null,
            );
          }
          let response = await callGemini(cachedName);
          // Capped at one retry total (if/else if) - chaining two full-budget calls risks
          // blowing through vercel.json's maxDuration. Both branches are gated on
          // `request.cachePrefix`, not just on `cachedName`, so a caller with no cache prefix
          // (coach-message) never retries - exactly its pre-#713 behavior.
          if (request.cachePrefix) {
            if (cachedName && response.status === 400) {
              // A stale/invalid cachedContent name shows up here as a 400 - retry once as
              // plain no-cache and drop the bad record so the next request doesn't repeat the
              // round-trip.
              invalidateCachedSoulName().catch(() => {});
              cachedName = null;
              response = await callGemini(cachedName);
            } else if (response.status === 504 || response.status === 503) {
              // A timeout (504) or Gemini overload (503) is transient - retry once with a
              // short fixed backoff. Unreachable alongside the 400 branch above.
              await new Promise((resolve) => setTimeout(resolve, 500));
              response = await callGemini(cachedName);
            }
          }

          if (!response.ok) {
            const detail = await response.text();
            // The real upstream status always passes through - coach-chat's
            // friendlyGeminiErrorMessage (coachTurn.ts) branches on 429/503/504 specifically to
            // tell a rate limit from a timeout from a generic failure, pre-#713 behavior this
            // adapter must not collapse now that chat shares it. Collapsing everything else
            // (400/403/500) to a generic 502 was a real regression found in review: the athlete
            // saw the wrong message and callers lost the ability to distinguish a bad request
            // from a real server error.
            throw Object.assign(
              new Error(`Gemini request failed (${response.status}): ${detail}`),
              {
                status: response.status,
              },
            );
          }
          const payload = (await response.json()) as GeminiGenerateResponse;
          if (payload.usageMetadata) {
            recordUsage({
              promptTokens: payload.usageMetadata.promptTokenCount,
              completionTokens: payload.usageMetadata.candidatesTokenCount,
              totalTokens: payload.usageMetadata.totalTokenCount,
              cachedPromptTokens: payload.usageMetadata.cachedContentTokenCount,
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
