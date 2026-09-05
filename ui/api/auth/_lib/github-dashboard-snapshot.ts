/**
 * Fetch gen/dashboard_snapshot.json from an athlete repo via the GitHub Contents API (.raw).
 */
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export interface RepoDashboardSnapshotFailure {
  error: string;
  status: number;
  /**
   * Set only when the failure is a fault rather than an answer, so a caller captures on its
   * presence instead of re-deriving the distinction from the status. A 404 carries none: the
   * repo has not synced yet. The two 502s do: GitHub is down, or the snapshot will not parse,
   * and the athlete's dashboard is blank with nothing else recording why. Messages match
   * `repo-file.ts`, which answers the identical failures on the identical file, so one search
   * finds both routes' events. They do not share an issue: Sentry groups on the stack trace, and
   * these are two `new Error()` in two files.
   */
  cause?: Error;
}

export type RepoDashboardSnapshotResult =
  | { dashboardSnapshot: unknown }
  | RepoDashboardSnapshotFailure;

export async function fetchRepoDashboardSnapshot(
  repoFullName: string,
  ghToken: string,
): Promise<RepoDashboardSnapshotResult> {
  const contentsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/gen/dashboard_snapshot.json`,
    { headers: GH_HEADERS(ghToken) },
  );

  if (contentsRes.status === 404) {
    return {
      error: "gen/dashboard_snapshot.json not found in your repo — has it synced yet?",
      status: 404,
    };
  }
  if (!contentsRes.ok) {
    return {
      error: "Failed to fetch your data from GitHub",
      status: 502,
      cause: new Error(`GitHub returned ${contentsRes.status} for dashboard_snapshot.json`),
    };
  }

  try {
    const dashboardSnapshot = await contentsRes.json();
    return { dashboardSnapshot };
  } catch (err) {
    return {
      error: "gen/dashboard_snapshot.json is not valid JSON",
      status: 502,
      cause: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
