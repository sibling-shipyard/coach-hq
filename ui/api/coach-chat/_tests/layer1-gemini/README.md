# layer1-gemini

Tests `_lib/geminiClient.ts::askGemini` - the only place coach-chat calls the Gemini API.

**What's mocked:** `fetchWithTimeout` (from `_lib/httpTimeout.js`), routed by URL so the
`cachedContents` (soul-prefix cache) and `:generateContent` calls can be answered independently.
That's the only fake in this file - request-body construction, the cache-retry-on-400 branch, the
timeout-retry branch, and response parsing are all the real, unmodified code in `geminiClient.ts`.

**What's real:** prompt/request-body assembly, the explicit-cache lookup path in `soulCache.ts`
(no `GLOBAL_CONFIG` env var in tests, so it fails open the same way it does in prod when
unconfigured), the one-retry-then-give-up logic, and `JSON.parse` of the model's response text.

**Start here:** `geminiClient.test.ts`. One test (`issue #609`) documents that `askGemini` does no
runtime schema validation beyond `JSON.parse` - a schema-shaped-but-semantically-bad value like
`template_edit: { template_id: "none" }` passes through unchanged. That's why #609's actual fix
lives in `layer2-fields/`, not here.
