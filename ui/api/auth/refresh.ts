/**
 * refresh.ts — mints a fresh GitHub access token from a refresh_token, for iOS.
 *
 * The web side never needs this directly: ensureFreshSession (_lib/session.ts) does the same
 * refresh_token exchange inline, since it already holds CLIENT_SECRET server-side and controls
 * the session cookie. iOS holds its own refresh_token in Keychain (no cookie, no
 * client_secret embedded in the app - that's exactly what the OAuth rewrite removed), so it
 * needs a server-side helper to do the confidential part of the exchange on its behalf.
 *
 * No cookie/bearer auth on this endpoint itself - possession of a valid, GitHub-issued
 * refresh_token *is* the auth; GitHub's own token endpoint is what actually validates it.
 * Same trust model as the initial sign-in exchange in callback.ts.
 */
const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      return Response.json({ error: "Site misconfigured" }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as { refresh_token?: string } | null;
    if (!body?.refresh_token) {
      return Response.json({ error: "refresh_token required" }, { status: 400 });
    }

    // A thrown network error (DNS blip, timeout) here isn't the same as GitHub genuinely
    // rejecting the refresh - iOS's validToken() falls back to the possibly-stale existing
    // token either way, but the distinction matters for what it should retry vs. give up on.
    let tokenRes: Response;
    try {
      tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: body.refresh_token,
        }),
      });
    } catch {
      return Response.json({ error: "network_error" }, { status: 502 });
    }

    const tokenBody = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenBody?.access_token || !tokenBody?.refresh_token || !tokenBody?.expires_in) {
      // Refresh token expired (6 months idle) or was revoked - a genuine "sign in again"
      // case, same as ensureFreshSession's equivalent failure on the web side.
      return Response.json({ error: "refresh_failed" }, { status: 401 });
    }

    return Response.json({
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token,
      expires_in: tokenBody.expires_in,
    });
  },
};
