/**
 * Coach-chat's Gemini transport: builds the actual request (combining coachPrompt.ts's text with
 * explicit-cache state from soulCache.ts), calls generateContent, retries transient failures
 * (stale cache, timeout, overload) exactly once, and parses the response. Prompt *content* lives
 * in coachPrompt.ts - this module only owns getting a request to Gemini and a reply back.
 */
import { fetchWithTimeout } from "../httpTimeout.js";
import { getCachedSoulName, invalidateCachedSoulName } from "./soulCache.js";
import type { ChatMessage } from "./chatThreads.js";
import {
  GENERATION_CONFIG,
  buildDynamicText,
  buildHistoryContents,
  staticSystemText,
  type GeminiReply,
  type TurnMode,
} from "./coachPrompt.js";

// Dated model ids keep getting cut early without much notice - gemini-2.0-flash was deprecated,
// then gemini-2.5-flash also started 404ing for free-tier keys ahead of its own announced
// shutdown date. Use Google's maintained "-latest" alias instead: it always points at their
// current recommended flash model, so this doesn't need chasing every time a dated version
// gets sunset. Check aistudio.google.com/rate-limit for this account's actual current
// RPM/RPD numbers - free-tier limits aren't published as a fixed table anymore.
const GEMINI_MODEL = "gemini-flash-latest";

export async function askGemini(
  apiKey: string,
  soul: string,
  stateMd: string,
  questLog: string,
  history: ChatMessage[],
  userMessage: string,
  mode: TurnMode,
  extraContext?: string,
  traceId?: string,
): Promise<GeminiReply> {
  // Ordered for Gemini's implicit prompt caching (automatic, on by default for 2.5+ models) as
  // a fallback path: caching only matches the longest byte-identical *prefix*, so everything
  // stable across turns - persona, fixed instructions, the few-shot examples, and (usually)
  // state.md/quest_log.md - comes first, and the one thing that changes every single minute
  // (today's date/time) is the very last element. When explicit caching (below) is active, only
  // the dynamic block ships per request at all, so this ordering matters less, but it's kept as
  // the correct shape for the no-cache fallback. See docs/eng-docs/gemini-flow.md's Caching
  // section for the numbers.
  const staticText = staticSystemText(soul);
  const cachedName = await getCachedSoulName(apiKey, GEMINI_MODEL, staticText).catch(() => null);
  // Takes `useCache` as a parameter (rather than closing over `cachedName` directly) so the
  // retry below can rebuild this as a plain no-cache request if the cache name Gemini was given
  // turns out to be stale/expired at request time (a distinct failure mode from cache *creation*
  // failing, which getCachedSoulName above already handles) - a call that dies because Gemini
  // rejected an invalid cachedContent reference should never surface to the athlete as "coach
  // didn't reply."
  const historyContents = buildHistoryContents(history);
  const finalTurn = { role: "user", parts: [{ text: mode === "greeting" ? "[Begin the conversation.]" : userMessage }] };

  // Gemini rejects a request that sets both `cachedContent` and `systemInstruction` - when a
  // cache is active, the dynamic block (state/instructions/timestamp) has nowhere else to go but
  // into `contents`, prepended as a synthetic user/model exchange ahead of the real
  // conversation. When there's no cache (not configured, or creation failed this call, or the
  // retry below discovered it was stale), fall back to the pre-explicit-caching shape: everything
  // in systemInstruction, nothing synthetic in contents. Either way Gemini sees the exact same
  // information, just routed differently.
  const buildContents = (useCache: boolean) =>
    useCache
      ? [
          { role: "user", parts: [{ text: buildDynamicText(stateMd, questLog, mode, extraContext, true) }] },
          {
            role: "model",
            parts: [{ text: "Understood - I'll follow those instructions exactly, same as my system instructions." }],
          },
          ...historyContents,
          finalTurn,
        ]
      : [...historyContents, finalTurn];

  const buildRequestBody = (useCache: boolean) => ({
    ...(useCache
      ? { cachedContent: cachedName }
      : { systemInstruction: { parts: [{ text: staticText + "\n" + buildDynamicText(stateMd, questLog, mode, extraContext, false) }] } }),
    contents: buildContents(useCache),
    generationConfig: GENERATION_CONFIG,
  });

  // Closing turns carry a larger prompt than ordinary turns (full chat history) and ask for
  // structured output, so they're the most likely turn to legitimately need more than the shared
  // UPSTREAM_TIMEOUT_MS (25s, sized for plain file reads). Give the actual generateContent call
  // its own longer budget rather than inheriting the file-read default.
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
      // fetchWithTimeout THROWS a 504-tagged Error on its own abort, it never resolves a Response
      // for that case - so a bare `res.status === 504` check below would never see it. Convert it
      // into a resolved 504 Response here so every call site can treat a timeout identically to a
      // real 504 response without each needing its own try/catch. Any other thrown error (a
      // genuine network failure with no status) still propagates.
      const status = (err as { status?: number }).status;
      if (status === 504) return new Response(null, { status: 504 });
      throw err;
    });

  // Validation logging: full visibility into what we actually asked for, paired with the full
  // response logging in finishGeminiResponse below. Deliberately doesn't log the full prompt
  // text (the static system prompt alone is ~13K tokens) - mode and the athlete's own message are
  // the two things that actually vary call to call and matter for correlating a request with its
  // response.
  console.log("[coach-chat] request:", { mode, userMessage, useCache: !!cachedName, traceId });
  let useCache = !!cachedName;
  let res = await callGemini(useCache);
  // Capped at ONE retry total, not one per failure kind - a naive "retry the 400 case, then
  // separately retry the 504/503 case" allows a genuinely unlucky request to chain 2 full
  // GEMINI_GENERATE_TIMEOUT_MS-budget calls back to back, which risks blowing through
  // ui/vercel.json's maxDuration. Below, only ONE of the two branches can ever fire per call.
  //
  // A stale/invalid cachedContent name (expired between getCachedSoulName's read and this actual
  // call, or evicted server-side) is a distinct failure mode from cache *creation* failing - that
  // case is already handled by getCachedSoulName falling back to null. This one only shows up
  // here, at request time, as a 400 - retry once as a plain no-cache call so it never surfaces to
  // the athlete as "coach didn't reply," and drop the bad record so the next request doesn't
  // repeat this round-trip.
  if (useCache && res.status === 400) {
    invalidateCachedSoulName().catch(() => {});
    useCache = false;
    res = await callGemini(useCache);
  } else if (res.status === 504 || res.status === 503) {
    // A timed-out request (504, our own fetchWithTimeout abort) or a genuine Gemini-side overload
    // (503 UNAVAILABLE) are both transient. Retry once more; a short fixed backoff is enough since
    // these aren't rate-limit errors (that's 429, handled separately in finishGeminiResponse and
    // never retried here). Note this branch is unreachable on the same call where the 400 branch
    // above already fired - if the no-cache retry itself times out, that failure surfaces as-is.
    await new Promise((resolve) => setTimeout(resolve, 500));
    res = await callGemini(useCache);
  }

  return finishGeminiResponse(res, mode, traceId);
}

