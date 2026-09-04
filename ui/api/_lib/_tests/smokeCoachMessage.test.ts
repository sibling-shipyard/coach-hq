/**
 * The assertion half of `ui/scripts/smoke-coach-message.ts` — the live-model canary for
 * coach-message. No model runs here: the canary's own paid call belongs to its scheduled
 * workflow (ADR 0024, ADR 0037), and `npm test` stays free and deterministic. What these cover
 * is the part that decides whether a red run is actionable — telling a truncated reply apart
 * from an unparseable one, and both apart from a reply that parses but breaks the `{body}`
 * contract.
 *
 * A canary whose checks are wrong is worse than none: it either goes green on a broken model or
 * red with a reason nobody can act on.
 */
import { describe, expect, it } from "vitest";
import {
  ADAPTER_KEYS,
  SmokeFailure,
  buildSmokePrompt,
  checkProactiveReply,
  classifyAdapterError,
  looksTruncated,
} from "../../../scripts/smoke-coach-message.js";

const GOOD_BODY = "You held the second half together. That is the part I noticed.";
const GOOD_REPLY = JSON.stringify({ body: GOOD_BODY });

/** Run the check and hand back the failure it threw, so each test asserts on kind and text
 * rather than repeating a try/catch. */
function failureFrom(adapter: string, text: string): SmokeFailure {
  try {
    checkProactiveReply(adapter, text);
  } catch (err) {
    if (err instanceof SmokeFailure) return err;
    throw err;
  }
  throw new Error(`checkProactiveReply accepted a reply it should have rejected: ${text}`);
}

describe("looksTruncated", () => {
  it("is false for a complete object", () => {
    expect(looksTruncated(GOOD_REPLY)).toBe(false);
  });

  it("is true when the object never closes", () => {
    expect(looksTruncated('{"body": "You held the second half')).toBe(true);
  });

  it("is true when a string never closes but the braces balance by luck", () => {
    expect(looksTruncated('{"body": "a } b')).toBe(true);
  });

  it("is false for text that is not JSON at all", () => {
    expect(looksTruncated("Sorry, I cannot help with that request.")).toBe(false);
  });

  it("does not count braces inside a finished string", () => {
    expect(looksTruncated('{"body": "a { b"}')).toBe(false);
  });

  it("does not count an escaped quote as closing the string", () => {
    expect(looksTruncated('{"body": "she said \\"go\\""}')).toBe(false);
  });
});

describe("checkProactiveReply", () => {
  it("returns the body of a valid reply", () => {
    expect(checkProactiveReply("gemini", GOOD_REPLY)).toBe(GOOD_BODY);
  });

  it("reports a cut-off reply as truncated, not as a parse error", () => {
    const failure = failureFrom("gemini", '{"body": "You held the second half toget');
    expect(failure.kind).toBe("truncated");
    expect(failure.adapter).toBe("gemini");
    expect(failure.message).toContain("[gemini]");
    expect(failure.message).toContain("raw reply");
  });

  it("reports non-JSON as unparseable", () => {
    const failure = failureFrom("openrouter", "I cannot answer that.");
    expect(failure.kind).toBe("unparseable");
    expect(failure.message).toContain("[openrouter]");
  });

  it("reports an empty reply", () => {
    const failure = failureFrom("openrouter", "   ");
    expect(failure.kind).toBe("unparseable");
    expect(failure.message).toContain("empty");
  });

  it("rejects JSON that is not an object", () => {
    expect(failureFrom("gemini", '"just a string"').kind).toBe("schema");
    expect(failureFrom("gemini", `[${GOOD_REPLY}]`).kind).toBe("schema");
  });

  it("rejects an object with no body field", () => {
    const failure = failureFrom("gemini", JSON.stringify({ message: GOOD_BODY }));
    expect(failure.kind).toBe("schema");
    expect(failure.message).toContain("message");
  });

  it("rejects extra fields alongside body", () => {
    const failure = failureFrom("gemini", JSON.stringify({ body: GOOD_BODY, thought: "hm" }));
    expect(failure.kind).toBe("schema");
    expect(failure.message).toContain("thought");
  });

  it("rejects a body production itself would reject", () => {
    // An em dash is a coach-voice rule `validateGeneratedBody` enforces — the canary inherits it
    // by calling that validator rather than re-listing its rules.
    const failure = failureFrom("gemini", JSON.stringify({ body: "You showed up — again." }));
    expect(failure.kind).toBe("schema");
    expect(failure.message).toContain("production would reject");
  });

  it("rejects a body that is not a string", () => {
    expect(failureFrom("gemini", JSON.stringify({ body: 12 })).kind).toBe("schema");
  });
});

describe("classifyAdapterError", () => {
  it("keeps the adapters' own truncation guard as a truncation", () => {
    const failure = classifyAdapterError(
      "gemini",
      new Error("Gemini truncated its response before finishing (MAX_TOKENS, thinkingTokens=1800)"),
    );
    expect(failure.kind).toBe("truncated");
    expect(failure.message).toContain("thinkingTokens=1800");
  });

  it("treats an empty candidate as a model failure, not a transport one", () => {
    expect(
      classifyAdapterError("openrouter", new Error("OpenRouter returned no content")).kind,
    ).toBe("unparseable");
  });

  it("treats an upstream status as transport, so a 503 is not read as model drift", () => {
    const failure = classifyAdapterError(
      "gemini",
      new Error("Gemini request failed (503): service unavailable"),
    );
    expect(failure.kind).toBe("transport");
  });

  it("treats an unknown throw as transport", () => {
    expect(classifyAdapterError("gemini", "socket hang up").kind).toBe("transport");
  });
});

describe("canary configuration", () => {
  it("names a required secret for both adapters", () => {
    // The workflow fails on a missing key rather than skipping that provider; this is the list
    // it checks against, so a new adapter with no key here would silently go untested.
    expect(ADAPTER_KEYS).toEqual({
      gemini: "GEMINI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    });
  });
});

describe("buildSmokePrompt", () => {
  it("puts the real projected fixture and the golden previous message into the prompt", async () => {
    const prompt = await buildSmokePrompt(new Date("2026-07-20T06:00:00.000Z"));
    // lastIndexOf, not indexOf: the instruction line above the block names the tag too.
    const start = prompt.lastIndexOf("<athlete_context>") + "<athlete_context>".length;
    const context = JSON.parse(
      prompt.slice(start, prompt.lastIndexOf("</athlete_context>")),
    ) as Record<string, unknown>;

    expect(context.previous_proactive_message).toEqual({
      created_at: "2026-07-20T00:05:00.000Z",
      body: "The quiet work landed. Nothing clever to add today, but I noticed.",
    });
    const batch = context.activity_batch as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(1);
    expect((batch[0].activity as Record<string, unknown>).name).toBe("Ranked court");
    // Injuries are filtered to active ones by the real projection, not by the fixture.
    expect(context.active_injuries).toHaveLength(1);
  });
});
