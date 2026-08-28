import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the network edge is faked: fetchWithTimeout is the sole boundary askGemini crosses to
// the outside world. Everything else in geminiClient.ts (prompt building, cache-name lookup,
// retry logic, JSON parsing) runs unmodified against these canned HTTP responses.
const { fetchWithTimeout } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}));
vi.mock("../../../_lib/httpTimeout.js", () => ({
  fetchWithTimeout,
  UPSTREAM_TIMEOUT_MS: 25_000,
}));

import { askGemini } from "../../_lib/geminiClient.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function geminiEnvelope(reply: unknown): Response {
  return jsonResponse(200, {
    candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
    usageMetadata: { promptTokenCount: 100, cachedContentTokenCount: 0 },
  });
}

// No GLOBAL_CONFIG in the test env, so soulCache.getCachedSoulName's readRecord() short-circuits
// without hitting the network - but it still calls createCache(), which does call
// fetchWithTimeout against the cachedContents endpoint. Route that away so tests default to the
// no-cache path (cache creation "fails", same as it does today whenever EDGE_CONFIG_ID/
// VERCEL_API_TOKEN aren't set) unless a test explicitly overrides it.
function routeByUrl(cachedContentsRes: Response, generateContentRes: Response) {
  fetchWithTimeout.mockImplementation(async (url: string) => {
    if (url.includes("cachedContents")) return cachedContentsRes;
    return generateContentRes;
  });
}

const args = [
  "test-api-key",
  "soul text",
  "athlete context",
  "quest log",
  [],
  "How's my week looking?",
  "ordinary" as const,
  false,
  undefined,
  "trace-1",
  "UTC",
] as const;

describe("askGemini", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  it("parses a well-formed reply into a GeminiReply", async () => {
    const reply = { reply: "Nice work this week.", session_closed: false };
    routeByUrl(jsonResponse(500, {}), geminiEnvelope(reply));

    const result = await askGemini(...args);

    expect(result).toEqual(reply);
  });

  it("passes a schema-optional field through unmodified, even a semantically bad value (issue #609)", async () => {
    // Gemini can emit template_edit: { template_id: "none" } as a null-ish placeholder instead
    // of omitting the field. askGemini does no runtime validation beyond JSON.parse - it is not
    // this layer's job to reject a schema-shaped-but-semantically-wrong value. The actual crash
    // (applyTemplateEdit throwing on an unknown id) happens one layer down, in coachWorkoutFiles.ts.
    // This test documents that the fix belongs there, not here.
    const reply = {
      reply: "All done for today.",
      template_edit: { template_id: "none" },
      session_closed: true,
    };
    routeByUrl(jsonResponse(500, {}), geminiEnvelope(reply));

    const result = await askGemini(...args);

    expect(result).toEqual(reply);
  });

  it("throws when Gemini returns no text content", async () => {
    routeByUrl(jsonResponse(500, {}), jsonResponse(200, { candidates: [] }));

    await expect(askGemini(...args)).rejects.toThrow("Gemini returned no content");
  });

  it("throws when the response text isn't valid JSON", async () => {
    routeByUrl(
      jsonResponse(500, {}),
      jsonResponse(200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
    );

    await expect(askGemini(...args)).rejects.toThrow();
  });

  it("throws a 429-tagged error on rate limit", async () => {
    routeByUrl(jsonResponse(500, {}), jsonResponse(429, { error: "rate limited" }));

    await expect(askGemini(...args)).rejects.toMatchObject({ status: 429 });
  });

  it("retries once as no-cache when a cached-content name is rejected with 400", async () => {
    // A cache name is only usable if getCachedSoulName actually returned one - simulate a
    // successful cachedContents create so cachedName is truthy on the first generateContent call.
    fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("cachedContents"))
        return jsonResponse(200, { name: "cachedContents/abc123" });
      const body = JSON.parse(init.body as string);
      // First call carries cachedContent (the stale/rejected name) - fail it with 400.
      if (body.cachedContent) return jsonResponse(400, { error: "cached content expired" });
      // Retry carries systemInstruction instead (the no-cache rebuild) - succeed it.
      return geminiEnvelope({ reply: "Recovered without cache." });
    });

    const result = await askGemini(...args);

    expect(result).toEqual({ reply: "Recovered without cache." });
    const generateCalls = fetchWithTimeout.mock.calls.filter(([url]) =>
      (url as string).includes(":generateContent"),
    );
    expect(generateCalls).toHaveLength(2);
  });

  it("retries once on a 504 timeout and surfaces the 504-tagged error if the retry also times out", async () => {
    // fetchWithTimeout's real implementation throws a { status: 504 } Error on abort; geminiClient
    // converts that into a Response so both attempts hit the same status===504 retry branch.
    routeByUrl(jsonResponse(500, {}), jsonResponse(504, {}));

    await expect(askGemini(...args)).rejects.toMatchObject({ status: 504 });
    const generateCalls = fetchWithTimeout.mock.calls.filter(([url]) =>
      (url as string).includes(":generateContent"),
    );
    expect(generateCalls).toHaveLength(2);
  });
});
