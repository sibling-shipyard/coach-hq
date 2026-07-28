import { decryptSession, parseCookies, SESSION_COOKIE } from "./_lib/session.js";

export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    const session = await decryptSession(raw);
    if (!session) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }

    return Response.json({
      github_user_id: session.github_user_id,
      login: session.login,
      repo_full_name: session.repo_full_name ?? null,
    });
  },
};
