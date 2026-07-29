/**
 * repo-resolution.ts — shared installation/repo lookup logic.
 *
 * Used by callback.ts (resolving installation_id right after OAuth exchange, and giving iOS
 * a repo in its coachhq:// redirect when there's exactly one candidate) and list-my-repos.ts
 * (the web onboarding screen's picker, plus iOS's fallback for the 0-or-2+ candidate case).
 * Kept in one place so the ownership + marker-file rules can't drift between the two callers.
 */

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

interface GhRepo {
  full_name: string;
  name: string;
  owner: { login: string };
}

/**
 * Resolve installation_id via GET /user/installations, verified against BOTH app_slug and
 * account.login. app_slug alone isn't enough: this endpoint returns every installation the
 * calling user has *any visibility into*, which GitHub grants based on repo access - not just
 * installations the user personally created. A collaborator on someone else's repo that
 * already has the App installed will see that installation too (see
 * sibling-shipyard/coach-phelps-hq#30). account.login is the account the App is actually
 * installed *on*, which is what "is this actually my installation" has to mean.
 */
export class InstallationLookupFailedError extends Error {}

/**
 * Returns null when the lookup succeeded but genuinely found no matching installation (the
 * expected first-visit state for a new user) - throws InstallationLookupFailedError on a
 * transient GitHub API failure instead of returning null for that case too. Conflating the
 * two used to mean a GitHub API hiccup for an already-installed user looked identical to a
 * brand-new user who's never installed, sending both down the same "go sign up" path.
 */
export async function resolveInstallationId(
  ghToken: string,
  login: string,
  appSlug: string,
): Promise<number | null> {
  const res = await fetch("https://api.github.com/user/installations", {
    headers: GH_HEADERS(ghToken),
  });
  if (!res.ok) throw new InstallationLookupFailedError();

  const { installations } = (await res.json()) as {
    installations: Array<{ id: number; app_slug: string; account: { login: string } }>;
  };
  const match = installations.find(
    (i) => i.app_slug === appSlug && i.account.login.toLowerCase() === login.toLowerCase(),
  );
  return match?.id ?? null;
}

type MarkerCheck = "found" | "not_found" | "lookup_failed";

async function checkMarkerFile(repoFullName: string, token: string): Promise<MarkerCheck> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/user_data/ledger/challenge_v2.json`,
    { headers: GH_HEADERS(token) },
  );
  if (res.status === 200) return "found";
  if (res.status === 404) return "not_found";
  // Anything else (403 rate-limited, 5xx, etc.) - a genuine "not found" and "we couldn't
  // check" must not be conflated. Treating a rate-limit as "this repo isn't set up" would
  // silently misreport a transient API problem as the user's fault.
  return "lookup_failed";
}

/** Single-repo check, for the `?select=`/already-resolved-repo call sites in list-my-repos.ts
 * that only ever check one specific repo, not a batch - a lookup failure there already falls
 * through to a sensible outcome (re-resolve, or "doesn't look like a coach-phelps repo"), so
 * it doesn't need the 3-state distinction resolveOwnedRepos does. */
export async function hasMarkerFile(repoFullName: string, token: string): Promise<boolean> {
  return (await checkMarkerFile(repoFullName, token)) === "found";
}

/** True only if the logged-in user actually owns this repo - not just has access to it. */
export function isOwnedBy(repoFullName: string, login: string): boolean {
  const owner = repoFullName.split("/")[0];
  return owner.toLowerCase() === login.toLowerCase();
}

export class MarkerLookupFailedError extends Error {}

/**
 * Repos granted to this installation, filtered to ones this account actually owns (not just
 * a collaborator-accessible repo on someone else's account, see resolveInstallationId's SECURITY
 * note) and confirmed as an actual coach-phelps repo via the marker file.
 *
 * Marker-file checks run in parallel (Promise.all) rather than one at a time - on an account
 * with several candidate repos, sequential awaits added up to real, avoidable latency. If any
 * single check fails to complete (rate-limited, transient error), the whole result throws
 * MarkerLookupFailedError rather than silently treating that repo as "marker not found" -
 * same reasoning as resolveInstallationId's failed/not-found distinction above.
 */
export async function resolveOwnedRepos(
  installationId: number,
  ghToken: string,
  login: string,
): Promise<string[]> {
  const reposRes = await fetch(
    `https://api.github.com/user/installations/${installationId}/repositories?per_page=100`,
    { headers: GH_HEADERS(ghToken) },
  );
  if (!reposRes.ok) throw new MarkerLookupFailedError();

  const { repositories } = (await reposRes.json()) as { repositories: GhRepo[] };
  const ownRepos = repositories.filter((r) => r.owner.login.toLowerCase() === login.toLowerCase());

  const checks = await Promise.all(
    ownRepos.map(async (repo) => ({
      repo: repo.full_name,
      result: await checkMarkerFile(repo.full_name, ghToken),
    })),
  );

  if (checks.some((c) => c.result === "lookup_failed")) {
    throw new MarkerLookupFailedError();
  }

  return checks.filter((c) => c.result === "found").map((c) => c.repo);
}
