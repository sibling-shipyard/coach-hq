import { ensureFreshSession, withSessionCookie } from "./_lib/session.js";

export default {
  async fetch(req: Request): Promise<Response> {
    const fresh = await ensureFreshSession(req);
    if (fresh instanceof Response) return fresh;

    return withSessionCookie(
      Response.json({
        github_user_id: fresh.session.github_user_id,
        login: fresh.session.login,
        repo_full_name: fresh.session.repo_full_name ?? null,
      }),
      fresh.setCookie,
    );
  },
};
