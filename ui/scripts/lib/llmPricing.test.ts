import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatCostUsd } from "./llmPricing.js";
import type { GeminiUsage } from "../../api/_lib/sentry.js";

// GEMINI_RATE_PER_MILLION_TOKENS isn't exported - the file's own doc comment flags its input/
// output split as a still-open pricing question, so I duplicate the exact split here rather than
// hardcode a dollar figure that could silently drift out of sync with the source constant.
const GEMINI_RATE_PER_MILLION_TOKENS = { input: 1.5, output: 7.5 };

describe("estimateCostUsd", () => {
  it("returns undefined when there's no usage at all", () => {
    expect(estimateCostUsd(undefined, "gemini")).toBeUndefined();
  });

  it("prices direct Gemini from the table rate, matching the source constant's own math", () => {
    const usage: GeminiUsage = { promptTokens: 2_000_000, completionTokens: 500_000 };

    const expected =
      (usage.promptTokens! / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.input +
      (usage.completionTokens! / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.output;

    expect(estimateCostUsd(usage, "gemini")).toBe(expected);
    expect(estimateCostUsd(usage, "gemini")).toBeCloseTo(6.75, 10);
  });

  it("bills thinking tokens as output too, per #827 - not silently excluded", () => {
    // Reproduces the real bug: completionTokens and thinkingTokens are genuinely separate fields
    // on the Gemini side (candidatesTokenCount vs thoughtsTokenCount) - a version of this function
    // that only priced completionTokens would under-count every call with real thinking tokens.
    const usage: GeminiUsage = {
      promptTokens: 1_000_000,
      completionTokens: 0,
      thinkingTokens: 500_000,
    };

    const expected = (usage.thinkingTokens! / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.output;

    expect(estimateCostUsd(usage, "gemini")).toBeCloseTo(1.5 + expected, 10);
  });

  it("trusts OpenRouter's wire-reported costUsd directly instead of recomputing from tokens", () => {
    // These token counts would price very differently from costUsd under the Gemini table rate -
    // confirms the function isn't quietly ignoring costUsd and recomputing anyway.
    const usage: GeminiUsage = {
      promptTokens: 2_000_000,
      completionTokens: 500_000,
      costUsd: 0.0042,
    };

    expect(estimateCostUsd(usage, "openrouter")).toBe(0.0042);
  });

  it("falls back to the table rate for OpenRouter when the wire never reported a costUsd", () => {
    const usage: GeminiUsage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };

    const expected =
      (usage.promptTokens! / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.input +
      (usage.completionTokens! / 1_000_000) * GEMINI_RATE_PER_MILLION_TOKENS.output;

    expect(estimateCostUsd(usage, "openrouter")).toBe(expected);
  });

  it("returns undefined, not $0, when both token counts are 0", () => {
    expect(estimateCostUsd({ promptTokens: 0, completionTokens: 0 }, "gemini")).toBeUndefined();
  });

  it("returns undefined, not $0, when both token counts are undefined", () => {
    expect(estimateCostUsd({}, "gemini")).toBeUndefined();
  });
});

describe("formatCostUsd", () => {
  it('formats undefined as "unknown"', () => {
    expect(formatCostUsd(undefined)).toBe("unknown");
  });

  it("formats to exactly 3 decimal places with a leading $", () => {
    expect(formatCostUsd(0.014)).toBe("$0.014");
  });

  it("rounds to 3 decimal places rather than truncating", () => {
    expect(formatCostUsd(0.0146)).toBe("$0.015");
  });
});
