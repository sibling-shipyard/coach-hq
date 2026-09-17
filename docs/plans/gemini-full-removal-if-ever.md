# If Gemini is ever dropped entirely

> Status: Plan · Owner: Tech Lead · Created: 2026-09-17

## Context

This doc is not a live plan — it's a reference kept dormant for *if* the athlete later decides to
drop direct-Gemini entirely and go OpenRouter-only. It exists so that decision doesn't require a
second research pass. It is **not authorized by the current ADR 0046**, which keeps direct-Gemini
as an intentional rollback path (dev `GEMINI_API_KEY` credit is depleted, not a code problem).
Executing this doc requires superseding ADR 0046 first.

`docs/plans/gemini-to-llm-rename.md` is the doc to execute now — it renames the provider-agnostic
code that's mislabeled "gemini" today. This doc only covers what becomes genuinely deletable if
direct-Gemini itself goes away.

## What would become dead code / removable

- `ui/api/_lib/llmAdapters/geminiAdapter.ts`, `geminiSoulCache.ts`.
- `ui/api/_lib/geminiModel.ts`.
- The `"gemini"` branch of `LlmProviderName` and `selectLlmAdapter` in `ui/api/_lib/llmClient.ts`.
  The seam collapses to one provider.
- `GEMINI_API_KEY` from `.env.local.example`, `docs/eng-docs/env-vars.md`, and the scrub list in
  `ui/observability/sentryScrubber.ts`. Only once nothing reads it.
- `docs/eng-docs/gemini-flow.md`, the direct-Gemini call-path doc.
- `ui/scripts/lib/llmPricing.ts`'s `GEMINI_RATE_PER_MILLION_TOKENS`. Also any branches in
  eval/manual-test scripts currently conditional on `usingOpenRouter` — those conditionals
  collapse once there's only one provider.
- Any `kdb/decisions/` ADR text that would need a "Superseded by" marker. That includes 0046
  itself, and anywhere else direct-Gemini is treated as live.

## What would NOT go away

The renamed provider-neutral code from `docs/plans/gemini-to-llm-rename.md` (`LlmUsage`,
`askLlm`, etc.) — that stays, since it's the code that keeps working under OpenRouter-only.

## Verification

None yet — this doc isn't meant to run until the decision is made. Whoever executes it later
should re-grep for "gemini" first: the rename doc above will have already shrunk this list by
then.
