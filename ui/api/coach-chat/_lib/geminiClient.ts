/** Gemini request construction, explicit-cache use, one retry, and response parsing. */
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";
import { withGeminiSpan, type GeminiUsage } from "../../_lib/sentry.js";
import { log } from "../../_lib/log.js";
import { GEMINI_MODEL } from "../../_lib/geminiModel.js";
import { getCachedSoulName, invalidateCachedSoulName } from "./soulCache.js";
import type { ChatMessage } from "./chatThreads.js";
import { buildDynamicText, buildHistoryContents, staticSystemText } from "./coachPromptText.js";
import {
  generationConfigFor,
  type AthleteReferenceIds,
  type GeminiReply,
  type TurnMode,
} from "./coachReplySchema.js";

export { GEMINI_MODEL };

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
  // Ordered for implicit-caching fallback: stable content (persona, instructions, few-shots,
  // usually state/quest_log) first, volatile today's-date last. See docs/eng-docs/gemini-flow.md.
  const staticText = staticSystemText(soul);
  const cachedName = await getCachedSoulName(apiKey, GEMINI_MODEL, staticText).catch(() => null);
  // `useCache` is a parameter, not closed over `cachedName`, so the retry below can rebuild as a
  // plain no-cache request if the cache name turns out stale/expired at request time.
  const historyContents = buildHistoryContents(history);
  const finalTurn = {
    role: "user",
    parts: [{ text: mode === "greeting" ? "[Begin the conversation.]" : userMessage }],
  };

  // Gemini rejects setting both `cachedContent` and `systemInstruction` - when a cache is
  // active, the dynamic block has nowhere to go but `contents`, prepended as a synthetic
  // user/model exchange. Without a cache, it's concatenated into systemInstruction instead.
  const buildContents = (useCache: boolean) =>
    useCache
      ? [
          {
            role: "user",
            parts: [
              {
                text: buildDynamicText(
                  athleteContext,
                  questLog,
                  mode,
                  firstSession,
                  extraContext,
                  true,
                  timezone,
                ),
              },
            ],
          },
          {
            role: "model",
            parts: [
              {
                text: "Understood - I'll follow those instructions exactly, same as my system instructions.",
              },
            ],
          },
          ...historyContents,
          finalTurn,
        ]
      : [...historyContents, finalTurn];

  const buildRequestBody = (useCache: boolean) => ({
    ...(useCache
      ? { cachedContent: cachedName }
      : {
          systemInstruction: {
            parts: [
              {
                text:
                  staticText +
                  "\n" +
                  buildDynamicText(
                    athleteContext,
                    questLog,
                    mode,
                    firstSession,
                    extraContext,
                    false,
                    timezone,
                  ),
              },
            ],
          },
        }),
    contents: buildContents(useCache),
    generationConfig: generationConfigFor(mode, firstSession, referenceIds),
  });

  // Closing turns carry a larger prompt (full history) than the shared UPSTREAM_TIMEOUT_MS (25s,
  // sized for file reads) can comfortably fit - give generateContent its own longer budget.
  const GEMINI_GENERATE_TIMEOUT_MS = 45_000;

  const callGemini = (useCache: boolean): Promise<Response> =>
    fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(useCache)),
      },
      GEMINI_GENERATE_TIMEOUT_MS,
    ).catch((err) => {
      // fetchWithTimeout throws a 504-tagged Error on its own abort rather than resolving a
      // Response - convert it so every call site can treat a timeout like a real 504.
      const status = (err as { status?: number }).status;
      if (status === 504) return new Response(null, { status: 504 });
      throw err;
    });

  // Doesn't log the full prompt (the static prefix alone is ~13K tokens) - mode and the
  // athlete's message are what actually vary call to call. userMessage stays on console: a
  // breadcrumb would ride any later error on this request, past ADR 0032's Gemini-failure
  // boundary.
  console.log("[coach-chat] request:", { mode, userMessage, useCache: !!cachedName, traceId });
  log("coach-chat", "request", { mode, useCache: !!cachedName, traceId });
  // The span covers the retry too: what the operator times is how long the turn waited for
  // Gemini, not how long one of its attempts took.
  return withGeminiSpan(GEMINI_MODEL, async (recordUsage) => {
    let useCache = !!cachedName;
    let res = await callGemini(useCache);
    // Capped at one retry total (if/else if) - chaining two full-budget calls risks blowing
    // through vercel.json's maxDuration.
    //
    // A stale/invalid cachedContent name shows up here as a 400 - retry once as plain no-cache
    // and drop the bad record so the next request doesn't repeat the round-trip.
    if (useCache && res.status === 400) {
      invalidateCachedSoulName().catch(() => {});
      useCache = false;
      res = await callGemini(useCache);
    } else if (res.status === 504 || res.status === 503) {
      // A timeout (504) or Gemini overload (503) is transient - retry once with a short fixed
      // backoff. Unreachable alongside the 400 branch above.
      await new Promise((resolve) => setTimeout(resolve, 500));
      res = await callGemini(useCache);
    }

    return finishGeminiResponse(res, mode, traceId, recordUsage);
  });
}

async function finishGeminiResponse(
  res: Response,
  mode: TurnMode,
  traceId?: string,
  recordUsage?: (usage: GeminiUsage) => void,
): Promise<GeminiReply> {
  if (res.status === 429) {
    throw Object.assign(new Error("Gemini rate limit exceeded - try again shortly"), {
      status: 429,
    });
  }
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error(`Gemini request failed (${res.status}): ${detail}`), {
      status: res.status,
    });
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      cachedContentTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  // Standing visibility into whether explicit caching is actually being hit on real traffic.
  const usage = body.usageMetadata;
  if (usage) {
    console.log(
      `[coach-chat] Gemini usage: prompt=${usage.promptTokenCount ?? "?"} cached=${usage.cachedContentTokenCount ?? 0}`,
    );
    recordUsage?.({
      promptTokens: usage.promptTokenCount,
      completionTokens: usage.candidatesTokenCount,
      totalTokens: usage.totalTokenCount,
      cachedPromptTokens: usage.cachedContentTokenCount,
    });
  }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as GeminiReply;
  // Passed as a plain object (not stringified) so console formatting pretty-prints it. Nested
  // under log() data it prints as [Object]. traceId on closing turns correlates with the
  // close-trace line logged downstream in the POST handler. The reply stays off the breadcrumb.
  console.log("[coach-chat] response:", parsed, mode === "closing" ? { traceId } : undefined);
  log("coach-chat", "response", mode === "closing" ? { traceId } : undefined);
  return parsed;
}
