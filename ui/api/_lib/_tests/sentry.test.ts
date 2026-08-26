import { describe, expect, it } from "vitest";
import { monitorServerRequest, operationIdFor } from "../sentry.js";

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
