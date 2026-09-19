# 0053 - OpenRouter chat sends a cache_control marker on every model

- **Status:** Accepted · 2026-09-18 · Tech Lead
- **Area:** core
- **Context:** chat resends the same fixed prompt prefix on every turn. The OpenRouter adapter used to join that prefix and the per-turn block into one string, so the provider could not see where the stable part ended.
- **Decision:** `toOpenRouterMessages` in `ui/api/_lib/llmAdapters/openRouterAdapter.ts` sends `cachePrefix` as its own system block tagged `cache_control: {type: "ephemeral"}`. It does this for every model, with no per-model branch.
- **Why:** on 2026-09-19 a controlled probe sent the same 10.7k-token prompt with a tiny fixed reply. Unmarked, it cached 0 tokens and OpenRouter reported a prompt cost of $0.0080, even on an exact repeat. Marked, it cached about 10,670 tokens at $0.0012, even with fresh random text. Live chat turns on 2026-09-18 showed the same split.
- **Rejected:** a per-model marker branch → providers that do not need it ignore it, per `docs/eng-docs/chat-provider-bench.md`. Reviving `geminiSoulCache.ts` for OpenRouter → it wraps Gemini's `cachedContents` API, and `cache_control` needs no stored object. Trusting implicit caching → 7 of 8 unmarked turns cached 0, and the one hit came on turn 4 of a run.
- **Enforces:** nobody changes how `toOpenRouterMessages` splits the prompt without a marker-on versus marker-off comparison of cached tokens.
- **How to apply:** read `llm.cache_marker` next to `gen_ai.usage.input_tokens.cached` and `gen_ai.usage.cost.usd` on a Sentry span. Marked calls report cached tokens of prompt minus 49, even for text never sent before. Treat that count as a billing figure, not proof of reuse. The cause is not established.
  Costs above are what OpenRouter reports per call. They are not reconciled against the invoice: the key's usage counter did not track them in four alternating calls. Check OpenRouter Activity before quoting a saving. Coach-message follows the same seam in `docs/plans/openrouter-caching-coach-message.md`.
