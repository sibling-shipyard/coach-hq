/**
 * Fetch gen/dashboard_snapshot.json from an athlete repo via the GitHub Contents API (.raw).
 */
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export async function fetchRepoDashboardSnapshot(
  repoFullName: string,
  ghToken: string,
): Promise<{ dashboardSnapshot: unknown } | { error: string; status: number }> {
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
    return { error: "Failed to fetch your data from GitHub", status: 502 };
  }

  try {
    const dashboardSnapshot = await contentsRes.json();
    return { dashboardSnapshot };
  } catch {
    return { error: "gen/dashboard_snapshot.json is not valid JSON", status: 502 };
  }
}
