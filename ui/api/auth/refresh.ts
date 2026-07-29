/**
 * refresh.ts — mints a fresh GitHub access token from a refresh_token, for iOS.
 * Web doesn't need this: ensureFreshSession (_lib/session.ts) does the same exchange inline.
 * iOS holds its refresh_token in Keychain with no client_secret embedded in the app, so it
 * needs this server-side helper for the confidential part of the exchange.
 * No cookie/bearer auth here - possession of a valid refresh_token is the auth; GitHub's own
 * token endpoint validates it, same trust model as callback.ts's initial exchange.
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

    // A thrown network error isn't the same as GitHub rejecting the refresh outright - iOS's
    // validToken() treats these differently (retry vs. give up).
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
      // Refresh token expired (6mo idle) or revoked - genuine "sign in again" case.
      return Response.json({ error: "refresh_failed" }, { status: 401 });
    }

    return Response.json({
      access_token: tokenBody.access_token,
      refresh_token: tokenBody.refresh_token,
      expires_in: tokenBody.expires_in,
    });
  },
};
