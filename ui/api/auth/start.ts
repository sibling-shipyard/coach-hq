import { generateRandomString, generateCodeChallenge } from "./_lib/pkce.js";
import { buildCookie, OAUTH_STATE_COOKIE } from "./_lib/session.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 min - just needs to survive the redirect round trip

// Local testing note: `vercel dev --listen 3000` doesn't reliably pick up ui/.env.local on
// its own in this project - source it into the shell first (`set -a; source .env.local; set
// +a`) before launching, otherwise GITHUB_APP_CLIENT_ID etc. read as unset here. Also run it
// from inside ui/ - vercel.json's SPA rewrite can intercept Vite's own dev asset requests
// (blank page, /src/main.tsx returns index.html) if invoked from the wrong cwd.

// Single "Log in with GitHub" entry point for both new and returning users - always hits
// GitHub's plain sign-in endpoint; callback.ts decides whether a first-timer needs routing
// into Setup.tsx's repo creation + install flow.
//
// ?platform=ios rides through the state cookie so callback.ts knows to hand back a
// coachhq://callback redirect instead of a Set-Cookie session - see GitHubAuthManager.swift.
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";
    // ?popup=1 - opened via GitHubAuthButton's window.open() instead of a full-page nav;
    // callback.ts routes back to a self-closing page instead of redirecting this whole tab.
    const popup = platform === "web" && url.searchParams.get("popup") === "1";

    if (!CLIENT_ID) {
      // Redirect rather than bare JSON - reached by direct navigation, not fetch().
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

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const tempValue = JSON.stringify({ state, codeVerifier, platform, popup });

    const headers = new Headers();
    headers.set("Location", authorizeUrl.toString());
    headers.append("Set-Cookie", buildCookie(OAUTH_STATE_COOKIE, tempValue, OAUTH_STATE_MAX_AGE_SEC));

    return new Response(null, { status: 302, headers });
  },
};
