/**
 * `fetchRepoDashboardSnapshot` returns its failures instead of throwing, so its callers cannot
 * rely on the route wrapper to record them. `cause` is the flag that tells a caller which of
 * those returned failures is a fault worth capturing - these assert it is set on exactly the
 * two that are, and absent on the three that are answers.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRepoDashboardSnapshot } from "../_lib/github-dashboard-snapshot.js";

const REPO = "alice/coach-alice";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubGitHub(res: Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(res)),
  );
}

describe("fetchRepoDashboardSnapshot", () => {
  it("leaves a 404 with no cause - the repo has not synced yet", async () => {
    stubGitHub(new Response("nope", { status: 404 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 404 });
    expect(result).not.toHaveProperty("cause");
  });

  it("leaves a 401 with no cause - a revoked GitHub App installation, fixed by signing in again", async () => {
    stubGitHub(new Response("nope", { status: 401 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 502 });
    expect(result).not.toHaveProperty("cause");
  });

  it("leaves a 403 with no cause - same revoked-install answer as a 401", async () => {
    stubGitHub(new Response("nope", { status: 403 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 502 });
    expect(result).not.toHaveProperty("cause");
  });

  it("attaches a cause to a GitHub 5xx, named as repo-file.ts names the same failure", async () => {
    stubGitHub(new Response("upstream boom", { status: 503 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 502 });
    // Same message repo-file.ts builds, so one search finds the identical failure on the
    // identical file from either route. Not one issue - Sentry groups on the stack trace.
    expect("cause" in result && result.cause?.message).toBe(
      "GitHub returned 503 for dashboard_snapshot.json",
    );
  });

  it("attaches a cause to a snapshot that will not parse", async () => {
    stubGitHub(new Response("{ not json", { status: 200 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 502 });
    expect("cause" in result && result.cause).toBeInstanceOf(Error);
  });

  it("returns the snapshot and no failure fields on the happy path", async () => {
    stubGitHub(Response.json({ hello: "world" }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toEqual({ dashboardSnapshot: { hello: "world" } });
  });
});
