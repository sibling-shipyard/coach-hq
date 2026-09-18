# Plan: prompt caching for coach-chat on OpenRouter

> Status: Plan · Owner: Tech Lead · Created: 2026-09-15

## Context

Coach-chat resends `platform/SOUL.chat.md` (~13k tokens) as a static prefix on every turn.
Gemini has native caching, and this repo actually built a real explicit-cache mechanism for
it (`geminiSoulCache.ts`, backed by Vercel Edge Config writes for the `cachedContents` name/TTL).
But production switched `LLM_PROVIDER` to `openrouter` on 2026-09-05 (ADR 0046), and the
OpenRouter adapter never emulated that mechanism - it just concatenates the static prefix and
the per-turn dynamic block into one plain string. So the one caching mechanism that's actually
wired up is dead in production, and nothing has replaced it. I want to know if caching is
possible on OpenRouter, whether it depends on which model is set, and have a plan ready - not
code yet.

## What I found

**In-repo (dead code):** `ui/api/_lib/llmAdapters/geminiSoulCache.ts` + `geminiAdapter.ts`
implement real explicit Gemini caching (`cachedContents` API, Vercel Edge/Global Config
persistence of the cache name across cold starts). This is the "Vercel config writes" I half
remembered. It only runs on the direct-Gemini path (`LLM_PROVIDER` unset/`"gemini"`), which is
not what production uses today.

**In-repo (measured evidence, 2026-09-06):** `docs/eng-docs/chat-provider-bench.md` already ran
the exact experiment that answers this question, on the real `coach-message` prompt shape. It
contradicts the generic docs:
- Unmarked calls through OpenRouter -> Vertex/Gemini get **0% cache hit** on production's
  actual varying-tail traffic (a fresh athlete block every call defeats Vertex's
  exact-repeat-only discount).
- Adding OpenRouter's explicit `cache_control: {type: "ephemeral"}` marker at the stable-prefix
  boundary gets an **immediate, stable ~48% discount from the very first call**, and holds
  across all six calls in the run.
- The doc's own recommendation: *"if Gemini stays the model, ship the marker."*

**Online research (current, general):** Gemini's *implicit* caching is supposed to be automatic
on OpenRouter with no marker needed, per OpenRouter's own docs/blog - the opposite of what the
bench doc measured on our real traffic. The bench doc's finding wins: it's this app's actual
request shape (soul + variable per-turn block), measured with real `cached_tokens` on the wire,
not a generic claim. Also confirmed: Gemini's implicit-cache TTL is only ~3-5 min and doesn't
refresh, so sparse/spread-out traffic (coach-chat's real pattern - individual athletes messaging
occasionally) gets little benefit from implicit caching regardless.

Per-model behavior on OpenRouter is genuinely not uniform:
| Family | Mechanism | Needs code? |
|---|---|---|
| Gemini (measured) | needs `cache_control` marker to reliably hit on varying-tail traffic | yes, but see below |
| OpenAI, Grok, Moonshot, Groq, DeepSeek, Z.AI | automatic/implicit | no |
| Anthropic, Alibaba | explicit only | yes, `cache_control` required |

The marker was sent to Gemini, Venice, Parasail, and other DeepSeek arms in the same #890 probe
without breaking any of them - the providers that don't need it just ignore it. One code path
(always send the marker at the cachePrefix/system boundary) is therefore safe and correct across
every model OpenRouter currently offers, not just Gemini. That removes the "change it if we
change models" problem rather than requiring a per-model branch.

Cost magnitude: at coach-chat's real volume (dozens-low-hundreds of calls/day) and ~13k-token
prefix, a working cache saves roughly $10-40/month - not a large number, but the code change is
small and the seam already exists to do it cleanly (see below). Worth shipping since it's
basically free to build.

## Recommended approach

The seam is already right for this: `LlmRequest.cachePrefix` (stable) and `LlmRequest.system`
(per-turn dynamic) are already separate fields in `ui/api/_lib/llmClient.ts`, built by
`askLlm()` in `ui/api/coach-chat/_lib/llm/coachLlmClient.ts`. The only place that erases the
boundary is `toOpenRouterMessages()` in `ui/api/_lib/llmAdapters/openRouterAdapter.ts`, which
today does `cachePrefix + "\n" + system` as one plain string.

1. **`openRouterAdapter.ts`** - change `toOpenRouterMessages()` so the leading system message
   becomes a content array with two blocks instead of one string, whenever `request.cachePrefix`
   is set: block 1 = `cachePrefix` text with `cache_control: {type: "ephemeral"}`, block 2 =
   `system` text, no marker. Same gating condition already used elsewhere (`if (request.cachePrefix)`).
   No per-model branching - always attach the marker on the OpenRouter path when a cache prefix
   exists; providers that don't use it ignore it (per the #890 evidence).
2. **New ADR** (`kdb/decisions/0048-openrouter-cache-control-marker.md`) - this is a real,
   hard-to-rediscover architecture decision with no ADR anywhere today (grep confirms zero ADRs
   mention caching). Record: what exists (dead Gemini explicit cache), what's live (nothing),
   what I'm shipping (the marker, model-agnostic), and why (measured evidence in
   `chat-provider-bench.md`, not the generic docs). Explicitly note `geminiSoulCache.ts` stays as
   dead-but-not-removed code for the direct-Gemini fallback path (ADR 0046 already says
   OpenRouter is an interim state, not a locked-in permanent decision).
3. **Docs to update** (per the repo's own doc-upkeep rule, same PR):
   - `docs/eng-docs/chat-llm-seam.md` - the seam table currently lists "Explicit cache: None" for
     OpenRouter; update to point at the new marker and the ADR.
   - `docs/eng-docs/llm-provider-current.md` - its "Caching" section currently only describes the
     dead-end finding; add the marker and its measured effect.
   - `docs/eng-docs/chat-provider-bench.md` - cross-reference the new ADR from its
     "Recommendation" line so the bench finding and the shipped decision are linked.
4. **Verification** - per the standing rule to live-test coach-chat changes on a scratch branch:
   run real coach-chat turns against `test/close-verification` on `coach-skanda-2003`. Check the
   Sentry `gen_ai.usage.input_tokens.cached` span attribute (already wired, `ui/api/_lib/sentry.ts`)
   is nonzero from the first call onward for a repeat-session conversation, and spot-check cost
   per call drops roughly in line with the ~48% figure. Also run
   `coachTurn-reprompt.test.ts` / relevant integration tests to confirm the content-array message
   shape doesn't break response parsing.

## What I'm not doing

- Not reviving `geminiSoulCache.ts`'s Edge Config mechanism for the OpenRouter path - it's a
  Gemini-`cachedContents`-specific API shape, not something OpenRouter's `cache_control` needs
  (no storage object to create/track, no TTL bookkeeping).
- Not building a per-model conditional for the marker - the evidence says one path is safe.
- Not chasing the exact discrepancy between OpenRouter's docs and the bench doc's measurement
  further - the bench doc's measured wire data is what I'm trusting for this repo's real traffic.

## Files touched

- `ui/api/_lib/llmAdapters/openRouterAdapter.ts` (the actual code change)
- `ui/api/_lib/_tests/llmAdapters/openRouterAdapter.test.ts` (extend with a marker-format
  assertion - the file already exists)
- `kdb/decisions/0048-openrouter-cache-control-marker.md` (new ADR)
- `docs/eng-docs/chat-llm-seam.md`, `docs/eng-docs/llm-provider-current.md`,
  `docs/eng-docs/chat-provider-bench.md` (doc updates)