# layer1-gemini

Tests `_lib/geminiClient.ts::askGemini` end to end through the seam - the only place coach-chat
calls the Gemini API. #713 M2 PR 2 moved the actual HTTP call, the explicit-cache lookup, and the
retry logic out of `geminiClient.ts` into `_lib/llmAdapters/geminiAdapter.ts` (reached via
`selectLlmAdapter`); `askGemini` itself now only builds the prompt/request and parses the reply.

**What's mocked:** `fetchWithTimeout` (from `_lib/httpTimeout.js`), routed by URL so the
`cachedContents` (soul-prefix cache) and `:generateContent` calls can be answered independently.
That's the only fake in this file - request-body construction (`geminiClient.ts`), the
explicit-cache lookup, the cache-retry-on-400 branch, the timeout-retry branch (all
`geminiAdapter.ts`), and response parsing (`geminiClient.ts`) are all real, unmodified code.

**What's real:** prompt/request-body assembly, the explicit-cache lookup path in
`_lib/llmAdapters/geminiSoulCache.ts` (no `GLOBAL_CONFIG` env var in tests, so it fails open the
same way it does in prod when unconfigured), the one-retry-then-give-up logic, and `JSON.parse` of
the model's response text.

**Start here:** `geminiClient.test.ts`. One test (`issue #609`) documents that `askGemini` does no
runtime schema validation beyond `JSON.parse` - a schema-shaped-but-semantically-bad value like
`template_edit: { template_id: "none" }` passes through unchanged. That's why #609's actual fix
lives in `layer2-fields/`, not here.
