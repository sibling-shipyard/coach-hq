import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decryptSession, SESSION_COOKIE } from "../_lib/session.js";
import { signOAuthState } from "../_lib/pkce.js";

process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");
process.env.GITHUB_APP_CLIENT_ID ??= "test-client-id";
process.env.GITHUB_APP_CLIENT_SECRET ??= "test-client-secret";

const { default: handler } = await import("../[...action].js");

const SESSION_SECRET = process.env.SESSION_SECRET;

function ghUrl(path: string): string {
  return `https://api.github.com${path}`;
}

async function makeCallbackUrl(
  code: string,
  data: { codeVerifier: string; platform: "web" | "ios"; popup: boolean },
): Promise<string> {
  const state = await signOAuthState(
    { codeVerifier: data.codeVerifier, platform: data.platform, popup: data.popup },
    SESSION_SECRET,
  );
  return `https://example.com/api/auth/callback?code=${code}&state=${encodeURIComponent(state)}`;
}

describe("callback.ts iOS error routing", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects corrupt_oauth_session to coachhq:// for iOS, not to the web homepage", async () => {
    // Sign the state with a WRONG secret so verifyOAuthState returns null,
    // but the payload still contains platform=ios.
    const wrongSecret = "wrong-secret";
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "ios", popup: false },
      wrongSecret,
    );
    const url = `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`;
    const res = await handler.fetch(new Request(url));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    // Must go to coachhq:// so the iOS WKWebView delegate can intercept it.
    expect(location).toMatch(/^coachhq:\/\/callback\?error=corrupt_oauth_session/);
    // Must NOT redirect to the web app homepage.
    expect(location).not.toMatch(/^\//);
    expect(location).not.toMatch(/auth_error/);
  });

  it("redirects missing_params to coachhq:// for iOS when state carries platform=ios", async () => {
    // No code param, but state encodes platform=ios.
    const state = await signOAuthState(
      { codeVerifier: "v", platform: "ios", popup: false },
      SESSION_SECRET,
    );
    const url = `https://example.com/api/auth/callback?state=${encodeURIComponent(state)}`;
    const res = await handler.fetch(new Request(url));
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^coachhq:\/\/callback\?error=missing_params/);
  });
});

describe("callback.ts web branch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sets a session cookie without repo_full_name, then redirects to popup-complete", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({
          access_token: "gh-token",
          refresh_token: "gh-refresh",
          expires_in: 28800,
        });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 1, login: "alice" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({
          installations: [{ id: 42, app_slug: "coach-phelps", account: { login: "alice" } }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "web", popup: true }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/auth/popup-complete?ok=1");

    const setCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
    const sessionCookie = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionCookie).toBeDefined();

    const token = decodeURIComponent(sessionCookie!.split(";")[0].split("=")[1]);
    const session = await decryptSession(token);
    // Documents the current (buggy) contract: the web branch never resolves a repo -
    // AuthContext.tsx is what calls list-my-repos.ts to fill this in afterward.
    expect(session?.repo_full_name).toBeUndefined();
    expect(session?.installation_id).toBe(42);
  });

  it("routes a web popup login with no installation to the needs_ios_setup dead-end", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({
          access_token: "gh-token",
          refresh_token: "gh-refresh",
          expires_in: 28800,
        });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 2, login: "brandnew" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({ installations: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "web", popup: true }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://example.com/auth/popup-complete?error=needs_ios_setup",
    );
  });
});

