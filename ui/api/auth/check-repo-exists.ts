import { parseCookies, decryptSetupToken, SETUP_TOKEN_COOKIE } from "./_lib/session.js";

// Polled by Setup.tsx while its repo-create popup is open (or once the athlete tabs back to
// this window) - the web equivalent of iOS's GitHubAuthManager.coachRepoExists(). Uses the
// short-lived, encrypted SETUP_TOKEN_COOKIE set by callback.ts's setupRedirect, since there's
// no real session yet at this point in the flow (no installation_id resolved).
export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const raw = cookies[SETUP_TOKEN_COOKIE];
    if (!raw) {
      return Response.json({ error: "setup_session_expired" }, { status: 401 });
    }

    const setupToken = await decryptSetupToken(raw);
    if (!setupToken) {
      return Response.json({ error: "setup_session_expired" }, { status: 401 });
    }

    // login comes from the encrypted cookie, never a query param - this token belongs to one
    // specific athlete, and a query-string login would let a crafted link use it to check
    // existence for an arbitrary login during the athlete's setup window.
    const { gh_token: token, login } = setupToken;

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
