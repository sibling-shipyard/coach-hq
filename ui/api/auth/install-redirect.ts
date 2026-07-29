import { generateRandomString, generateCodeChallenge } from "./_lib/pkce.js";
import { buildCookie, OAUTH_STATE_COOKIE } from "./_lib/session.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const APP_SLUG = process.env.GITHUB_APP_SLUG ?? "coach-phelps";
const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 min - just needs to survive the redirect round trip

// Internal step, not linked from anywhere in the product UI directly - pages/Setup.tsx's
// "Continue to install" button is the only web caller; iOS's SetupView.swift calls this same
// endpoint with ?platform=ios. By the time a user reaches this, they've already been through
// /api/auth/start once (not_installed) and, per the Setup wizard, created their coach-<login>
// repo on GitHub's own template-generate page. This step is what actually attaches the GitHub
// App to that one repo: /apps/<slug>/installations/new always shows GitHub's repo picker,
// which is what we want here since the repo now exists and can be selected. Sets its own
// state+PKCE cookie (same mechanism as start.ts, same ?platform= threading) so that whichever
// entry point led here, callback.ts's state validation just works - no special-casing needed
// there.
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";

    if (!CLIENT_ID) {
      // See start.ts's identical check for why this redirects instead of returning JSON.
      const headers = new Headers();
      headers.set(
        "Location",
        platform === "ios" ? "coachhq://callback?error=config_error" : `${url.origin}/?auth_error=config_error`,
      );
      return new Response(null, { status: 302, headers });
    }

    const state = generateRandomString(24);
    const codeVerifier = generateRandomString(48);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const redirectUri = `${url.origin}/api/auth/callback`;

    const installUrl = new URL(`https://github.com/apps/${APP_SLUG}/installations/new`);
    installUrl.searchParams.set("state", state);
    installUrl.searchParams.set("redirect_uri", redirectUri);
    installUrl.searchParams.set("client_id", CLIENT_ID);
    installUrl.searchParams.set("code_challenge", codeChallenge);
    installUrl.searchParams.set("code_challenge_method", "S256");

    const tempValue = JSON.stringify({ state, codeVerifier, platform });

    const headers = new Headers();
    headers.set("Location", installUrl.toString());
    headers.append("Set-Cookie", buildCookie(OAUTH_STATE_COOKIE, tempValue, OAUTH_STATE_MAX_AGE_SEC));

    return new Response(null, { status: 302, headers });
  },
};
