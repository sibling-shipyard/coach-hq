import { generateRandomString, generateCodeChallenge } from "./_lib/pkce.js";
import { buildCookie, OAUTH_STATE_COOKIE } from "./_lib/session.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const OAUTH_STATE_MAX_AGE_SEC = 600; // 10 min - just needs to survive the redirect round trip

// The single "Continue with GitHub" entry point - same URL for brand-new and returning
// users. Unlike the old two-button split, this never routes through
// /apps/<slug>/installations/new itself; it always hits GitHub's plain sign-in endpoint,
// which recognizes an existing installation and skips straight to authorization for
// returning users. callback.ts is what decides whether a first-time user needs routing
// into repo creation + install - see ui/api/auth/callback.ts and pages/Setup.tsx.
export default {
  async fetch(req: Request): Promise<Response> {
    if (!CLIENT_ID) {
      return Response.json({ error: "GITHUB_APP_CLIENT_ID not configured" }, { status: 500 });
    }

    const state = generateRandomString(24);
    const codeVerifier = generateRandomString(48);
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    const url = new URL(req.url);
    const redirectUri = `${url.origin}/api/auth/callback`;

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    const tempValue = JSON.stringify({ state, codeVerifier });

    const headers = new Headers();
    headers.set("Location", authorizeUrl.toString());
    headers.append("Set-Cookie", buildCookie(OAUTH_STATE_COOKIE, tempValue, OAUTH_STATE_MAX_AGE_SEC));

    return new Response(null, { status: 302, headers });
  },
};
