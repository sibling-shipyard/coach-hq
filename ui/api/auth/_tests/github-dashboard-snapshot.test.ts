/**
 * `fetchRepoDashboardSnapshot` returns its failures instead of throwing, so its callers cannot
 * rely on the route wrapper to record them. `cause` is the flag that tells a caller which of
 * those returned failures is a fault worth capturing - these assert it is set on exactly the
 * two that are, and absent on the one that is an answer.
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

  it("attaches a cause to a GitHub 5xx, named as repo-file.ts names the same failure", async () => {
    stubGitHub(new Response("upstream boom", { status: 503 }));

    const result = await fetchRepoDashboardSnapshot(REPO, "gh-token");

    expect(result).toMatchObject({ status: 502 });
    // Same message repo-file.ts builds, so the identical failure on the identical file groups
    // into one Sentry issue rather than two.
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
