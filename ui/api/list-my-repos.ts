/**
 * list-my-repos.ts — repo resolution: find the signed-in user's coach-phelps
 * repo and remember it in their session.
 *
 * With the GitHub App migration, candidates come directly from the repos the
 * user chose during install (GET /user/installations/{id}/repositories) -
 * already exactly the set they granted. The user_data/ledger/challenge_v2.json
 * marker check stays as a sanity check.
 *
 * SECURITY: GitHub's install picker shows every repo the installing user has
 * admin rights on - including repos they're merely a collaborator on, not
 * just their own. Two people who are mutual collaborators on each other's
 * personal repos can end up with the other person's repo included in their
 * own installation (confirmed: happened in practice - a first-time install
 * resolved straight to a collaborator's repo, no picker, no confirmation).
 * Marker-file presence alone doesn't distinguish "your repo" from "a repo
 * you can see" - only actual ownership does. Every candidate is filtered to
 * `repo.owner.login === session.login` before anything else runs, on both
 * the auto-resolution path and the explicit `?select=` path.
 *
 * GET                          → list/confirm candidates, auto-select if exactly one.
 * GET ?select=<owner>/<name>   → confirm and persist a specific pick (2+ case).
 * GET ?switch=1                → re-list every candidate, skipping the cached-pick fast
 *                                 path and the auto-select-on-one shortcut, so a user who
 *                                 already resolved a repo can deliberately switch to another
 *                                 one they own without logging out first.
 */
import {
  decryptSession,
  encryptSession,
  buildCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from "./_lib/session.js";

interface GhRepo {
  full_name: string;
  name: string;
  owner: { login: string };
}

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function hasMarkerFile(repoFullName: string, token: string): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/user_data/ledger/challenge_v2.json`,
    { headers: GH_HEADERS(token) }
  );
  return res.status === 200;
}

/** True only if the logged-in user actually owns this repo - not just has access to it. */
function isOwnedBy(repoFullName: string, login: string): boolean {
  const owner = repoFullName.split("/")[0];
  return owner.toLowerCase() === login.toLowerCase();
}

function withUpdatedSession(body: unknown, sessionToken: string, status = 200): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE_SEC));
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const session = await decryptSession(raw);
    if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const url = new URL(req.url);
    const selected = url.searchParams.get("select");
    const switching = url.searchParams.get("switch") === "1";

    // Explicit pick from a 2+ candidate list.
    if (selected) {
      if (!isOwnedBy(selected, session.login)) {
        return Response.json({ error: "You can only select a repo you own" }, { status: 403 });
      }
      const ok = await hasMarkerFile(selected, session.gh_token);
      if (!ok) {
        return Response.json(
          { error: "That repo doesn't look like a coach-phelps repo (no user_data/ledger/challenge_v2.json)" },
          { status: 400 }
        );
      }
      const newSession = await encryptSession({ ...session, repo_full_name: selected });
      return withUpdatedSession({ repo_full_name: selected }, newSession);
    }

    // Re-confirm an already-resolved repo still exists, is accessible, AND is actually
    // owned by this account before trusting it - defense in depth against a session that
    // resolved incorrectly before this check existed. Skipped in switch mode: the whole
    // point there is to re-list every option, not short-circuit back to the current pick.
    if (session.repo_full_name && !switching) {
      const stillOwned = isOwnedBy(session.repo_full_name, session.login);
      const stillOk = stillOwned && (await hasMarkerFile(session.repo_full_name, session.gh_token));
      if (stillOk) {
        return Response.json({ repo_full_name: session.repo_full_name });
      }
      // Falls through to re-resolve below if not owned, or it 404s (deleted/renamed/access lost).
    }

    // Repos this installation was granted, filtered to ones this account actually owns -
    // being included in the installation isn't enough, collaborator-accessible repos on
    // someone else's account can show up here too (see SECURITY note above).
    const reposRes = await fetch(
      `https://api.github.com/user/installations/${session.installation_id}/repositories?per_page=100`,
      { headers: GH_HEADERS(session.gh_token) }
    );

    if (!reposRes.ok) {
      return Response.json({ error: "Failed to list repos granted to this installation" }, { status: 502 });
    }

    const { repositories } = (await reposRes.json()) as { repositories: GhRepo[] };
    const ownRepos = repositories.filter((r) => r.owner.login.toLowerCase() === session.login.toLowerCase());

    const confirmed: string[] = [];
    for (const repo of ownRepos) {
      if (await hasMarkerFile(repo.full_name, session.gh_token)) {
        confirmed.push(repo.full_name);
      }
    }

    // Auto-select on exactly one match - but not in switch mode, where the whole point is
    // to show the picker even if there's only one other option (or none), so the client can
    // say so explicitly instead of silently bouncing back to the same repo.
    if (confirmed.length === 1 && !switching) {
      const newSession = await encryptSession({ ...session, repo_full_name: confirmed[0] });
      return withUpdatedSession({ repo_full_name: confirmed[0] }, newSession);
    }

    // Distinguish "nothing granted to this installation that you own" (fix: install on a
    // repo via Sign up) from "some repos granted, but none look like a coach-phelps repo"
    // (fix: finish setting it up) - these need different messaging, not one generic error.
    if (confirmed.length === 0) {
      const reason = ownRepos.length === 0 ? "no_owned_repos" : "no_marker_match";
      return Response.json({ candidates: [], reason });
    }

    // 2+ - client renders the picker.
    return Response.json({ candidates: confirmed });
  },
};
