/**
 * Fetch gen/aggregate.json from an athlete repo via the GitHub Contents API (.raw).
 */
const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export async function fetchRepoAggregate(
  repoFullName: string,
  ghToken: string,
): Promise<{ aggregate: unknown } | { error: string; status: number }> {
  const contentsRes = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/gen/aggregate.json`,
    { headers: GH_HEADERS(ghToken) },
  );

  if (contentsRes.status === 404) {
    return {
      error: "gen/aggregate.json not found in your repo — has it synced yet?",
      status: 404,
    };
  }
  if (!contentsRes.ok) {
    return { error: "Failed to fetch your data from GitHub", status: 502 };
  }

  try {
    const aggregate = await contentsRes.json();
    return { aggregate };
  } catch {
    return { error: "gen/aggregate.json is not valid JSON", status: 502 };
  }
}
