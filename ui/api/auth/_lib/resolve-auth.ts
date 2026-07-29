/**
 * Resolve GitHub credentials for repo-scoped API handlers.
 *
 * Web: encrypted session cookie (same as repo-file.ts).
 * iOS: Authorization: Bearer <github_token> + X-Coach-Repo: owner/repo.
 */
import { decryptSession, parseCookies, SESSION_COOKIE } from "./session.js";

export interface RepoAuthContext {
  gh_token: string;
  repo_full_name: string;
}

const REPO_FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function resolveRepoAuth(req: Request): Promise<RepoAuthContext | Response> {
  const cookies = parseCookies(req);
  const rawSession = cookies[SESSION_COOKIE];
  if (rawSession) {
    const session = await decryptSession(rawSession);
    if (!session) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!session.repo_full_name) {
      return Response.json(
        { error: "No repo resolved yet — visit /api/auth/list-my-repos first" },
        { status: 400 },
      );
    }
    return {
      gh_token: session.gh_token,
      repo_full_name: session.repo_full_name,
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
