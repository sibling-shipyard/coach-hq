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
function errorRedirect(origin: string, type: string, platform: "web" | "ios" = "web", clearOauthCookie = true): Response {
  const headers = new Headers();
  headers.set(
    "Location",
    platform === "ios" ? `coachhq://callback?error=${type}` : `${origin}/?auth_error=${type}`,
  );
  if (clearOauthCookie) {
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  }
  return new Response(null, { status: 302, headers });
}

// Sends a first-time user into the Setup wizard (Setup.tsx / SetupView.swift) instead of a
// dead-end error - GitHub App tokens can't create repos on a personal account (confirmed via
// 404/403 on /repos/{template}/generate and /user/repos), so this can't provision one itself.
function setupRedirect(origin: string, login: string, platform: "web" | "ios" = "web", clearOauthCookie = true): Response {
  const headers = new Headers();
  headers.set(
    "Location",
    platform === "ios"
      ? `coachhq://callback?needs_setup=1&login=${encodeURIComponent(login)}`
      : `${origin}/setup?login=${encodeURIComponent(login)}`,
  );
  if (clearOauthCookie) {
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
  }
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

    let tempData: { state: string; codeVerifier: string; platform?: "web" | "ios" };
    try {
      tempData = JSON.parse(tempRaw);
    } catch {
      return errorRedirect(url.origin, "corrupt_oauth_session");
    }

    const platform: "web" | "ios" = tempData.platform === "ios" ? "ios" : "web";

    if (tempData.state !== state) {
      return errorRedirect(url.origin, "state_mismatch", platform);
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
      return errorRedirect(url.origin, "token_exchange_failed", platform);
    }
    // refresh_token/expires_in are always present - "expire user authorization tokens" is
    // opted in on the GitHub App. ensureFreshSession / iOS's refresh logic need both to rotate.
    if (!tokenBody.refresh_token || !tokenBody.expires_in) {
      return errorRedirect(url.origin, "token_exchange_failed", platform);
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
      return errorRedirect(url.origin, "user_fetch_failed", platform);
    }

    const user = await userRes.json();

    let installationId: number | null;
    try {
      installationId = await resolveInstallationId(ghToken, user.login as string, APP_SLUG);
    } catch (e) {
      if (e instanceof InstallationLookupFailedError) {
        return errorRedirect(url.origin, "lookup_failed", platform);
      }
      throw e;
    }

    if (!installationId) {
      return setupRedirect(url.origin, user.login as string, platform);
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
    headers.set("Location", "/");
    headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, session, SESSION_MAX_AGE_SEC));
    headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));

  return new Response(null, { status: 302, headers });
}
