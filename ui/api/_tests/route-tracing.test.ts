/**
 * Tracing and error capture for the five routes that carry no coach turn.
 *
 * `sentry.ts` itself is proved against a real SDK in `_lib/_tests/sentry-spans.test.ts`. What is
 * unproved there is each route's wiring, and these five differ from each other in the one way
 * that matters: four read an athlete's identity and one has no auth at all. So the helpers are
 * faked here and the assertions are about which of them each route calls, and when.
 *
 * The routes' own dependencies are faked too - the point is the wrapper, not GitHub.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encryptSession, buildCookie, SESSION_COOKIE } from "../auth/_lib/session.js";

process.env.SESSION_SECRET ??= Buffer.alloc(32, 7).toString("base64");

const REPO = "alice/coach-alice";

const {
  captureServerException,
  setAthleteScope,
  withSentryRoute,
  loadCoachContext,
  isAthleteProfileComplete,
  getFileRaw,
  fetchRepoDashboardSnapshot,
  commitFilesAtomic,
} = vi.hoisted(() => ({
  captureServerException: vi.fn(async () => ({ sent: true })),
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
  loadCoachContext: vi.fn(),
  isAthleteProfileComplete: vi.fn(() => true),
  getFileRaw: vi.fn(async () => null),
  fetchRepoDashboardSnapshot: vi.fn(),
  commitFilesAtomic: vi.fn(),
}));

vi.mock("../_lib/sentry.js", () => ({
  withSentryRoute,
  // session.ts captures a cookie that will not decrypt through the module directly, not through
  // the route context, so a partial factory here would leave it undefined at call time.
  captureServerException,
}));
vi.mock("../coach-chat/_lib/coachChatFiles.js", () => ({
  loadCoachContext,
  isAthleteProfileComplete,
  getFileRaw,
}));
vi.mock("../auth/_lib/github-dashboard-snapshot.js", () => ({ fetchRepoDashboardSnapshot }));
vi.mock("../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

const { default: coachChatContext } = await import("../coach-chat-context.js");
const { default: profileStatus } = await import("../coach-chat-profile-status.js");
const { default: repoFile } = await import("../repo-file.js");
const { default: waitlist } = await import("../waitlist.js");
const { default: widgetSnapshots } = await import("../widget-snapshots.js");

/** iOS's auth mode: a Bearer token plus the repo, so nothing has to be decrypted or fetched. */
function bearerRequest(path: string): Request {
  return new Request(`https://example.com/api/${path}`, {
    headers: { authorization: "Bearer gh-token", "x-coach-repo": REPO },
  });
}

async function cookieRequest(path: string, repoFullName?: string): Promise<Request> {
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
  return new Request(`https://example.com/api/${path}`, {
    headers: { cookie: buildCookie(SESSION_COOKIE, token, 1000).split(";")[0] },
  });
}

function waitlistRequest(): Request {
  return new Request("https://example.com/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "someone@example.com" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isAthleteProfileComplete.mockReturnValue(true);
  getFileRaw.mockResolvedValue(null);
  process.env.WAITLIST_GITHUB_TOKEN = "waitlist-token";
  process.env.WAITLIST_GITHUB_REPO = "sibling-shipyard/coach-phelps-hq";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every route opens the span", () => {
  it("wraps all five, including the ones that answer before doing any work", async () => {
    loadCoachContext.mockResolvedValue({ profile: null, memory: null, seasons: null });
    fetchRepoDashboardSnapshot.mockResolvedValue({ error: "not found", status: 404 });
    commitFilesAtomic.mockResolvedValue(undefined);

    await coachChatContext.fetch(bearerRequest("coach-chat-context"));
    await profileStatus.fetch(bearerRequest("coach-chat-profile-status"));
    await repoFile.fetch(await cookieRequest("repo-file"));
    await waitlist.fetch(waitlistRequest());
    await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(withSentryRoute).toHaveBeenCalledTimes(5);
    // The wrapper reads the URL for the span name, so it has to get the request itself. The
    // repo-file call above never reaches GitHub - that session has no repo - and is still wrapped.
    expect(withSentryRoute.mock.calls[0][0]).toBeInstanceOf(Request);
  });
});

