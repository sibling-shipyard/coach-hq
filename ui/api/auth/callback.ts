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

// callback.ts is reached by the browser (or iOS's ASWebAuthenticationSession) navigating
// directly here (GitHub's redirect), not by a fetch() call from React - so error responses
// can't just be JSON bodies, the caller would see literal unstyled JSON text with nothing
// clickable, and iOS's session would just show that page with no way to know it failed.
// Every failure path redirects to a platform-appropriate destination instead: the web app
// (AuthError.tsx renders something with an explanation and a working button) or iOS's
// coachhq:// scheme (GitHubAuthManager.swift's session completion handler reads `error` and
// surfaces it - see SetupView.swift/LoginView.swift).
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

// Sends a first-time user into the Setup wizard instead of a dead-end error page - see
// pages/Setup.tsx (web) / SetupView.swift (iOS). not_installed isn't a rare misconfiguration
// here, it's the expected state for anyone who's never signed up: GitHub App tokens can't
// create repos on a personal account (confirmed: 404/403 on both /repos/{template}/generate
// and /user/repos), so callback.ts can't silently provision anything itself. The wizard walks
// the user through the two GitHub-native steps that remain (create-from-template, then
// install) and this is where they land back after finishing both.
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

    // Defaults to a web redirect regardless of platform - an uncaught exception here means a
    // GitHub API call itself threw (see handleCallback's comment), rare enough that an iOS
    // session seeing a web error page instead of a native one is an acceptable degrade rather
    // than threading platform out of the try block for this one case.
    try {
      return await handleCallback(req, url);
    } catch {
      return errorRedirect(url.origin, "network_error", "web");
    }
  },
};

// GitHub API calls below aren't individually try/caught - a thrown exception (DNS blip,
// timeout, transient network failure - not a 4xx/5xx *response*, an actual throw) previously
// propagated uncaught, and Vercel's own generic 500 page replaced AuthError.tsx entirely: no
// styling, no recovery buttons, the exact class of dead end the rest of this file exists to
// avoid. The wrapper above catches anything this function throws.
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

    const ghToken = tokenBody.access_token as string;

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

    // iOS has no cookie jar shared with our API - it authenticates every subsequent request
    // with Authorization: Bearer <gh_token> + X-Coach-Repo (see resolve-auth.ts), so instead
    // of a session cookie it just gets the raw token back on the redirect, plus `repo` when
    // there's exactly one owned+confirmed candidate (true for every install going forward,
    // since installs are single-repo by design - see Setup.tsx/SetupView.swift). If it's not
    // exactly one (legacy multi-repo installs), GitHubAuthManager.swift falls back to calling
    // /api/auth/list-my-repos itself with the bearer token to run the same picker flow web's
    // Onboarding.tsx uses.
    if (platform === "ios") {
      const confirmed = await resolveOwnedRepos(installationId, ghToken, user.login as string);
      const repoParam = confirmed.length === 1 ? `&repo=${encodeURIComponent(confirmed[0])}` : "";
      const headers = new Headers();
      headers.set(
        "Location",
        `coachhq://callback?token=${encodeURIComponent(ghToken)}&login=${encodeURIComponent(user.login as string)}${repoParam}`,
      );
      headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
      return new Response(null, { status: 302, headers });
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
}
