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

process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");
process.env.GITHUB_APP_CLIENT_ID ??= "test-client-id";
process.env.GITHUB_APP_CLIENT_SECRET ??= "test-client-secret";

const { captureServerException, queueServerException, setAthleteScope, withSentryRoute } =
  vi.hoisted(() => ({
    captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
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
  }));

vi.mock("../../_lib/sentry.js", () => ({
  withSentryRoute,
  // session.ts reaches for this module directly - a cookie that will not decrypt is caught
  // below any route context - so a partial factory would leave it undefined at call time. It
  // queues rather than captures: it runs on every authenticated request and must not flush.
  captureServerException,
  queueServerException,
}));

const { default: handler } = await import("../[...action].js");

const SESSION_SECRET = process.env.SESSION_SECRET;

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
    const boom = new Error("token endpoint unreachable");
    fetchMock.mockRejectedValue(boom);

    const res = await handler.fetch(refreshRequest());

    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(502);
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

    // The athlete's answer is unchanged - they are signed out either way.
    expect(res.status).toBe(401);
    expect(captureServerException).toHaveBeenCalledOnce();
    expect((captureServerException.mock.calls[0][0] as Error).message).toContain("503");
  });

  it("does not capture a refresh token that simply expired or was revoked", async () => {
    // GitHub answers 200 with an `error` field when it rejects a grant. That is the expected
    // end of a 6-month session, not an incident: the athlete signs in again.
    fetchMock.mockResolvedValue(Response.json({ error: "bad_refresh_token" }));

    const res = await handler.fetch(refreshRequest());

    expect(res.status).toBe(401);
    expect(captureServerException).not.toHaveBeenCalled();
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

  it("does not capture a handled rejection - only a throw", async () => {
    // token_exchange_failed is an answer, not a fault: GitHub replied, the code was just bad.
    fetchMock.mockResolvedValue(Response.json({ error: "bad_verification_code" }));
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "web", popup: false },
      SESSION_SECRET,
    );
    const url = `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`;

    const res = await handler.fetch(new Request(url));

    expect(captureServerException).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("auth_error=token_exchange_failed");
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