describe("routes that read an athlete", () => {
  it("tags coach-chat-context and captures what its catch swallows", async () => {
    const boom = new Error("GitHub is down");
    loadCoachContext.mockRejectedValue(boom);

    const res = await coachChatContext.fetch(bearerRequest("coach-chat-context"));

    expect(setAthleteScope).toHaveBeenCalledWith(REPO);
    expect(captureServerException).toHaveBeenCalledWith(boom);
    // The athlete's answer is unchanged - capture is additional, not a new failure mode.
    expect(res.status).toBe(500);
  });

  it("tags coach-chat-profile-status and captures what its catch swallows", async () => {
    const boom = new Error("GitHub is down");
    loadCoachContext.mockRejectedValue(boom);

    const res = await profileStatus.fetch(bearerRequest("coach-chat-profile-status"));

    expect(setAthleteScope).toHaveBeenCalledWith(REPO);
    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(500);
  });

  it("returns profileComplete and live coachSince from profile.json", async () => {
    loadCoachContext.mockResolvedValue({
      profile: { coach_since: "2026-03-17" },
      memory: null,
      seasons: null,
    });
    isAthleteProfileComplete.mockReturnValue(true);

    const res = await profileStatus.fetch(bearerRequest("coach-chat-profile-status"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      profileComplete: true,
      coachSince: "2026-03-17",
    });
  });

  it("returns coachSince null when profile has no stamp yet", async () => {
    loadCoachContext.mockResolvedValue({
      profile: { coach_since: null },
      memory: null,
      seasons: null,
    });
    isAthleteProfileComplete.mockReturnValue(false);

    const res = await profileStatus.fetch(bearerRequest("coach-chat-profile-status"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      profileComplete: false,
      coachSince: null,
    });
  });

  it("tags widget-snapshots and captures what its catch swallows", async () => {
    const boom = new Error("snapshot fetch failed");
    fetchRepoDashboardSnapshot.mockRejectedValue(boom);

    const res = await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(setAthleteScope).toHaveBeenCalledWith(REPO);
    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(500);
  });

  it("captures a failed proactive-message read while preserving the widget fallback", async () => {
    const boom = new Error("proactive message fetch failed");
    getFileRaw.mockRejectedValue(boom);
    fetchRepoDashboardSnapshot.mockResolvedValue({ error: "not synced yet", status: 404 });

    const res = await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(res.status).toBe(404);
    expect(captureServerException).toHaveBeenCalledWith(boom);
  });

  it("tags repo-file and captures the network error it turns into a 502", async () => {
    const boom = new Error("connect ECONNREFUSED");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(boom)),
    );

    const res = await repoFile.fetch(await cookieRequest("repo-file", REPO));

    expect(setAthleteScope).toHaveBeenCalledWith(REPO);
    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(502);
  });

  it("captures a GitHub 5xx that repo-file turns into a 502", async () => {
    // 401/403 and 404 are answered above this branch, so only an outage reaches it.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream boom", { status: 500 }))),
    );

    const res = await repoFile.fetch(await cookieRequest("repo-file", REPO));

    expect(res.status).toBe(502);
    expect(captureServerException).toHaveBeenCalledTimes(1);
  });

  it("does not capture repo-file's 404 - a repo that has not synced is an answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))),
    );

    const res = await repoFile.fetch(await cookieRequest("repo-file", REPO));

    expect(res.status).toBe(404);
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("tags before the work that can throw, so the captured event carries the athlete", async () => {
    fetchRepoDashboardSnapshot.mockRejectedValue(new Error("snapshot fetch failed"));

    await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(setAthleteScope.mock.invocationCallOrder[0]).toBeLessThan(
      captureServerException.mock.invocationCallOrder[0],
    );
  });

  it("leaves a request that never authenticated anonymous", async () => {
    const res = await coachChatContext.fetch(
      new Request("https://example.com/api/coach-chat-context"),
    );

    expect(res.status).toBe(401);
    expect(setAthleteScope).not.toHaveBeenCalled();
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("captures the 502 widget-snapshots forwards without ever throwing", async () => {
    // The pattern this whole issue is about: the failure is built into a Response and returned,
    // so the route wrapper's catch never runs and only an explicit capture records it.
    // `cause` is what fetchRepoDashboardSnapshot sets on a fault and omits on an answer.
    const boom = new Error("GitHub returned 503 for dashboard_snapshot.json");
    fetchRepoDashboardSnapshot.mockResolvedValue({
      error: "Failed to fetch your data from GitHub",
      status: 502,
      cause: boom,
    });

    const res = await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(res.status).toBe(502);
    expect(setAthleteScope).toHaveBeenCalledWith(REPO);
    expect(captureServerException).toHaveBeenCalledWith(boom);
  });

  it("does not capture the 404 it forwards - the repo has not synced", async () => {
    // A missing snapshot is an answer, not a fault: GitHub replied, the repo has not synced.
    fetchRepoDashboardSnapshot.mockResolvedValue({ error: "not synced yet", status: 404 });

    const res = await widgetSnapshots.fetch(bearerRequest("widget-snapshots"));

    expect(res.status).toBe(404);
    expect(captureServerException).not.toHaveBeenCalled();
  });
});

describe("waitlist has no athlete", () => {
  it("captures a failed commit and still names nobody", async () => {
    const boom = new Error("GitHub write failed");
    commitFilesAtomic.mockRejectedValue(boom);

    const res = await waitlist.fetch(waitlistRequest());

    expect(captureServerException).toHaveBeenCalledWith(boom);
    expect(res.status).toBe(502);
    // No auth on this route: whoever filled the form is not an athlete yet.
    expect(setAthleteScope).not.toHaveBeenCalled();
  });

  it("names nobody on the happy path either", async () => {
    commitFilesAtomic.mockResolvedValue(undefined);

    const res = await waitlist.fetch(waitlistRequest());

    expect(res.status).toBe(201);
    expect(setAthleteScope).not.toHaveBeenCalled();
    expect(captureServerException).not.toHaveBeenCalled();
  });
});
