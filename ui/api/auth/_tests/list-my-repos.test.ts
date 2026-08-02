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
      if (url.includes("/contents/user_data/ledger/challenge_v2.json")) {
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
      if (url.includes("/contents/user_data/ledger/challenge_v2.json")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    const body = await res.json();
    expect(body).toEqual({ candidates: [], reason: "no_marker_match" });
  });

  it("returns candidates without mutating the session when there are 2+ matches", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === ghUrl("/user/installations/42/repositories?per_page=100")) {
        return Response.json(
          mockRepoList([
            { full_name: "alice/coach-a", owner: "alice" },
            { full_name: "alice/coach-b", owner: "alice" },
          ]),
        );
      }
      if (url.includes("/contents/user_data/ledger/challenge_v2.json")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest());
    const body = await res.json();
    expect(body.candidates.sort()).toEqual(["alice/coach-a", "alice/coach-b"]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("persists an explicit ?select= pick via POST after confirming ownership + marker file", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/contents/user_data/ledger/challenge_v2.json")) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const res = await handler.fetch(await sessionRequest({}, "?select=alice%2Fcoach-b", "POST"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ repo_full_name: "alice/coach-b" });
    expect(res.headers.get("set-cookie")).toMatch(/^coach_session=/);
  });

  it("rejects a ?select= pick for a repo the caller doesn't own", async () => {
    const res = await handler.fetch(await sessionRequest({}, "?select=bob%2Fcoach-bob", "POST"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a GET with ?select= - mutating the session requires POST", async () => {
    const res = await handler.fetch(await sessionRequest({}, "?select=alice%2Fcoach-b", "GET"));
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
