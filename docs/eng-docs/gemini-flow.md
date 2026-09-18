# Gemini integration — how the LLM layer works

> Status: Current · Verified against main 2026-09-18

## Context

The old 41KB doc mixed three eras of this layer into one chronology. This rewrite covers only what the code does today: one adapter seam, two providers.

## How it works

Every server-side LLM call goes through `selectLlmAdapter(env)` (`ui/api/_lib/llmClient.ts`). `LLM_PROVIDER=openrouter` picks the OpenRouter adapter; anything else (unset, typo, `gemini`) picks direct Gemini. Exactly one adapter runs per request — never a shadow call.

![LLM adapter seam](./llm-adapter-seam.svg#gh-light-mode-only)
![LLM adapter seam](./llm-adapter-seam.dark.svg#gh-dark-mode-only)

- **Callers (three, all verified by grep):** `ui/api/coach-chat/_lib/llm/coachLlmClient.ts` (`askLlm`, the chat turn), `ui/api/coach-message.ts` (proactive background message), and `ui/api/coach-chat/_lib/commit/activitySyncTurn.ts` (post-sync thread opening reply). Chat's prompt is built in `coachPromptText.ts`: `cachePrefix` (stable SOUL persona + instructions) + `system` (dynamic per-turn text) + the last 40 history messages. Coach-message sends one user turn with an empty system and no `cachePrefix`.
- **Prompt and cache live in the adapters.** The Gemini adapter (`ui/api/_lib/llmAdapters/geminiAdapter.ts`; model `gemini-pro-latest` pinned in `ui/api/_lib/geminiModel.ts`) tries the explicit soul cache (`geminiSoulCache.ts`: cache name + 24h TTL in Vercel Global Config, content hash + model check); on hit it sends `cachedContent` and moves the dynamic block into `contents` as a synthetic exchange (Gemini rejects `cachedContent` + `systemInstruction` together), on miss it concatenates `cachePrefix + system` into one `systemInstruction`. The OpenRouter adapter (`openRouterAdapter.ts`; model `google/gemini-3.8-flash` pinned to provider `google-vertex`) never emulates a cache — it concatenates the same way and remaps `model` turns to `assistant` roles.
- **Retries, one each, capped.** Gemini adapter: one retry on stale-cache 400 (invalidates the name, resends without cache) or on 503/504 (500ms backoff) — only when `cachePrefix` is set, so coach-message gets none. Chat's `askLlm` adds one JSON-parse retry at a shorter 20s timeout. OpenRouter adapter: one retry on truncation (`finish_reason: length`). Per-request timeouts: 60s for chat, 45s for proactive.
- **Response schema is strict JSON everywhere.** The seam's `LlmJsonSchema` requires `additionalProperties: false` at every object level (compiler-enforced in `llmClient.ts`); the Gemini adapter strips it recursively before sending (Gemini rejects it); OpenRouter sends it as `json_schema` with `strict: true`. The adapter returns raw text and the caller parses and validates it. Output ceilings: 8192 tokens for chat (`CHAT_MAX_OUTPUT_TOKENS`, `coachReplySchema.ts`), 3072 for proactive.

## Done when

- The compiler check (`npm run check`) and the seam tests (`ui/api/_lib/_tests/llmClient.test.ts`, `llmAdapters/geminiAdapter.test.ts`, `llmAdapters/openRouterAdapter.test.ts`) pass after any seam change.
- A second chat call's Sentry `gen_ai.generate_content` span shows nonzero `gen_ai.usage.input_tokens.cached` — the explicit cache is actually hitting, not just configured.

## Deferred

- Token-level streaming of plain reply text, separately from validated structured actions (#870).
- Cache invalidation is 24h TTL + content hash — no active push on SOUL redeploy.
- The read-then-write race on cache creation under concurrent cold starts (harmless; documented in `geminiSoulCache.ts`).
