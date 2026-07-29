/**
 * Resolve GitHub credentials for repo-scoped API handlers.
 *
 * Web: encrypted session cookie (same as repo-file.ts) - via ensureFreshSession, so a routine
 * 8h access-token rotation happens transparently here too, not just in the handlers that
 * import session.ts directly.
 * iOS: Authorization: Bearer <github_token> + X-Coach-Repo: owner/repo. iOS refreshes its own
 * token client-side (GitHubAuthManager.swift) before it ever presents a Bearer header here, so
 * this side doesn't need refresh logic of its own.
 */
import { ensureFreshSession, parseCookies, SESSION_COOKIE } from "./session.js";

export interface RepoAuthContext {
  gh_token: string;
  repo_full_name: string;
  // Cookie mode only - caller must attach via withSessionCookie() if present.
  setCookie?: string;
}

const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function resolveRepoAuth(req: Request): Promise<RepoAuthContext | Response> {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) {
    const fresh = await ensureFreshSession(req);
    if (fresh instanceof Response) return fresh;
    if (!fresh.session.repo_full_name) {
      return Response.json(
        { error: "No repo resolved yet — visit /api/auth/list-my-repos first" },
        { status: 400 },
      );
    }
    return {
      gh_token: fresh.session.gh_token,
      repo_full_name: fresh.session.repo_full_name,
      setCookie: fresh.setCookie,
    };
  }

  const authorization = req.headers.get("authorization") ?? "";
  const repoHeader = req.headers.get("x-coach-repo") ?? "";
  if (authorization.startsWith("Bearer ") && repoHeader) {
    if (!REPO_FULL_NAME.test(repoHeader)) {
      return Response.json({ error: "Invalid X-Coach-Repo header" }, { status: 400 });
    }
    return {
      gh_token: authorization.slice("Bearer ".length).trim(),
      repo_full_name: repoHeader,
    };
  }

  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
