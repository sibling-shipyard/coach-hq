/**
 * Tracing and error capture for the auth catch-all.
 *
 * `sentry.ts` itself is proved against a real SDK in `api/_lib/_tests/sentry-spans.test.ts`.
 * What is unproved there is this route's wiring, and the catch-all makes that its own question:
 * one file answers seven URLs, several of its handlers turn a fault into a redirect or a status
 * rather than throwing it, and identity is established inside it rather than read at the top. So
 * the three helpers are faked here and the assertions are about which of them each action calls,
 * including on the paths where nothing ever throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EncryptJWT } from "jose";
import { encryptSession, buildCookie, SESSION_COOKIE } from "../_lib/session.js";
import { signOAuthState } from "../_lib/pkce.js";
import { InstallationLookupFailedError, MarkerLookupFailedError } from "../_lib/repo-resolution.js";

// session.ts latches CLIENT_ID/SECRET at module load; vi.hoisted runs before static imports.
const {
  captureServerException,
  captureServerMessage,
  queueServerException,
  setAthleteScope,
  withSentryRoute,
} = vi.hoisted(() => {
  process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");
  process.env.GITHUB_APP_CLIENT_ID ??= "test-client-id";
  process.env.GITHUB_APP_CLIENT_SECRET ??= "test-client-secret";
  return {
    captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
    captureServerMessage: vi.fn(async (_message: string, _options?: unknown) => ({ sent: true })),
    queueServerException: vi.fn((_error: unknown) => "event-id"),
    setAthleteScope: vi.fn(),
    withSentryRoute: vi.fn(
      async (
        _req: Request,
        handler: (sentry: {
          captureException: typeof captureServerException;
          setAthleteScope: typeof setAthleteScope;
        }) => Promise<unknown>,
      ) => handler({ captureException: captureServerException, setAthleteScope }),
    ),
  };
});

vi.mock("../../_lib/sentry.js", () => ({
  withSentryRoute,
  // session.ts reaches for this module directly - a cookie that will not decrypt is caught
  // below any route context - so a partial factory would leave it undefined at call time. It
  // queues rather than captures: it runs on every authenticated request and must not flush.
  captureServerException,
  captureServerMessage,
  queueServerException,
}));

const { default: handler } = await import("../[...action].js");

const SESSION_SECRET = process.env.SESSION_SECRET!;

async function sessionCookie(repoFullName?: string): Promise<string> {
  const token = await encryptSession({
    github_user_id: 1,
    login: "alice",
    gh_token: "gh-token",
    refresh_token: "refresh-token",
    // Comfortably inside the refresh buffer, so ensureFreshSession never calls GitHub.
    gh_token_expires_at: Date.now() + 60 * 60 * 1000,
    installation_id: 42,
    ...(repoFullName ? { repo_full_name: repoFullName } : {}),
  });
  return buildCookie(SESSION_COOKIE, token, 1000).split(";")[0];
}

/** Inside the 5min refresh buffer so ensureFreshSession attempts a token exchange. */
async function nearExpirySessionCookie(repoFullName?: string): Promise<string> {
  const token = await encryptSession({
    github_user_id: 1,
    login: "alice",
    gh_token: "gh-token",
    refresh_token: "refresh-token",
    gh_token_expires_at: Date.now() + 60 * 1000,
    installation_id: 42,
    ...(repoFullName ? { repo_full_name: repoFullName } : {}),
  });
  return buildCookie(SESSION_COOKIE, token, 1000).split(";")[0];
}

