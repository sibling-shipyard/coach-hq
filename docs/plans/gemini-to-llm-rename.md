# Rename provider-agnostic "gemini" code to "llm"

> Status: Plan · Owner: Tech Lead · Created: 2026-09-17

## Context

ADR 0046 moved coach-chat production onto OpenRouter (`google/gemini-3.8-flash`), not direct
Gemini. Several files, folders, and identifiers that are actually provider-agnostic dispatch code
are still named "gemini," which is confusing now that OpenRouter is the live path. Direct-Gemini
code that's genuinely Gemini-specific is a deliberate live rollback path per ADR 0046 (dev
`GEMINI_API_KEY` credit is depleted, not the code) — it's explicitly kept and untouched here. A
separate, dormant doc (`docs/plans/gemini-full-removal-if-ever.md`) covers what would be deletable
if that rollback path is ever dropped for good; this doc is renames only.

## Decision

Rename in priority order:

1. **`ui/api/_lib/sentry.ts`** — `GeminiUsage` → `LlmUsage`, `withGeminiSpan` → `withLlmSpan`,
   `captureGeminiFailure` → `captureLlmFailure`, `GeminiFailureDetails` → `LlmFailureDetails`.
   Used by both adapters today (coach-chat and coach-message); highest-value rename since it's
   shared observability plumbing.
2. **`ui/api/coach-chat/_lib/gemini/` folder** → `ui/api/coach-chat/_lib/llm/`;
   `geminiClient.ts` → a non-colliding name since `ui/api/_lib/llmClient.ts` is already the
   provider seam (proposed: `coachLlmClient.ts`); `askGemini` → `askLlm`. Rename the paired test
   folder `ui/api/coach-chat/_tests/layer1-gemini/` → `layer1-llm/`.
3. **`ui/api/coach-message/_lib/coachMessage.ts`** — `captureGeminiFailure` call sites and
   hardcoded error strings ("Gemini response must...") → provider-neutral text.

### Flag only, no rename yet

`ui/api/_lib/geminiModel.ts`'s `GEMINI_MODEL` constant is used as a generic fallback in error
metadata even when OpenRouter is active. Either add a separate `DEFAULT_MODEL_LABEL` for error
metadata, or accept the mislabel as low-severity and leave it — decide during execution.

### Docs to update (not rewritten here)

- `docs/eng-docs/llm-provider-current.md` — ADR 0046 already flags its cost table as stale
  (priced against direct-Gemini, not OpenRouter-routed Flash).
- `docs/eng-docs/env-vars.md` — `GEMINI_API_KEY` marked "Required"; note production doesn't
  actually set it per ADR 0046.

### Explicitly kept as-is (genuinely Gemini-specific)

`geminiAdapter.ts`, `geminiSoulCache.ts`, and `geminiModel.ts` (the module itself — just not its
use as a generic fallback). `docs/eng-docs/gemini-flow.md`. `.env.local.example`'s
`GEMINI_API_KEY` line. `ui/observability/sentryScrubber.ts`'s `GEMINI_API_KEY` scrub target.
`ui/scripts/lib/llmPricing.ts`'s `GEMINI_RATE_PER_MILLION_TOKENS` — flag this one as stale under
OpenRouter pricing. That's a pricing-accuracy bug, not a naming issue; note it as a P2 follow-up
and don't fold it into this rename.

### Variable-level pass, not just exported symbols

The audit behind this doc was done at the file/export/function level. Execution must also grep
each flagged file for local, non-exported identifiers containing "gemini" — e.g. a local
`const geminiResponse` or `let geminiPrompt` inside a function body in `sentry.ts`,
`coachMessage.ts`, or the renamed `coach-chat/_lib/llm/` files — and rename those too. Re-run
`grep -rin "gemini"` per-file (not just per-export) on each of the three priority files before
considering that file done.

## Verification

1. `grep -rin "gemini"` across `ui/api/` matches only the explicitly-kept list above, at every
   scope (exports and local variables).
2. Coach-chat test suite passes, confirming renamed exports have no dangling references.
