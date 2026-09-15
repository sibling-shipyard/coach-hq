/**
 * B16 (#1078): soft HEAD reads must capture non-404 faults and stay quiet on 404.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureServerException, fetchWithTimeout, withGithubSpan } = vi.hoisted(() => ({
  captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
  fetchWithTimeout: vi.fn(),
  withGithubSpan: vi.fn(
    async (_name: string, fn: (setStatus: (status: number) => void) => Promise<unknown>) => {
      return fn(() => {});
    },
  ),
}));

vi.mock("../../_lib/httpTimeout.js", () => ({ fetchWithTimeout, UPSTREAM_TIMEOUT_MS: 25_000 }));
vi.mock("../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/sentry.js")>();
  return { ...original, captureServerException, withGithubSpan };
});

import { getHeadShaOrNull } from "../_lib/decide/coachChatFiles.js";

describe("getHeadShaOrNull (B16)", () => {
  beforeEach(() => {
    captureServerException.mockClear();
    fetchWithTimeout.mockReset();
  });

  it("returns the sha on success without capturing", async () => {
    fetchWithTimeout.mockResolvedValueOnce(
      new Response(JSON.stringify({ object: { sha: "abc123" } }), { status: 200 }),
    );
    await expect(getHeadShaOrNull("owner/repo", "token")).resolves.toBe("abc123");
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("returns null quietly on 404", async () => {
    fetchWithTimeout.mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await expect(getHeadShaOrNull("owner/repo", "token")).resolves.toBeNull();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("captures once and returns null on a terminal GitHub 5xx", async () => {
    fetchWithTimeout.mockResolvedValueOnce(new Response("boom", { status: 503 }));
    await expect(getHeadShaOrNull("owner/repo", "token")).resolves.toBeNull();
    expect(captureServerException).toHaveBeenCalledTimes(1);
    const err = captureServerException.mock.calls[0]?.[0] as Error & { status?: number };
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(503);
  });
});