describe("callback.ts iOS success/setup branches", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redirects to coachhq://callback with a token and the resolved repo on success", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "gh-token", refresh_token: "gh-refresh", expires_in: 28800 });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 3, login: "ios-user" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({
          installations: [{ id: 99, app_slug: "coach-phelps", account: { login: "ios-user" } }],
        });
      }
      if (url === ghUrl("/user/installations/99/repositories?per_page=100")) {
        return Response.json({
          repositories: [{ full_name: "ios-user/coach-ios-user", name: "coach-ios-user", owner: { login: "ios-user" } }],
        });
      }
      if (url === ghUrl("/repos/ios-user/coach-ios-user/contents/.coach-engine-version")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "ios", popup: false }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^coachhq:\/\/callback\?token=gh-token/);
    expect(location).toContain("login=ios-user");
    expect(location).toContain(`repo=${encodeURIComponent("ios-user/coach-ios-user")}`);
  });

  it("resolves a pre-pin repo via the legacy ledger marker when .coach-engine-version 404s", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "gh-token", refresh_token: "gh-refresh", expires_in: 28800 });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 3, login: "ios-user" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({
          installations: [{ id: 99, app_slug: "coach-phelps", account: { login: "ios-user" } }],
        });
      }
      if (url === ghUrl("/user/installations/99/repositories?per_page=100")) {
        return Response.json({
          repositories: [{ full_name: "ios-user/coach-ios-user", name: "coach-ios-user", owner: { login: "ios-user" } }],
        });
      }
      if (url === ghUrl("/repos/ios-user/coach-ios-user/contents/.coach-engine-version")) {
        return new Response(null, { status: 404 });
      }
      if (url === ghUrl("/repos/ios-user/coach-ios-user/contents/user_data/ledger/challenge_v2.json")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "ios", popup: false }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`repo=${encodeURIComponent("ios-user/coach-ios-user")}`);
  });

  it("does not hand iOS a repo when neither marker is present", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "gh-token", refresh_token: "gh-refresh", expires_in: 28800 });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 3, login: "ios-user" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({
          installations: [{ id: 99, app_slug: "coach-phelps", account: { login: "ios-user" } }],
        });
      }
      if (url === ghUrl("/user/installations/99/repositories?per_page=100")) {
        return Response.json({
          repositories: [{ full_name: "ios-user/some-other-repo", name: "some-other-repo", owner: { login: "ios-user" } }],
        });
      }
      if (url.includes("/contents/")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "ios", popup: false }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^coachhq:\/\/callback\?token=gh-token/);
    expect(location).not.toContain("repo=");
  });

  it("redirects to coachhq://callback?needs_setup=1 with a token when there's no installation yet", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "gh-token", refresh_token: "gh-refresh", expires_in: 28800 });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 4, login: "brandnew-ios" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({ installations: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const req = new Request(
      await makeCallbackUrl("abc", { codeVerifier: "verifier", platform: "ios", popup: false }),
    );

    const res = await handler.fetch(req);
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^coachhq:\/\/callback\?needs_setup=1/);
    expect(location).toContain("login=brandnew-ios");
    expect(location).toContain("token=gh-token");
  });
});

describe("handleStart -> handleCallback round trip", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs state in handleStart with the same secret handleCallback verifies it with", async () => {
    const startReq = new Request("https://example.com/api/auth/start?platform=ios");
    const startRes = await handler.fetch(startReq);
    expect(startRes.status).toBe(302);
    const authorizeUrl = new URL(startRes.headers.get("location")!);
    expect(authorizeUrl.origin).toBe("https://github.com");
    const state = authorizeUrl.searchParams.get("state")!;
    expect(state).toBeTruthy();

    fetchMock.mockImplementation(async (url: string) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "gh-token", refresh_token: "gh-refresh", expires_in: 28800 });
      }
      if (url === ghUrl("/user")) {
        return Response.json({ id: 5, login: "roundtrip-user" });
      }
      if (url === ghUrl("/user/installations")) {
        return Response.json({ installations: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const callbackReq = new Request(
      `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    );
    const callbackRes = await handler.fetch(callbackReq);
    expect(callbackRes.status).toBe(302);
    const location = callbackRes.headers.get("location") ?? "";
    // A mismatch in handleStart's state generation vs handleCallback's verification would
    // produce a corrupt_oauth_session redirect instead of reaching this branch.
    expect(location).toMatch(/^coachhq:\/\/callback\?needs_setup=1/);
  });
});

describe("callback.ts config_error routing", () => {
  it("routes iOS to coachhq:// (not the web homepage) when CLIENT_ID/CLIENT_SECRET are unset", async () => {
    vi.resetModules();
    const prevId = process.env.GITHUB_APP_CLIENT_ID;
    const prevSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    delete process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    try {
      const { default: misconfiguredHandler } = await import("../[...action].js");
      const state = await signOAuthState({ codeVerifier: "v", platform: "ios", popup: false }, SESSION_SECRET);
      const req = new Request(
        `https://example.com/api/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      );
      const res = await misconfiguredHandler.fetch(req);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("coachhq://callback?error=config_error");
    } finally {
      process.env.GITHUB_APP_CLIENT_ID = prevId;
      process.env.GITHUB_APP_CLIENT_SECRET = prevSecret;
      vi.resetModules();
    }
  });
});
