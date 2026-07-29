/**
 * list-my-repos.ts — repo resolution: find the signed-in user's coach-phelps repo and
 * remember it in their session. Almost always resolves to exactly one candidate (installs
 * are single-repo by design), but keeps the marker-file check and picker path for accounts
 * installed before that convention.
 *
 * Auth: session cookie (web) or Authorization: Bearer <github_token> (iOS, before it has a
 * resolved repo for X-Coach-Repo). This is iOS's fallback for the 0-or-2+ candidate case;
 * callback.ts already includes `repo` in its redirect for the common single-candidate case.
 *
 * GET                          → list/confirm candidates, auto-select if exactly one.
 * GET ?select=<owner>/<name>   → confirm and persist a specific pick (2+ case).
 * GET ?switch=1                → re-list every candidate (skips cached-pick/auto-select), so
 *                                 a user can switch repos without logging out. Cookie only.
 */
import {
  encryptSession,
  buildCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  ensureFreshSession,
  withSessionCookie,
  type SessionPayload,
} from "./_lib/session.js";
import {
  resolveInstallationId,
  resolveOwnedRepos,
  isOwnedBy,
  hasMarkerFile,
  InstallationLookupFailedError,
  MarkerLookupFailedError,
} from "./_lib/repo-resolution.js";

const APP_SLUG = process.env.GITHUB_APP_SLUG ?? "coach-phelps";

interface AuthContext {
  login: string;
  gh_token: string;
  installation_id: number;
  repo_full_name?: string;
  via: "cookie" | "bearer";
  /** Cookie mode only - full session, spread into any new session this handler builds so a
   * rotated token from ensureFreshSession never gets dropped. */
  fullSession?: SessionPayload;
  /** Cookie mode only - set when ensureFreshSession rotated the token this request. Only
   * needs attaching to responses that don't already Set-Cookie a full new session. */
  rotatedCookie?: string;
}

async function resolveAuthContext(req: Request): Promise<AuthContext | Response> {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) {
    const fresh = await ensureFreshSession(req);
    if (fresh instanceof Response) return fresh;
    return {
      login: fresh.session.login,
      gh_token: fresh.session.gh_token,
      installation_id: fresh.session.installation_id,
      repo_full_name: fresh.session.repo_full_name,
      via: "cookie",
      fullSession: fresh.session,
      rotatedCookie: fresh.setCookie,
    };
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authorization.slice("Bearer ".length).trim();

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userRes.ok) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const user = await userRes.json();

  let installationId: number | null;
  try {
    installationId = await resolveInstallationId(token, user.login as string, APP_SLUG);
  } catch (e) {
    if (e instanceof InstallationLookupFailedError) {
      return Response.json({ error: "Failed to look up installation" }, { status: 502 });
    }
    throw e;
  }
  if (!installationId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  return { login: user.login as string, gh_token: token, installation_id: installationId, via: "bearer" };
}

function withUpdatedSession(body: unknown, sessionToken: string, status = 200): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE_SEC));
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(req: Request): Promise<Response> {
    // Declared outside the try block so a throw can still attach a rotated cookie -
    // refresh_token is single-use (ADR 0009), losing a rotation strands the next request.
    let ctx: AuthContext | undefined;
    try {
      const resolved = await resolveAuthContext(req);
      if (resolved instanceof Response) return resolved;
      ctx = resolved;
      return await handle(req, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to look up your repos";
      console.error("[list-my-repos]", err);
      return withSessionCookie(Response.json({ error: message }, { status: 502 }), ctx?.rotatedCookie);
    }
  },
};

async function handle(req: Request, ctx: AuthContext): Promise<Response> {
    const url = new URL(req.url);
    const selected = url.searchParams.get("select");
    const switching = url.searchParams.get("switch") === "1";

    // Explicit pick from a 2+ candidate list.
    if (selected) {
      if (!isOwnedBy(selected, ctx.login)) {
        return withSessionCookie(
          Response.json({ error: "You can only select a repo you own" }, { status: 403 }),
          ctx.rotatedCookie,
        );
      }
      const ok = await hasMarkerFile(selected, ctx.gh_token);
      if (!ok) {
        return withSessionCookie(
          Response.json(
            { error: "That repo doesn't look like a coach-phelps repo (no user_data/ledger/challenge_v2.json)" },
            { status: 400 }
          ),
          ctx.rotatedCookie,
        );
      }
      if (ctx.via === "bearer") {
        return Response.json({ repo_full_name: selected });
      }
      // fullSession already carries any rotation - this Set-Cookie supersedes it.
      const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: selected });
      return withUpdatedSession({ repo_full_name: selected }, newSession);
    }

    // Re-confirm an already-resolved repo still exists and is owned by this account before
    // trusting it. Skipped in switch mode. Bearer auth never has a cached repo_full_name.
    if (ctx.repo_full_name && !switching) {
      const stillOwned = isOwnedBy(ctx.repo_full_name, ctx.login);
      const stillOk = stillOwned && (await hasMarkerFile(ctx.repo_full_name, ctx.gh_token));
      if (stillOk) {
        return withSessionCookie(Response.json({ repo_full_name: ctx.repo_full_name }), ctx.rotatedCookie);
      }
      // Falls through to re-resolve if not owned or it 404s (deleted/renamed/access lost).
    }

    let confirmed: string[];
    try {
      confirmed = await resolveOwnedRepos(ctx.installation_id, ctx.gh_token, ctx.login);
    } catch (e) {
      if (e instanceof MarkerLookupFailedError) {
        return withSessionCookie(
          Response.json({ error: "Failed to check your repos - try again" }, { status: 502 }),
          ctx.rotatedCookie,
        );
      }
      throw e;
    }

    // Auto-select on exactly one match - not in switch mode, where the point is to show the
    // picker even with only one option so the client can say so instead of silently bouncing back.
    if (confirmed.length === 1 && !switching) {
      if (ctx.via === "bearer") {
        return Response.json({ repo_full_name: confirmed[0] });
      }
      const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: confirmed[0] });
      return withUpdatedSession({ repo_full_name: confirmed[0] }, newSession);
    }

    // Distinguish "nothing granted that you own" (fix: Setup wizard) from "some repos
    // granted, none look like a coach-phelps repo" (fix: finish setup) - different messaging.
    if (confirmed.length === 0) {
      const reposRes = await fetch(
        `https://api.github.com/user/installations/${ctx.installation_id}/repositories?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${ctx.gh_token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      const { repositories } = reposRes.ok
        ? ((await reposRes.json()) as { repositories: Array<{ owner: { login: string } }> })
        : { repositories: [] };
      const ownRepos = repositories.filter((r) => r.owner.login.toLowerCase() === ctx.login.toLowerCase());
      const reason = ownRepos.length === 0 ? "no_owned_repos" : "no_marker_match";
      return withSessionCookie(Response.json({ candidates: [], reason }), ctx.rotatedCookie);
    }

    // 2+ candidates - client renders the picker.
    return withSessionCookie(Response.json({ candidates: confirmed }), ctx.rotatedCookie);
}
