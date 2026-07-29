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

async function hasMarkerFile(repoFullName: string, token: string): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/user_data/ledger/challenge_v2.json`,
    { headers: GH_HEADERS(token) },
  );
  return res.status === 200;
}

/** True only if the logged-in user actually owns this repo - not just has access to it. */
export function isOwnedBy(repoFullName: string, login: string): boolean {
  const owner = repoFullName.split("/")[0];
  return owner.toLowerCase() === login.toLowerCase();
}

/**
 * Repos granted to this installation, filtered to ones this account actually owns (not just
 * a collaborator-accessible repo on someone else's account, see resolveInstallationId's SECURITY
 * note) and confirmed as an actual coach-phelps repo via the marker file.
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
  if (!reposRes.ok) return [];

  const { repositories } = (await reposRes.json()) as { repositories: GhRepo[] };
  const ownRepos = repositories.filter((r) => r.owner.login.toLowerCase() === login.toLowerCase());

  const confirmed: string[] = [];
  for (const repo of ownRepos) {
    if (await hasMarkerFile(repo.full_name, ghToken)) {
      confirmed.push(repo.full_name);
    }
  }
  return confirmed;
}

export { hasMarkerFile };
