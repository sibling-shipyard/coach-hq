/**
 * llmPricing.ts - turns a real usage count (llmClient.ts's `LlmResult["usage"]`, now returned by
 * askGemini() - #1044 PR1) into a real dollar figure, per docs/eng-docs/llm-provider-current.md's
 * Options table. This is the "real prerequisite" the vade-the-tester plan named: usage was already
 * computed by both adapters for their Sentry spans, it just never reached a caller that could
 * price it until now.
 *
 * I only price direct Gemini from the table - OpenRouter reports its own real per-call `costUsd`
 * on the wire (see openRouterAdapter.ts's `cumulativeUsage.costUsd`), so multiplying that by a
 * table rate would be wrong twice over. Use the wire cost when it's there; fall back to the table
 * only for the provider that doesn't report one itself.
 */
import type { GeminiUsage } from "../../api/_lib/sentry.js";
import type { LlmProviderName } from "../../api/_lib/llmClient.js";

/**
 * $/M input, $/M output - the "Gemini paid (live now)" row of llm-provider-current.md's Options
 * table. That doc's own Context section flags this row as priced against Flash's rate, not the
 * `gemini-pro-latest` model actually pinned in production (`geminiModel.ts`) - re-verify against
 * that doc before trusting this number for a real budget decision, same caveat it carries there.
 * This module exists to make the arithmetic possible, not to re-litigate the still-open pricing
 * question.
 */
const GEMINI_RATE_PER_MILLION_TOKENS = { input: 1.5, output: 7.5 } as const;

/**
 * Real USD for one call, given its usage and which provider ran it. `undefined` when there's
 * nothing to price (no usage at all - shouldn't happen in practice per llmClient.ts's own
 * comment, but a caller must not fabricate a cost when the provider reported none).
 *
 * Gemini: `promptTokens` at the input rate; `completionTokens` PLUS `thinkingTokens` at the output
 * rate - thinking tokens bill as output per #827, and `completionTokens` on the Gemini side is a
 * genuinely separate field from `thinkingTokens` (geminiAdapter.ts's usageMetadata mapping sets
 * `completionTokens` from `candidatesTokenCount` and `thinkingTokens` from `thoughtsTokenCount`
 * independently - neither already contains the other), so both need adding, not just one.
 * OpenRouter: trusts the wire `costUsd` outright; only falls back to the table if OpenRouter's
 * own response ever omits it (e.g. `usage: {include: true}` didn't round-trip).
 */
export function estimateCostUsd(
  usage: GeminiUsage | undefined,
  provider: LlmProviderName,
): number | undefined {
  if (!usage) return undefined;
  if (provider === "openrouter" && usage.costUsd !== undefined) return usage.costUsd;
  const promptTokens = usage.promptTokens ?? 0;
  const outputTokens = (usage.completionTokens ?? 0) + (usage.thinkingTokens ?? 0);
  if (promptTokens === 0 && outputTokens === 0) return undefined;
  return (
    (promptTokens / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.input +
    (outputTokens / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.output
  );
}

/** Formats a cost the way the day-doc format (kdb/test-doc-style.md) shows it: "$0.014". */
export function formatCostUsd(usd: number | undefined): string {
  if (usd === undefined) return "unknown";
  return `$${usd.toFixed(3)}`;
}
