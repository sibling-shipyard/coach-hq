import { generateRandomString, generateCodeChallenge } from "./_lib/pkce.js";
import { buildCookie, OAUTH_STATE_COOKIE } from "./_lib/session.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 min - just needs to survive the redirect round trip

// Local testing note: `vercel dev --listen 3000` doesn't reliably pick up ui/.env.local on
// its own in this project - source it into the shell first (`set -a; source .env.local; set
// +a`) before launching, otherwise GITHUB_APP_CLIENT_ID etc. read as unset here. Also run it
// from inside ui/ - vercel.json's SPA rewrite can intercept Vite's own dev asset requests
// (blank page, /src/main.tsx returns index.html) if invoked from the wrong cwd.

// The single "Continue with GitHub" entry point - same URL for brand-new and returning
// users. Unlike the old two-button split, this never routes through
// /apps/<slug>/installations/new itself; it always hits GitHub's plain sign-in endpoint,
// which recognizes an existing installation and skips straight to authorization for
// returning users. callback.ts is what decides whether a first-time user needs routing
// into repo creation + install - see ui/api/auth/callback.ts and pages/Setup.tsx.
//
// ?platform=ios: iOS opens this same URL in an ASWebAuthenticationSession instead of a
// browser tab. The value rides through in the state cookie (same one that already carries
// `state`/`codeVerifier` across the redirect) so callback.ts knows to hand back a
// coachhq://callback redirect with the raw token instead of a Set-Cookie session - see
// GitHubAuthManager.swift.
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";

    if (!CLIENT_ID) {
      // Redirects rather than a bare JSON body, same reasoning as callback.ts's
      // errorRedirect - this is reached by direct navigation (a clicked link, or iOS opening
      // it in a web session), not a fetch() call, so raw JSON just shows as unstyled text
      // with no way forward. Confirmed this was actually hit once during local testing when
      // env vars weren't loaded.
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

    const tempValue = JSON.stringify({ state, codeVerifier, platform });

    const headers = new Headers();
    headers.set("Location", authorizeUrl.toString());
    headers.append("Set-Cookie", buildCookie(OAUTH_STATE_COOKIE, tempValue, OAUTH_STATE_MAX_AGE_SEC));

    return new Response(null, { status: 302, headers });
  },
};
