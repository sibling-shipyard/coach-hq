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
  data: { nonce?: string; codeVerifier: string; platform: "web" | "ios"; popup: boolean },
): Promise<string> {
  const state = await signOAuthState(
    { nonce: data.nonce ?? "test-nonce", codeVerifier: data.codeVerifier, platform: data.platform, popup: data.popup },
    SESSION_SECRET,
  );
  return `https://example.com/api/auth/callback?code=${code}&state=${encodeURIComponent(state)}`;
}

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
