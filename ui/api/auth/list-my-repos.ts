/**
 * list-my-repos.ts — repo resolution: find the signed-in user's coach-phelps
 * repo and remember it in their session.
 *
 * Candidates come from the repos the user chose during install (GET
 * /user/installations/{id}/repositories) - since every install is single-repo
 * by design (see ui/api/auth/callback.ts + pages/Setup.tsx), this almost
 * always resolves to exactly one candidate now. The marker-file check and
 * multi-candidate picker path are kept for accounts installed before that
 * convention (or anyone who picked more than one repo during install).
 *
 * Auth: session cookie (web) or Authorization: Bearer <github_token> (iOS) -
 * matches resolve-auth.ts's split, except this endpoint runs *before* iOS has
 * a resolved repo to put in X-Coach-Repo, so it only needs the bearer token.
 * callback.ts already includes `repo` in its coachhq:// redirect for the
 * common single-candidate case; this endpoint is iOS's fallback for the rare
 * 0-or-2+ candidate case, same picker flow web's Onboarding.tsx uses.
 *
 * GET                          → list/confirm candidates, auto-select if exactly one.
 * GET ?select=<owner>/<name>   → confirm and persist a specific pick (2+ case).
 * GET ?switch=1                → re-list every candidate, skipping the cached-pick fast
 *                                 path and the auto-select-on-one shortcut, so a user who
 *                                 already resolved a repo can deliberately switch to another
 *                                 one they own without logging out first. Cookie auth only -
 *                                 iOS has nothing cached to switch away from.
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
  // Cookie mode only - the complete, possibly-just-refreshed session, spread into any new
  // session this handler builds (repo selection) so a rotated access/refresh token from
  // ensureFreshSession never gets silently dropped by a handler that only knew about a few
  // of the session's fields.
  fullSession?: SessionPayload;
  // Cookie mode only - set when ensureFreshSession actually rotated the token this request.
  // Only needs attaching to responses that don't already Set-Cookie a full new session
  // themselves (those already carry the fresh tokens via fullSession above).
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
    // Declared outside the try block so a throw anywhere below can still attach a rotated
    // cookie if resolveAuthContext got one before the throw - same reasoning as
    // widget-snapshots.ts/coach-chat.ts's catch blocks: GitHub's refresh tokens are
    // single-use (ADR 0009), losing a successful rotation here strands the next request.
    let ctx: AuthContext | undefined;
    try {
      const resolved = await resolveAuthContext(req);
      if (resolved instanceof Response) return resolved;
      ctx = resolved;
      return await handle(req, ctx);
    } catch (err) {
      // Covers uncaught throws from repo-resolution.ts's own unwrapped fetch calls
      // (resolveInstallationId/resolveOwnedRepos re-throw anything that isn't their own
      // typed *LookupFailedError) and the 0-candidates path's own fetch below.
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
      // fullSession already carries any rotation from ctx.rotatedCookie (same underlying
      // refresh) - this Set-Cookie supersedes it, no separate attach needed here.
      const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: selected });
      return withUpdatedSession({ repo_full_name: selected }, newSession);
    }

    // Re-confirm an already-resolved repo still exists, is accessible, AND is actually
    // owned by this account before trusting it - defense in depth against a session that
    // resolved incorrectly before this check existed. Skipped in switch mode: the whole
    // point there is to re-list every option, not short-circuit back to the current pick.
    // Bearer auth never has a cached repo_full_name, so this only applies to cookie sessions.
    if (ctx.repo_full_name && !switching) {
      const stillOwned = isOwnedBy(ctx.repo_full_name, ctx.login);
      const stillOk = stillOwned && (await hasMarkerFile(ctx.repo_full_name, ctx.gh_token));
      if (stillOk) {
        return withSessionCookie(Response.json({ repo_full_name: ctx.repo_full_name }), ctx.rotatedCookie);
      }
      // Falls through to re-resolve below if not owned, or it 404s (deleted/renamed/access lost).
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

    // Auto-select on exactly one match - but not in switch mode, where the whole point is
    // to show the picker even if there's only one other option (or none), so the client can
    // say so explicitly instead of silently bouncing back to the same repo.
    if (confirmed.length === 1 && !switching) {
      if (ctx.via === "bearer") {
        return Response.json({ repo_full_name: confirmed[0] });
      }
      const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: confirmed[0] });
      return withUpdatedSession({ repo_full_name: confirmed[0] }, newSession);
    }

    // Distinguish "nothing granted to this installation that you own" (fix: Setup wizard)
    // from "some repos granted, but none look like a coach-phelps repo" (fix: finish setting
    // it up) - these need different messaging, not one generic error.
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

    // 2+ - client renders the picker.
    return withSessionCookie(Response.json({ candidates: confirmed }), ctx.rotatedCookie);
}
