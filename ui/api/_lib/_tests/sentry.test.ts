import { describe, expect, it } from "vitest";
import {
  recordGeminiResult,
  Sentry,
  monitorServerRequest,
  operationIdFor,
} from "../sentry.js";

describe("operationIdFor", () => {
  it("preserves a valid client operation id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const req = new Request("https://example.com/api/coach-chat", {
      headers: { "x-operation-id": id },
    });

    expect(operationIdFor(req)).toBe(id);
  });

  it("creates a server fallback when the header is missing or invalid", () => {
    const missing = operationIdFor(
      new Request("https://example.com/api/coach-chat"),
    );
    const invalid = operationIdFor(
      new Request("https://example.com/api/coach-chat", {
        headers: { "x-operation-id": "not-a-uuid" },
      }),
    );

    expect(missing).toMatch(/^[0-9a-f-]{36}$/);
    expect(invalid).toMatch(/^[0-9a-f-]{36}$/);
    expect(invalid).not.toBe(missing);
  });

  it("returns the same fallback id to the caller", async () => {
    const response = await monitorServerRequest(
      new Request("https://example.com/api/repo-file"),
      "test request",
      async () => Response.json({ ok: true }),
    );

    expect(response.headers.get("x-operation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("recordGeminiResult", () => {
  // ADR 0031 bars athlete and model text from Sentry. Asserting the exact key set means
  // adding a text field here fails the suite instead of shipping a transcript.
  it("attaches counts and the model name only, never chat text", () => {
    const { before, after } = Sentry.withIsolationScope((scope) => {
      const before = scope.getScopeData();
      const beforeKeys = {
        tags: Object.keys(before.tags),
        extra: Object.keys(before.extra),
      };
      recordGeminiResult({
        model: "gemini-2.5-pro",
        promptTokens: 1200,
        completionTokens: 300,
        replyChars: 812,
      });
      return { before: beforeKeys, after: scope.getScopeData() };
    });

    const addedTags = Object.keys(after.tags).filter(
      (key) => !before.tags.includes(key),
    );
    const addedExtra = Object.keys(after.extra).filter(
      (key) => !before.extra.includes(key),
    );

    expect(addedTags.sort()).toEqual(["model"]);
    expect(addedExtra.sort()).toEqual([
      "completion_tokens",
      "gemini_reply_chars",
      "prompt_tokens",
    ]);
    expect(
      addedExtra.every((key) => typeof after.extra[key] === "number"),
    ).toBe(true);
  });
});
