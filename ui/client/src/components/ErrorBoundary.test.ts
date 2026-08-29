/**
 * ErrorBoundary reporting — the render crash that used to leave no trace.
 *
 * React unwinds to the boundary before `window.onerror` fires, so nothing else in the client
 * would ever see this error. `componentDidCatch` is called directly: there is no DOM in this
 * suite, and the assertion is about what reaches Sentry, not about what renders.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorInfo } from "react";

const { captureReactException } = vi.hoisted(() => ({
  captureReactException: vi.fn((): string => "event-id"),
}));

vi.mock("@sentry/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/react")>()),
  captureReactException,
}));

const ErrorBoundary = (await import("./ErrorBoundary")).default;

const ERROR_INFO: ErrorInfo = { componentStack: "\n    at WarmHome\n    at ErrorBoundary" };

beforeEach(() => captureReactException.mockClear());

describe("ErrorBoundary", () => {
  it("reports the crash to Sentry with the React component stack", () => {
    const error = new Error("Cannot read properties of undefined (reading 'paces')");

    new ErrorBoundary({ children: null }).componentDidCatch(error, ERROR_INFO);

    expect(captureReactException).toHaveBeenCalledWith(error, ERROR_INFO, {
      mechanism: { handled: true, type: "auto.function.react.error_boundary" },
    });
  });

  it("still renders the fallback rather than swallowing the crash into a white page", () => {
    const error = new Error("boom");

    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ hasError: true, error });
  });
});
