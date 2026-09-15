/**
 * Welcome waitlist submit — inline error copy is what the athlete sees; Sentry is what we need.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { captureFetchFailure } from "@/lib/observability";
import { WelcomeInviteCta } from "./WelcomeInviteCta";

vi.mock("@/lib/observability", () => ({
  captureFetchFailure: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(captureFetchFailure).mockClear();
});

beforeEach(() => {
  vi.mocked(captureFetchFailure).mockClear();
});

async function submitInvite(email = "friend@example.com"): Promise<void> {
  render(<WelcomeInviteCta />);
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: email } });
  fireEvent.submit(screen.getByRole("button", { name: /Request my invite/i }).closest("form")!);
}

describe("WelcomeInviteCta", () => {
  it("captures a waitlist refusal the athlete sees as inline error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await submitInvite();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/COULDN'T SAVE RIGHT NOW/i);
    });
    expect(captureFetchFailure).toHaveBeenCalledTimes(1);
    expect(captureFetchFailure).toHaveBeenCalledWith("/api/waitlist", {
      kind: "server",
      status: 503,
    });
  });

  it("captures a waitlist network drop the same way", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError));

    await submitInvite();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/COULDN'T SAVE RIGHT NOW/i);
    });
    expect(captureFetchFailure).toHaveBeenCalledWith("/api/waitlist", {
      kind: "network",
      error: networkError,
    });
  });

  it("stays quiet on a successful signup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await submitInvite();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/SAVED/i);
    });
    expect(captureFetchFailure).not.toHaveBeenCalled();
  });
});
