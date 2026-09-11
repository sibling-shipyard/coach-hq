/**
 * selectLlmAdapter — the env-driven switch, not either adapter's HTTP boundary
 * (`_tests/llmAdapters/`). Adapter construction does no I/O, so these assertions only need
 * `.name`/`.model`, never a mocked fetch.
 */
import { describe, expect, it } from "vitest";
import { selectLlmAdapter, type LlmJsonSchemaNode } from "../llmClient.js";

describe("selectLlmAdapter", () => {
  it("defaults to direct Gemini when LLM_PROVIDER is unset", () => {
    const adapter = selectLlmAdapter({} as NodeJS.ProcessEnv);
    expect(adapter.name).toBe("gemini");
    expect(adapter.model).toBe("gemini-pro-latest");
  });

  it('selects direct Gemini for the explicit value "gemini"', () => {
    const adapter = selectLlmAdapter({ LLM_PROVIDER: "gemini" } as NodeJS.ProcessEnv);
    expect(adapter.name).toBe("gemini");
  });

  it('selects OpenRouter only for the exact value "openrouter", with its own model id', () => {
    const adapter = selectLlmAdapter({ LLM_PROVIDER: "openrouter" } as NodeJS.ProcessEnv);
    expect(adapter.name).toBe("openrouter");
    expect(adapter.model).toBe("google/gemini-3.8-flash");
  });

  it.each(["OpenRouter", "OPENROUTER", "open-router", "azure", ""])(
    "falls back to direct Gemini for an unrecognized value (%j), never a silent OpenRouter switch",
    (value) => {
      const adapter = selectLlmAdapter({ LLM_PROVIDER: value } as NodeJS.ProcessEnv);
      expect(adapter.name).toBe("gemini");
    },
  );
});

// #713 M2 PR 2: coachReplySchema.ts's RESPONSE_PROPERTIES relies on `LlmJsonSchemaNode` to make
// the compiler - not a human eyeballing 19 objects - catch a missing `additionalProperties: false`
// at any nesting depth. This is a type-level test: `npm run check` (tsc) is the gate that actually
// proves it, not `vitest run` (which transpiles without type-checking test files).
describe("LlmJsonSchemaNode strict-schema enforcement (#713 M2 PR 2)", () => {
  it("rejects a nested object missing additionalProperties: false, not just the top-level one", () => {
    const valid: LlmJsonSchemaNode = {
      type: "object",
      properties: {
        inner: { type: "object", properties: {}, additionalProperties: false },
      },
      additionalProperties: false,
    };
    expect(valid.type).toBe("object");

    // If a future edit to LlmJsonSchemaNode ever lets `inner` compile without
    // additionalProperties: false, this @ts-expect-error itself starts failing `tsc` ("Unused
    // '@ts-expect-error' directive") - the test can't silently stop proving anything.
    const missingNested: LlmJsonSchemaNode = {
      type: "object",
      properties: {
        // @ts-expect-error - missing additionalProperties: false.
        inner: { type: "object", properties: {} },
      },
      additionalProperties: false,
    };
    expect(missingNested.type).toBe("object");
  });
});
