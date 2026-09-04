/**
 * selectLlmAdapter — the env-driven switch, not either adapter's HTTP boundary
 * (`_tests/llmAdapters/`). Adapter construction does no I/O, so these assertions only need
 * `.name`/`.model`, never a mocked fetch.
 */
import { describe, expect, it } from "vitest";
import { selectLlmAdapter } from "../llmClient.js";

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
