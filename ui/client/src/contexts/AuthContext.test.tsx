/**
 * list-my-repos lookup failures — athlete sees auth_error; Sentry must get the cause.
 */
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { captureFetchFailure } from "@/lib/observability";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("../lib/devMode", () => ({
  isLocalDevBypass: false,
}));

vi.mock("../lib/observability", () => ({
  captureFetchFailure: vi.fn(),
  setAthleteUser: vi.fn(),
}));

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="errorType">{auth.errorType ?? ""}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(captureFetchFailure).mockClear();
});

beforeEach(() => {
  vi.mocked(captureFetchFailure).mockClear();
});

describe("AuthProvider list-my-repos", () => {
  it("captures a server refusal that becomes lookup_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/auth/me")) {
          return Response.json({ login: "athlete", repo_full_name: null });
        }
        if (url.includes("/api/auth/list-my-repos")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("auth_error");
    });
    expect(screen.getByTestId("errorType")).toHaveTextContent("lookup_failed");
    expect(captureFetchFailure).toHaveBeenCalledWith("/api/auth/list-my-repos", {
      kind: "server",
      status: 500,
      detail: undefined,
    });
  });

  it("captures a network drop on list-my-repos", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/auth/me")) {
          return Response.json({ login: "athlete", repo_full_name: null });
        }
        if (url.includes("/api/auth/list-my-repos")) {
          throw networkError;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("auth_error");
    });
    expect(captureFetchFailure).toHaveBeenCalledWith("/api/auth/list-my-repos", {
      kind: "network",
      error: networkError,
    });
  });

  it("does not capture the expected multiple_repos_granted block", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/auth/me")) {
          return Response.json({ login: "athlete", repo_full_name: null });
        }
        if (url.includes("/api/auth/list-my-repos")) {
          return new Response(JSON.stringify({ error: "multiple_repos_granted" }), {
            status: 409,
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("errorType")).toHaveTextContent("multiple_repos_granted");
    });
    expect(captureFetchFailure).not.toHaveBeenCalled();
  });
});
