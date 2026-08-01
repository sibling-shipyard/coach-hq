import {
  encryptSession,
  buildCookie,
  clearCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  OAUTH_STATE_COOKIE,
} from "./_lib/session.js";
import {
  resolveInstallationId,
  resolveOwnedRepos,
  InstallationLookupFailedError,
} from "./_lib/repo-resolution.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";
const APP_SLUG = process.env.GITHUB_APP_SLUG ?? "coach-phelps";

// callback.ts is reached by the browser (or iOS's ASWebAuthenticationSession) navigating here
// directly, not by a fetch() from React - so failures redirect to a platform-appropriate
// destination (AuthError.tsx, or iOS's coachhq:// scheme) rather than returning raw JSON.
// In popup mode (GitHubAuthButton's window.open flow) every terminal redirect instead goes to
// AuthPopupComplete.tsx, which posts the result back to window.opener and closes itself - the
// popup never shows AuthError.tsx/Setup.tsx/the dashboard directly, the *opener* tab does.
function errorRedirect(
  origin: string,
  type: string,
  platform: "web" | "ios" = "web",
  clearOauthCookie = true,
  popup = false,
): Response {
  const headers = new Headers();
  headers.set(
    "Location",
    platform === "ios"
      ? `coachhq://callback?error=${type}`
      : popup
        ? `${origin}/auth/popup-complete?error=${type}`
        : `${origin}/?auth_error=${type}`,
  );
  if (clearOauthCookie) {
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  }
  return new Response(null, { status: 302, headers });
}

// iOS still handles first-time setup natively (SetupView.swift) since GitHub App tokens can't
// create repos on a personal account (confirmed via 404/403 on /repos/{template}/generate and
// /user/repos) - it has to be a GitHub-native step. Web no longer has an equivalent wizard:
// setup only happens in the iOS app now, so a web user with no install just gets sent to
// AuthError's needs_ios_setup message instead.
function setupRedirect(
  origin: string,
  login: string,
  platform: "web" | "ios" = "web",
  popup = false,
): Response {
  const headers = new Headers();
  headers.set(
    "Location",
    platform === "ios"
      ? `coachhq://callback?needs_setup=1&login=${encodeURIComponent(login)}`
      : popup
        ? `${origin}/auth/popup-complete?error=needs_ios_setup`
        : `${origin}/?auth_error=needs_ios_setup`,
  );
  headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Web redirect regardless of platform - an uncaught throw here is rare enough that an iOS
    // session seeing a web error page instead of a native one is an acceptable degrade.
    try {
      return await handleCallback(req, url);
    } catch {
      return errorRedirect(url.origin, "network_error", "web");
    }
  },
};

// GitHub API calls below aren't individually try/caught - a thrown exception (DNS blip, timeout)
// is caught by the fetch() wrapper above instead of falling through to Vercel's generic 500 page.
async function handleCallback(req: Request, url: URL): Promise<Response> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return errorRedirect(url.origin, "config_error", "web", false);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

    if (!code || !state) {
      return errorRedirect(url.origin, "missing_params", "web", false);
    }

    const cookies = parseCookies(req);
    const tempRaw = cookies[OAUTH_STATE_COOKIE];
    if (!tempRaw) {
      return errorRedirect(url.origin, "missing_oauth_session", "web", false);
    }

    let tempData: { state: string; codeVerifier: string; platform?: "web" | "ios"; popup?: boolean };
    try {
      tempData = JSON.parse(tempRaw);
    } catch {
      return errorRedirect(url.origin, "corrupt_oauth_session");
    }

    const platform: "web" | "ios" = tempData.platform === "ios" ? "ios" : "web";
    const popup = platform === "web" && tempData.popup === true;

    if (tempData.state !== state) {
      return errorRedirect(url.origin, "state_mismatch", platform, true, popup);
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
      return errorRedirect(url.origin, "token_exchange_failed", platform, true, popup);
    }
    // refresh_token/expires_in are always present - "expire user authorization tokens" is
    // opted in on the GitHub App. ensureFreshSession / iOS's refresh logic need both to rotate.
    if (!tokenBody.refresh_token || !tokenBody.expires_in) {
      return errorRedirect(url.origin, "token_exchange_failed", platform, true, popup);
    }

    const ghToken = tokenBody.access_token as string;
    const ghRefreshToken = tokenBody.refresh_token as string;
    const ghTokenExpiresAt = Date.now() + Number(tokenBody.expires_in) * 1000;

    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userRes.ok) {
      return errorRedirect(url.origin, "user_fetch_failed", platform, true, popup);
    }

    const user = await userRes.json();

    let installationId: number | null;
    try {
      installationId = await resolveInstallationId(ghToken, user.login as string, APP_SLUG);
    } catch (e) {
      if (e instanceof InstallationLookupFailedError) {
        return errorRedirect(url.origin, "lookup_failed", platform, true, popup);
      }
      throw e;
    }

    if (!installationId) {
      // iOS: include the token so GitHubAuthManager can call fetchUser() and populate
      // user.id before the install step. install-redirect.ts requires a valid
      // suggested_target_id for /installations/new/permissions; without user.id that
      // parameter is absent and GitHub returns 404.
      if (platform === "ios") {
        const headers = new Headers();
        headers.set(
          "Location",
          `coachhq://callback?needs_setup=1&login=${encodeURIComponent(user.login as string)}` +
            `&token=${encodeURIComponent(ghToken)}` +
            `&refresh_token=${encodeURIComponent(ghRefreshToken)}` +
            `&expires_at=${ghTokenExpiresAt}`,
        );
        headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
        return new Response(null, { status: 302, headers });
      }
      return setupRedirect(url.origin, user.login as string, platform, popup);
    }

    // iOS has no shared cookie jar, so it gets the raw token back on the redirect (see
    // resolve-auth.ts) plus `repo` when there's exactly one owned+confirmed candidate - true
    // for every install going forward since installs are single-repo by design. Otherwise
    // GitHubAuthManager.swift falls back to /api/auth/list-my-repos for the picker flow.
    if (platform === "ios") {
      const confirmed = await resolveOwnedRepos(installationId, ghToken, user.login as string);
      const repoParam = confirmed.length === 1 ? `&repo=${encodeURIComponent(confirmed[0])}` : "";
      const headers = new Headers();
      headers.set(
        "Location",
        `coachhq://callback?token=${encodeURIComponent(ghToken)}` +
          `&refresh_token=${encodeURIComponent(ghRefreshToken)}` +
          `&expires_at=${ghTokenExpiresAt}` +
          `&login=${encodeURIComponent(user.login as string)}${repoParam}`,
      );
      headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
      return new Response(null, { status: 302, headers });
    }

    const session = await encryptSession({
      github_user_id: user.id,
      login: user.login,
      gh_token: ghToken,
      refresh_token: ghRefreshToken,
      gh_token_expires_at: ghTokenExpiresAt,
      installation_id: installationId,
    });

    const headers = new Headers();
    headers.set("Location", popup ? `${url.origin}/auth/popup-complete?ok=1` : "/");
    headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, session, SESSION_MAX_AGE_SEC));
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));

  return new Response(null, { status: 302, headers });
}
