import { parseCookies, SETUP_TOKEN_COOKIE } from "./_lib/session.js";

// Polled by Setup.tsx while its repo-create popup is open (or once the athlete tabs back to
// this window) - the web equivalent of iOS's GitHubAuthManager.coachRepoExists(). Uses the
// short-lived SETUP_TOKEN_COOKIE set by callback.ts's setupRedirect, since there's no real
// session yet at this point in the flow (no installation_id resolved).
export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const token = cookies[SETUP_TOKEN_COOKIE];
    if (!token) {
      return Response.json({ error: "setup_session_expired" }, { status: 401 });
    }

    const url = new URL(req.url);
    const login = url.searchParams.get("login");
    if (!login) {
      return Response.json({ error: "missing_login" }, { status: 400 });
    }

    const res = await fetch(`https://api.github.com/repos/${login}/coach-${login}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return Response.json({ error: "setup_session_expired" }, { status: 401 });
    }

    return Response.json({ exists: res.status === 200 });
  },
};
