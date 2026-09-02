import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionPayload } from "../_lib/session.js";

process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");
process.env.GITHUB_APP_CLIENT_ID ??= "test-client-id";
process.env.GITHUB_APP_CLIENT_SECRET ??= "test-client-secret";

// session.ts reads CLIENT_ID/CLIENT_SECRET from process.env at module-eval time, so this must
// stay a dynamic import after the env vars above are set (same pattern as callback.test.ts) - a
// static import would hoist above these assignments and see empty strings.
const { encryptSession, ensureFreshSession, SESSION_COOKIE } = await import("../_lib/session.js");

function requestWithCookie(rawCookie: string): Request {
  return new Request("https://example.com/api/whatever", {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(rawCookie)}` },
  });
}

const STALE_SESSION: SessionPayload = {
  github_user_id: 1,
  login: "date2022",
  gh_token: "stale-token",
  refresh_token: "stale-refresh-token",
  // Already past REFRESH_BUFFER_MS, so every call below takes the refresh branch.
  gh_token_expires_at: Date.now() - 1000,
  installation_id: 42,
  repo_full_name: "date2022/coach-date2022",
};

describe("ensureFreshSession concurrent refresh (#804)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one in-flight refresh across concurrent calls carrying the same stale cookie", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      expect(url).toBe("https://github.com/login/oauth/access_token");
      callCount++;
      // Hold the response open briefly so all concurrent callers land inside the
      // refresh window before any of them resolves - this is what makes the race
      // reproducible instead of accidentally serialized.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({
        access_token: `fresh-token-${callCount}`,
        refresh_token: `fresh-refresh-${callCount}`,
        expires_in: 28800,
      });
    });

    const rawCookie = await encryptSession(STALE_SESSION);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureFreshSession(requestWithCookie(rawCookie))),
    );

    // Exactly one exchange with GitHub, not five - the fix this test guards.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const result of results) {
      expect("session" in result).toBe(true);
      const fresh = result as Exclude<typeof result, Response>;
      expect(fresh.session.gh_token).toBe("fresh-token-1");
      expect(fresh.session.refresh_token).toBe("fresh-refresh-1");
    }
  });

  it("still refreshes once for a later independent call after the in-flight one settles", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(async () => {
      callCount++;
      return Response.json({
        access_token: `fresh-token-${callCount}`,
        refresh_token: `fresh-refresh-${callCount}`,
        expires_in: 28800,
      });
    });

    const rawCookie = await encryptSession(STALE_SESSION);
    const first = await ensureFreshSession(requestWithCookie(rawCookie));
    // Second call reuses the same still-stale raw cookie (as a client would if it hadn't
    // picked up the rotated Set-Cookie yet) - the in-flight entry from the first call must
    // already be cleared, so this is a fresh, independent refresh rather than a stuck cache.
    const second = await ensureFreshSession(requestWithCookie(rawCookie));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect("session" in first && first.session.gh_token).toBe("fresh-token-1");
    expect("session" in second && second.session.gh_token).toBe("fresh-token-2");
  });
});
