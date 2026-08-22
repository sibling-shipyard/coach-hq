import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptSession, buildCookie, SESSION_COOKIE, type SessionPayload } from "../_lib/session.js";

process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");

const { default: handler } = await import("../[...action].js");

function ghUrl(path: string): string {
  return `https://api.github.com${path}`;
}

async function sessionRequest(
  overrides: Partial<SessionPayload> = {},
  search = "",
  method = "GET",
): Promise<Request> {
  const payload: SessionPayload = {
    github_user_id: 1,
    login: "alice",
    gh_token: "gh-token",
    refresh_token: "refresh-token",
    gh_token_expires_at: Date.now() + 60 * 60 * 1000,
    installation_id: 42,
    ...overrides,
  };
  const token = await encryptSession(payload);
  const cookie = buildCookie(SESSION_COOKIE, token, 1000);
  return new Request(`https://example.com/api/auth/list-my-repos${search}`, {
    method,
    headers: { cookie: cookie.split(";")[0] },
  });
}

const MARKER = "/contents/.coach-engine-version";
const LEGACY_MARKER = "/contents/user_data/ledger/challenge_v2.json";

function mockRepoList(repos: Array<{ full_name: string; owner: string }>) {
  return {
    repositories: repos.map((r) => ({
      full_name: r.full_name,
      name: r.full_name.split("/")[1],
      owner: { login: r.owner },
    })),
  };
}

describe("list-my-repos", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("auto-selects and persists the single owned+marker-matched repo", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ repo_full_name: "alice/coach-alice" });
    expect(res.headers.get("set-cookie")).toMatch(/^coach_session=/);
  });

  it("resolves a migrated repo that has only .coach-engine-version, no legacy ledger file (#471)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) return new Response(null, { status: 200 });
      if (url.includes(LEGACY_MARKER)) return new Response(null, { status: 404 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo_full_name: "alice/coach-alice" });
    // The legacy path is a 404-only fallback - a hit on the pin must not trigger it.
    expect(fetchMock.mock.calls.some(([u]: [string]) => u.includes(LEGACY_MARKER))).toBe(false);
  });

  it("still resolves a pre-pin repo that has only the legacy ledger marker", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) return new Response(null, { status: 404 });
      if (url.includes(LEGACY_MARKER)) return new Response(null, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo_full_name: "alice/coach-alice" });
  });

  it("surfaces a transient failure on the pin check as a 502, not a silent miss", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) return new Response(null, { status: 403 });
      // A rate-limited pin check must never fall through to the legacy path - if it did,
      // this 404 would turn a transient hiccup into "your repo isn't set up".
      if (url.includes(LEGACY_MARKER)) return new Response(null, { status: 404 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to check your repos - try again" });
    expect(fetchMock.mock.calls.some(([u]: [string]) => u.includes(LEGACY_MARKER))).toBe(false);
  });

  it("surfaces a 5xx on the legacy fallback as a 502 too", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) return new Response(null, { status: 404 });
      if (url.includes(LEGACY_MARKER)) return new Response(null, { status: 500 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to check your repos - try again" });
  });

  it("reports no_owned_repos when the account owns nothing granted to the install", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([]));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    const body = await res.json();
    expect(body).toEqual({ candidates: [], reason: "no_owned_repos" });
  });

  it("reports no_marker_match when owned repos exist but none carry the marker file", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/some-other-repo", owner: "alice" }]));
      }
      if (url.includes(MARKER) || url.includes(LEGACY_MARKER)) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    const body = await res.json();
    expect(body).toEqual({ candidates: [], reason: "no_marker_match" });
  });

  it("blocks with multiple_repos_granted when there are 2+ matches (ADR 0019) - no picker", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(
          mockRepoList([
            { full_name: "alice/coach-a", owner: "alice" },
            { full_name: "alice/coach-b", owner: "alice" },
          ]),
        );
      }
      if (url.includes(MARKER)) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "multiple_repos_granted" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("ignores a stray ?select= param - the picker path is gone, so it's just a normal resolve", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest({}, "?select=alice%2Fcoach-b", "POST"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ repo_full_name: "alice/coach-alice" });
  });

  it("does not re-resolve when the cached repo's marker check fails transiently", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(MARKER)) return new Response(null, { status: 403 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest({ repo_full_name: "alice/coach-alice" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to check your repos - try again" });
    // The point of the fix: a rate-limited re-confirm must NOT fan out into a full re-resolve
    // (repo list + a marker check per owned repo) while GitHub is already refusing us.
    expect(
      fetchMock.mock.calls.some(([u]: [string]) => u.includes("/repositories?per_page=100")),
    ).toBe(false);
  });

  it("still re-resolves when the cached repo's marker is genuinely gone", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/repos/alice/coach-old/contents/")) return new Response(null, { status: 404 });
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(mockRepoList([{ full_name: "alice/coach-alice", owner: "alice" }]));
      }
      if (url.includes(MARKER)) return new Response(null, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest({ repo_full_name: "alice/coach-old" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repo_full_name: "alice/coach-alice" });
  });
});
