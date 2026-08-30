/**
 * log.ts — console plus breadcrumb, and the copy of `data` that makes chat text unsafe here.
 *
 * `data` is attached to the current isolation scope. Any later capture on this request —
 * auth, GitHub write, close-turn — would carry it. ADR 0032 scoped chat text to failed
 * Gemini calls; this test is the proof that `log()` does not have a second filter.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { addBreadcrumb } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock("../sentry.js", () => ({
  Sentry: { addBreadcrumb },
}));

import { log } from "../log.js";

describe("log", () => {
  afterEach(() => {
    addBreadcrumb.mockClear();
    vi.restoreAllMocks();
  });

  it("writes the same payload to console and to a Sentry breadcrumb", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    log("coach-chat", "request", { mode: "ordinary", traceId: "ab12" });

    expect(consoleLog).toHaveBeenCalledWith("[coach-chat] request", {
      mode: "ordinary",
      traceId: "ab12",
    });
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: "coach-chat",
      message: "request",
      data: { mode: "ordinary", traceId: "ab12" },
      level: "info",
    });
  });

  it("omits data on the breadcrumb when none was passed", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    log("coach-chat", "response");
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: "coach-chat",
      message: "response",
      data: undefined,
      level: "info",
    });
  });
});
