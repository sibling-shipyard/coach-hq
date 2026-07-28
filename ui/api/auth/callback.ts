import {
  encryptSession,
  buildCookie,
  clearCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  OAUTH_STATE_COOKIE,
} from "./_lib/session.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";
const APP_SLUG = process.env.GITHUB_APP_SLUG ?? "coach-phelps";

// callback.ts is reached by the browser navigating directly here (GitHub's redirect), not
// by a fetch() call from React - so error responses can't just be JSON bodies, the user
// would see literal unstyled JSON text with nothing clickable. Every failure path redirects
// to the client app instead, where AuthError.tsx renders something with an explanation and a
// working button.
function errorRedirect(origin: string, type: string, clearOauthCookie = true): Response {
  const headers = new Headers();
  headers.set("Location", `${origin}/?auth_error=${type}`);
  if (clearOauthCookie) {
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  }
  return new Response(null, { status: 302, headers });
}

// Sends a first-time user into the Setup wizard instead of a dead-end error page - see
// pages/Setup.tsx. not_installed isn't a rare misconfiguration here, it's the expected state
// for anyone who's never signed up: GitHub App tokens can't create repos on a personal
// account (confirmed: 404/403 on both /repos/{template}/generate and /user/repos), so
// callback.ts can't silently provision anything itself. Setup.tsx walks the user through the
// two GitHub-native steps that remain (create-from-template, then install) and this is where
// they land back after finishing both.
function setupRedirect(origin: string, login: string, clearOauthCookie = true): Response {
  const headers = new Headers();
  headers.set("Location", `${origin}/setup?login=${encodeURIComponent(login)}`);
  if (clearOauthCookie) {
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  }
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return errorRedirect(url.origin, "config_error", false);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return errorRedirect(url.origin, "missing_params", false);
    }

    const cookies = parseCookies(req);
    const tempRaw = cookies[OAUTH_STATE_COOKIE];
    if (!tempRaw) {
      return errorRedirect(url.origin, "missing_oauth_session", false);
    }

    let tempData: { state: string; codeVerifier: string };
    try {
      tempData = JSON.parse(tempRaw);
    } catch {
      return errorRedirect(url.origin, "corrupt_oauth_session");
    }

    if (tempData.state !== state) {
      return errorRedirect(url.origin, "state_mismatch");
    }

    const redirectUri = `${url.origin}/api/auth/callback`;

    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        code_verifier: tempData.codeVerifier,
      }),
    });

    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || tokenBody.error || !tokenBody.access_token) {
      return errorRedirect(url.origin, "token_exchange_failed");
    }

    const ghToken = tokenBody.access_token as string;

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userRes.ok) {
      return errorRedirect(url.origin, "user_fetch_failed");
    }

    const user = await userRes.json();

    // Resolve installation_id via GET /user/installations, verified against BOTH app_slug
    // and account.login. app_slug alone isn't enough: this endpoint returns every
    // installation the calling user has *any visibility into*, which GitHub grants based on
    // repo access - not just installations the user personally created. A collaborator on
    // someone else's repo that already has the App installed will see that installation too
    // (see sibling-shipyard/coach-phelps-hq#30). account.login is the account the App is
    // actually installed *on*, which is what "is this actually my installation" has to mean.
    const installationsRes = await fetch("https://api.github.com/user/installations", {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!installationsRes.ok) {
      return errorRedirect(url.origin, "lookup_failed");
    }

    const { installations } = (await installationsRes.json()) as {
      installations: Array<{ id: number; app_slug: string; account: { login: string } }>;
    };
    const match = installations.find(
      (i) =>
        i.app_slug === APP_SLUG &&
        i.account.login.toLowerCase() === (user.login as string).toLowerCase()
    );
    const installationId = match?.id ?? null;

    if (!installationId) {
      return setupRedirect(url.origin, user.login as string);
    }

    const session = await encryptSession({
      github_user_id: user.id,
      login: user.login,
      gh_token: ghToken,
      installation_id: installationId,
    });

    const headers = new Headers();
    headers.set("Location", "/");
    headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, session, SESSION_MAX_AGE_SEC));
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));

    return new Response(null, { status: 302, headers });
  },
};
