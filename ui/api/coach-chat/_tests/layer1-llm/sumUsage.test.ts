import { describe, expect, it } from "vitest";
import { sumUsage } from "../../_lib/requestCoachReply.js";
import type { LlmUsage } from "../../../_lib/sentry.js";

// sumUsage is the #1053 gap 1 fix: it's what accumulates real token usage across a turn's
// initial call plus up to two reprompts (requestCoachReply.ts calls it after every askLlm() result).
// These tests exercise the pure function directly rather than through a full mocked turn, per
// Tech Lead's review request - a bug here would silently mis-report cost on every turn.

describe("sumUsage", () => {
  it("returns b unchanged when a is undefined", () => {
    const b: LlmUsage = { promptTokens: 10 };
    expect(sumUsage(undefined, b)).toBe(b);
  });

  it("returns a unchanged when b is undefined", () => {
    const a: LlmUsage = { promptTokens: 10 };
    expect(sumUsage(a, undefined)).toBe(a);
  });

  it("returns undefined when both are undefined", () => {
    expect(sumUsage(undefined, undefined)).toBeUndefined();
  });

  it("sums every numeric field when both sides have all fields set", () => {
    const a: LlmUsage = {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedPromptTokens: 20,
      thinkingTokens: 30,
      costUsd: 0.01,
    };
    const b: LlmUsage = {
      promptTokens: 200,
      completionTokens: 75,
      totalTokens: 275,
      cachedPromptTokens: 10,
      thinkingTokens: 15,
      costUsd: 0.02,
    };

    expect(sumUsage(a, b)).toEqual({
      promptTokens: 300,
      completionTokens: 125,
      totalTokens: 425,
      cachedPromptTokens: 30,
      thinkingTokens: 45,
      costUsd: 0.03,
      resolvedProvider: undefined,
      resolvedModel: undefined,
    });
  });

  it("treats a field present on only one side as 0 on the other, per addOpt", () => {
    const a: LlmUsage = { promptTokens: 100 };
    const b: LlmUsage = { promptTokens: 50, thinkingTokens: 15 };

    const result = sumUsage(a, b);

    expect(result?.promptTokens).toBe(150);
    expect(result?.thinkingTokens).toBe(15);
  });

  it("leaves a field undefined when neither side has it, not 0", () => {
    const a: LlmUsage = { promptTokens: 100 };
    const b: LlmUsage = { promptTokens: 50 };

    const result = sumUsage(a, b);

    expect(result?.cachedPromptTokens).toBeUndefined();
  });

  it("takes b's resolvedProvider/resolvedModel when both sides set them", () => {
    const a: LlmUsage = { resolvedProvider: "openrouter", resolvedModel: "model-a" };
    const b: LlmUsage = { resolvedProvider: "openrouter", resolvedModel: "model-b" };

    const result = sumUsage(a, b);

    expect(result?.resolvedModel).toBe("model-b");
  });

  it("falls back to a's resolvedProvider/resolvedModel when b doesn't set them", () => {
    const a: LlmUsage = { resolvedProvider: "openrouter", resolvedModel: "model-a" };
    const b: LlmUsage = { promptTokens: 10 };

    const result = sumUsage(a, b);

    expect(result?.resolvedProvider).toBe("openrouter");
    expect(result?.resolvedModel).toBe("model-a");
  });

  it("composes correctly across three calls, simulating initial + two reprompts", () => {
    const initial: LlmUsage = { promptTokens: 1000, completionTokens: 100, costUsd: 0.01 };
    const reprompt1: LlmUsage = { promptTokens: 1100, completionTokens: 50, costUsd: 0.011 };
    const reprompt2: LlmUsage = { promptTokens: 1200, completionTokens: 60, costUsd: 0.012 };

    let usageAccum: LlmUsage | undefined;
    usageAccum = sumUsage(usageAccum, initial);
    usageAccum = sumUsage(usageAccum, reprompt1);
    usageAccum = sumUsage(usageAccum, reprompt2);

    expect(usageAccum).toEqual({
      promptTokens: 3300,
      completionTokens: 210,
      totalTokens: undefined,
      cachedPromptTokens: undefined,
      thinkingTokens: undefined,
      costUsd: 0.033,
      resolvedProvider: undefined,
      resolvedModel: undefined,
    });
  });
});