/** A cookie encrypted with this key but already past its `exp` - jose codes it ERR_JWT_EXPIRED. */
async function expiredSessionCookie(): Promise<string> {
  const key = Uint8Array.from(Buffer.from(SESSION_SECRET, "base64"));
  const token = await new EncryptJWT({ login: "alice" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .encrypt(key);
  return buildCookie(SESSION_COOKIE, token, 1000).split(";")[0];
}

function authRequest(action: string, cookie?: string, method = "GET"): Request {
  return new Request(`https://example.com/api/auth/${action}`, {
    method,
    headers: cookie ? { cookie } : {},
  });
}

function refreshRequest(): Request {
  return new Request("https://example.com/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: "rt" }),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth catch-all tracing", () => {
  it("wraps every action, including the unknown one, in the route's span", async () => {
    for (const action of ["logout", "me", "refresh", "list-my-repos", "not-an-action"]) {
      await handler.fetch(authRequest(action));
    }

    expect(withSentryRoute).toHaveBeenCalledTimes(5);
    // The wrapper reads the URL for the span name, so it has to get the request, not just a
    // closure over it.
    expect(withSentryRoute.mock.calls[0][0]).toBeInstanceOf(Request);
  });
});

describe("auth catch-all error capture", () => {
  it("captures a throw that list-my-repos would otherwise swallow into a 502", async () => {
    const boom = new Error("GitHub is down");
    fetchMock.mockRejectedValue(boom);

    const res = await handler.fetch(
      authRequest("list-my-repos", await sessionCookie("alice/coach-alice")),
    );

    expect(captureServerException).toHaveBeenCalledWith(boom);
    // The athlete's answer is unchanged - capture is additional, not a new failure mode.
    expect(res.status).toBe(502);
  });

  it("captures a throw that callback would otherwise swallow into a network_error redirect", async () => {
    const boom = new Error("token endpoint unreachable");
    fetchMock.mockRejectedValue(boom);
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );
    const url = `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`;

    const res = await handler.fetch(new Request(url));

    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("auth_error=network_error");
  });

  it("captures an installation lookup outage before callback redirects", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: "gh-token",
          refresh_token: "gh-refresh",
          expires_in: 28800,
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: 1, login: "alice" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );

    const res = await handler.fetch(
      new Request(
        `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      ),
    );

    expect(res.headers.get("location")).toContain("auth_error=lookup_failed");
    expect(captureServerException).toHaveBeenCalledOnce();
    expect(captureServerException.mock.calls[0][0]).toBeInstanceOf(InstallationLookupFailedError);
  });

  it("captures a bearer installation lookup outage before returning 502", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 1, login: "alice" }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const res = await handler.fetch(
      new Request("https://example.com/api/auth/list-my-repos", {
        headers: { authorization: "Bearer gh-token" },
      }),
    );

    expect(res.status).toBe(502);
    expect(captureServerException).toHaveBeenCalledOnce();
    expect(captureServerException.mock.calls[0][0]).toBeInstanceOf(InstallationLookupFailedError);
  });

  it("captures a marker lookup outage before returning 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const res = await handler.fetch(authRequest("list-my-repos", await sessionCookie()));

    expect(res.status).toBe(502);
    expect(captureServerException).toHaveBeenCalledOnce();
    expect(captureServerException.mock.calls[0][0]).toBeInstanceOf(MarkerLookupFailedError);
  });

  it("captures a throw that refresh would otherwise swallow into a 502", async () => {
    // The busiest swallowing path in the file - every session refresh runs it.
    // After retries exhaust (#1069), the last network error is what Sentry sees once.
    const boom = new Error("token endpoint unreachable");
    fetchMock.mockRejectedValue(boom);

    const res = await handler.fetch(refreshRequest());

    expect(captureServerException).toHaveBeenCalledOnce();
    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("captures the /user failure that callback turns into a redirect, not a throw", async () => {
    // Returned, never thrown: without this capture the athlete lands on auth_error and Sentry
    // holds nothing. The token was minted one call earlier, so /user refusing it is a fault.
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          access_token: "gh-token",
          refresh_token: "gh-refresh",
          expires_in: 28800,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );

    const res = await handler.fetch(
      new Request(
        `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      ),
    );

    expect(res.headers.get("location")).toContain("auth_error=user_fetch_failed");
    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("503");
  });

  it("captures a refresh that failed because GitHub did, not because the grant died", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    const res = await handler.fetch(refreshRequest());

    // Transient upstream failure is 502 so iOS can back off — never 401 (#1069).
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "network_error" });
    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("503");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a transient GitHub refresh blip then returns tokens", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(
      Response.json({
        access_token: "gho_new",
        refresh_token: "ghr_new",
        expires_in: 28800,
      }),
    );

    const res = await handler.fetch(refreshRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: "gho_new",
      refresh_token: "ghr_new",
      expires_in: 28800,
    });
    expect(captureServerException).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats an empty 200 refresh body as transient 502, not logout", async () => {
    // GitHub sometimes answers 200 with neither tokens nor an error field (#1069).
    fetchMock.mockResolvedValue(Response.json({}));

    const res = await handler.fetch(refreshRequest());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "network_error" });
    expect(captureServerException).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not capture a refresh token that simply expired or was revoked", async () => {
    // GitHub answers 200 with an `error` field when it rejects a grant. That is the expected
    // end of a 6-month session, not an incident: the athlete signs in again.
    fetchMock.mockResolvedValue(Response.json({ error: "bad_refresh_token" }));

    const res = await handler.fetch(refreshRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "refresh_failed" });
    expect(captureServerException).not.toHaveBeenCalled();
    // Dead grant must not burn retries — the token will not heal.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queues a session cookie that will not decrypt, without flushing", async () => {
    // A rotated SESSION_SECRET and a tampered cookie both land here, and both look exactly like
    // "not signed in" to the athlete. It queues: decryptSession runs on every authenticated
    // request, so an awaited flush here would stall all of them on the very failure it reports.
    const res = await handler.fetch(authRequest("me", `${SESSION_COOKIE}=not-a-real-jwe-at-all`));

    expect(res.status).toBe(401);
    expect(queueServerException).toHaveBeenCalledOnce();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("does not report a session cookie that only aged out", async () => {
    const res = await handler.fetch(authRequest("me", await expiredSessionCookie()));

    expect(res.status).toBe(401);
    expect(queueServerException).not.toHaveBeenCalled();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("captures token_exchange_failed before callback redirects", async () => {
    // Athlete lands on auth_error with no other record; mirror the /user capture below.
    fetchMock.mockResolvedValue(Response.json({ error: "bad_verification_code" }));
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );
    const url = `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`;

    const res = await handler.fetch(new Request(url));

    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain(
      "token exchange failed",
    );
    expect(res.headers.get("location")).toContain("auth_error=token_exchange_failed");
  });

  it("captures a token exchange missing refresh_token before redirect", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        access_token: "gh-token",
        // refresh_token / expires_in absent — App must mint both for rotation.
      }),
    );
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );

    const res = await handler.fetch(
      new Request(
        `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      ),
    );

    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("refresh_token");
    expect(res.headers.get("location")).toContain("auth_error=token_exchange_failed");
  });

  it("captures installations-repo re-fetch failure before serving empty candidates", async () => {
    // resolveOwnedRepos succeeds with zero confirmed; the reason re-fetch then fails.
    // Soft-fallback still returns no_owned_repos — capture is additional, not a new failure mode.
    fetchMock
      .mockResolvedValueOnce(Response.json({ repositories: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    const res = await handler.fetch(authRequest("list-my-repos", await sessionCookie()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [], reason: "no_owned_repos" });
    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("503");
  });

  it("fires one warning when ensureFreshSession soft-falls back after refresh fails", async () => {
    // Two exchange attempts fail; athlete keeps the still-valid cookie. One warning for the
    // attempt-cycle — never per try inside it (B17 soft-fallback contract).
    fetchMock.mockRejectedValue(new Error("token endpoint unreachable"));

    const res = await handler.fetch(
      authRequest("me", await nearExpirySessionCookie("alice/coach-alice")),
    );

    expect(res.status).toBe(200);
    expect(captureServerMessage).toHaveBeenCalledOnce();
    expect(captureServerMessage).toHaveBeenCalledWith(
      expect.stringContaining("soft-fallback"),
      expect.objectContaining({ level: "warning" }),
    );
    expect(captureServerException).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("captures config_error when CLIENT_ID is unset on start", async () => {
    vi.resetModules();
    const prevId = process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_ID;
    try {
      const { default: misconfiguredHandler } = await import("../[...action].js");
      const res = await misconfiguredHandler.fetch(authRequest("start"));

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("auth_error=config_error");
      expect(captureServerException).toHaveBeenCalledOnce();
      expect((captureServerException.mock.calls[0][0] as Error).message).toContain(
        "Site misconfigured",
      );
    } finally {
      process.env.GITHUB_APP_CLIENT_ID = prevId;
      vi.resetModules();
    }
  });
});

describe("auth catch-all athlete identity", () => {
  it("tags /me with the repo once the session has resolved one", async () => {
    const res = await handler.fetch(authRequest("me", await sessionCookie("alice/coach-alice")));

    expect(res.status).toBe(200);
    expect(setAthleteScope).toHaveBeenCalledWith("alice/coach-alice");
  });

  it("leaves a session that has not resolved a repo anonymous", async () => {
    const res = await handler.fetch(authRequest("me", await sessionCookie()));

    expect(res.status).toBe(200);
    expect(setAthleteScope).not.toHaveBeenCalled();
  });

  it("leaves pre-auth actions anonymous", async () => {
    // No cookie, no bearer: nothing here knows whose request this is.
    await handler.fetch(authRequest("start"));
    await handler.fetch(authRequest("me"));
    await handler.fetch(authRequest("list-my-repos"));

    expect(setAthleteScope).not.toHaveBeenCalled();
  });

  it("tags list-my-repos before the work that can throw, so a 502 carries the athlete", async () => {
    fetchMock.mockRejectedValue(new Error("GitHub is down"));

    await handler.fetch(authRequest("list-my-repos", await sessionCookie("alice/coach-alice")));

    expect(setAthleteScope).toHaveBeenCalledWith("alice/coach-alice");
    expect(setAthleteScope.mock.invocationCallOrder[0]).toBeLessThan(
      captureServerException.mock.invocationCallOrder[0],
    );
  });

  it("tags the athlete when list-my-repos establishes the repo", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/repositories?per_page=100")) {
        return Response.json({
          repositories: [
            {
              full_name: "alice/coach-alice",
              name: "coach-alice",
              owner: { login: "alice" },
            },
          ],
        });
      }
      if (url.endsWith("/contents/.coach-engine-version")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await handler.fetch(authRequest("list-my-repos", await sessionCookie()));

    expect(setAthleteScope).toHaveBeenCalledWith("alice/coach-alice");
  });
});