async function finishGeminiResponse(res: Response, mode: TurnMode, traceId?: string): Promise<GeminiReply> {
  if (res.status === 429) {
    // Not necessarily free-tier - Tier 1 has its own (much higher) ceilings too. Both clients
    // handle 429 as its own case with a proper "wait and retry" message rather than surfacing
    // this string directly, but keep it accurate for any caller/log that does read it raw.
    throw Object.assign(new Error("Gemini rate limit exceeded - try again shortly"), { status: 429 });
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number };
  };
  // Cheap, permanent visibility into whether explicit caching is actually being hit on real
  // traffic - the whole point of soulCache.ts is this number being nonzero and close to
  // promptTokenCount, so it's worth a standing log line rather than only checking ad hoc.
  const usage = body.usageMetadata;
  if (usage) {
    console.log(`[coach-chat] Gemini usage: prompt=${usage.promptTokenCount ?? "?"} cached=${usage.cachedContentTokenCount ?? 0}`);
  }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as GeminiReply;
  // Validation logging: the complete, unredacted response. Passed as a plain object, not
  // JSON.stringify'd, so Node's own console formatting pretty-prints/wraps it instead of dumping
  // one unreadable line. traceId included on closing turns to correlate with the close-trace line
  // logged downstream in the POST handler.
  console.log("[coach-chat] response:", parsed, mode === "closing" ? { traceId } : undefined);
  return parsed;
}
