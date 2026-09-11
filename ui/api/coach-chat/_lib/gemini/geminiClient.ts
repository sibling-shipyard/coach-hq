/**
 * Builds a coach-chat turn's prompt and runs it through the seam (#713 M2 PR 2). Request
 * construction (static/dynamic split, history mapping, schema selection) lives here; the explicit
 * soul cache, the retry-on-400/503/504, and the actual HTTP call now live in
 * `_lib/llmAdapters/geminiAdapter.ts`, reached via `selectLlmAdapter` like every other caller
 * (docs/plans/openrouter-m2-chat-lld.md). `LLM_PROVIDER` stays unset/"gemini" in production
 * throughout M2 - this file never sets it, so nothing here flips a provider.
 */
import { selectLlmAdapter, type LlmMessage } from "../../../_lib/llmClient.js";
import { log } from "../../../_lib/log.js";
import { GEMINI_MODEL } from "../../../_lib/geminiModel.js";
import type { ChatMessage } from "../chatThreads.js";
import { buildDynamicText, buildHistoryContents, staticSystemText } from "./coachPromptText.js";
import {
  chatResponseSchema,
  CHAT_MAX_OUTPUT_TOKENS,
  type AthleteReferenceIds,
  type GeminiReply,
  type TurnMode,
} from "./coachReplySchema.js";

export { GEMINI_MODEL };

// A turn with a long conversation history carries a larger prompt than the shared
// UPSTREAM_TIMEOUT_MS (25s, sized for file reads) can comfortably fit - give generateContent its
// own longer budget. Matches pre-#713's GEMINI_GENERATE_TIMEOUT_MS.
const GEMINI_GENERATE_TIMEOUT_MS = 45_000;

export async function askGemini(
  apiKey: string,
  soul: string,
  athleteContext: string,
  questLog: string,
  history: ChatMessage[],
  userMessage: string,
  mode: TurnMode,
  firstSession: boolean,
  extraContext?: string,
  traceId?: string,
  timezone = "UTC",
  referenceIds?: AthleteReferenceIds,
): Promise<GeminiReply> {
  // Ordered for implicit-caching fallback: stable content (persona, instructions, few-shots)
  // first, volatile today's-date last. See docs/eng-docs/gemini-flow.md. `cachePrefix` carries
  // this to the seam; the Gemini adapter decides whether it's actually cached this call.
  const cachePrefix = staticSystemText(soul);
  const system = buildDynamicText(
    athleteContext,
    questLog,
    mode,
    firstSession,
    extraContext,
    timezone,
  );
  const finalTurn: LlmMessage = {
    role: "user",
    text: mode === "greeting" ? "[Begin the conversation.]" : userMessage,
  };
  const messages: LlmMessage[] = [...buildHistoryContents(history), finalTurn];

  // Doesn't log the full prompt (the static prefix alone is ~13K tokens) - mode and the
  // athlete's message are what actually vary call to call. userMessage stays on console: a
  // breadcrumb would ride any later error on this request, past ADR 0032's Gemini-failure
  // boundary. Whether this call is actually cached is now the adapter's own business, not
  // something this layer observes.
  console.log("[coach-chat] request:", { mode, userMessage, traceId });
  log("coach-chat", "request", { mode, traceId });

  const adapter = selectLlmAdapter({ ...process.env, GEMINI_API_KEY: apiKey });
  const result = await adapter.generate({
    system,
    cachePrefix,
    messages,
    maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
    responseSchema: chatResponseSchema(mode, firstSession, referenceIds),
    timeoutMs: GEMINI_GENERATE_TIMEOUT_MS,
  });

  const parsed = JSON.parse(result.text) as GeminiReply;
  // Passed as a plain object (not stringified) so console formatting pretty-prints it. Nested
  // under log() data it prints as [Object]. traceId correlates with the commit-trace line logged
  // downstream in the POST handler. The reply stays off the breadcrumb.
  console.log("[coach-chat] response:", parsed, { traceId });
  log("coach-chat", "response", { traceId });
  return parsed;
}
