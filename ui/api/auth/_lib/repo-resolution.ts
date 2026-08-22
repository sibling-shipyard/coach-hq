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

export class InstallationLookupFailedError extends Error {}

/**
 * Resolves installation_id, matched on BOTH app_slug and account.login - app_slug alone isn't
 * enough, /user/installations includes installs the caller merely collaborates on (#30).
 * Throws InstallationLookupFailedError on a genuine API failure rather than returning null,
 * so that doesn't read identically to "no installation yet" (a brand-new user's normal state).
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

/** Stamped into every carved repo by platform/scripts/carve-skeleton.mjs - a real "this is a
 * coach repo" pin, untouched by any data migration. */
const MARKER_PATH = ".coach-engine-version";
/** Pre-pin repos only: the old marker was a ledger data file, which the Part-2 ledger migration
 * deletes (#471). Removable once every live repo is confirmed to carry .coach-engine-version. */
const LEGACY_MARKER_PATH = "user_data/ledger/challenge_v2.json";

async function checkPath(repoFullName: string, path: string, token: string): Promise<MarkerCheck> {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${path}`, {
    headers: GH_HEADERS(token),
  });
  if (res.status === 200) return "found";
  if (res.status === 404) return "not_found";
  // 403 rate-limited / 5xx - don't conflate with a genuine "not found", or a transient API
  // hiccup silently reads as the repo being unconfigured.
  return "lookup_failed";
}

async function checkMarkerFile(repoFullName: string, token: string): Promise<MarkerCheck> {
  const primary = await checkPath(repoFullName, MARKER_PATH, token);
  // Only a genuine 404 falls back - a transient failure must stay lookup_failed, never get
  // rescued into a miss (or worse, into a "found") by the second check.
  if (primary !== "not_found") return primary;
  return checkPath(repoFullName, LEGACY_MARKER_PATH, token);
}

/** Single-repo check for list-my-repos.ts's `?select=`/already-resolved call sites - those
 * already fall through to a sensible outcome on failure, so no 3-state distinction needed. */
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
 * Repos granted to this installation, filtered to ones this account owns (see #30 above) and
 * confirmed via the marker file. Checks run in parallel; if any single one fails to complete,
 * the whole result throws rather than silently reading as "marker not found".
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
