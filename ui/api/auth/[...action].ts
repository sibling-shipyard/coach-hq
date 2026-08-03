/**
 * ui/api/auth/[...action].ts — every OAuth/session auth endpoint, consolidated into one
 * Vercel catch-all route. See kdb/decisions/0017-vercel-function-count-catch-all-routes.md.
 *
 * Vercel's Hobby plan caps a deployment at 12 serverless functions, one per top-level
 * api/*.ts file. This used to be 7 separate files (start.ts, install-redirect.ts, callback.ts,
 * logout.ts, me.ts, refresh.ts, list-my-repos.ts) - each is now a plain exported function below,
 * and the default export at the bottom dispatches on the URL's dynamic segment. Vercel maps
 * `/api/auth/*` onto this single file automatically (no vercel.json rewrites needed), so every
 * existing URL (`/api/auth/callback`, `/api/auth/me`, etc.) resolves identically to before -
 * critically including `/api/auth/callback`, which is registered as the GitHub OAuth App's
 * callback URL and must never change.
 *
 * Each handler below is close to a verbatim move of its original file's body - only renamed to
 * a named export (`handle<Name>`) and any module-scope constant/helper it shared with another
 * file (CLIENT_ID, APP_SLUG, OAUTH_STATE_MAX_AGE_SEC) deduplicated at the top.
 */
import {
  encryptSession,
  buildCookie,
  clearCookie,
  parseCookies,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  ensureFreshSession,
  withSessionCookie,
  type SessionPayload,
} from "./_lib/session.js";
import {
  resolveInstallationId,
  resolveOwnedRepos,
  isOwnedBy,
  hasMarkerFile,
  InstallationLookupFailedError,
  MarkerLookupFailedError,
} from "./_lib/repo-resolution.js";
import {
  generateRandomString,
  generateCodeChallenge,
  signOAuthState,
  verifyOAuthState,
  fromBase64Url,
} from "./_lib/pkce.js";

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";
const APP_SLUG = process.env.GITHUB_APP_SLUG ?? "coach-phelps";
// HMAC key for the stateless OAuth state parameter. SESSION_SECRET is preferred but
// CLIENT_SECRET is a valid fallback — it's already a non-empty confidential value that's
// consistent across all function invocations, and the state HMAC only needs to prevent
// tampering in transit, not provide session confidentiality.
const OAUTH_HMAC_SECRET = process.env.SESSION_SECRET || CLIENT_SECRET;
if (!process.env.SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET is unset — falling back to CLIENT_SECRET for OAuth state HMAC");
}

// ============================================================================
// start.ts — single "Log in with GitHub" entry point for both new and returning users -
// always hits GitHub's plain sign-in endpoint; handleCallback decides whether a first-timer
// needs routing into Setup.tsx's repo creation + install flow.
//
// ?platform=ios rides through the state cookie so handleCallback knows to hand back a
// coachhq://callback redirect instead of a Set-Cookie session - see GitHubAuthManager.swift.
// ============================================================================
export async function handleStart(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";
  // ?popup=1 - opened via GitHubAuthButton's window.open() instead of a full-page nav;
  // handleCallback routes back to a self-closing page instead of redirecting this whole tab.
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

  const codeVerifier = generateRandomString(48);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const redirectUri = `${url.origin}/api/auth/callback`;

  // State is HMAC-signed and embedded in the OAuth `state` parameter so GitHub echoes it
  // back in the callback URL. This avoids a Set-Cookie on the 302, which WKWebView
  // (iOS in-app browser) silently drops, breaking the auth flow.
  const state = await signOAuthState({ codeVerifier, platform, popup }, OAUTH_HMAC_SECRET);

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers();
  headers.set("Location", authorizeUrl.toString());
  return new Response(null, { status: 302, headers });
}

// ============================================================================
// install-redirect.ts — called by Setup.tsx's "Continue to install" button (and
// SetupView.swift with ?platform=ios) after the user has created their coach-<login> repo
// from the template. /apps/<slug>/installations/new shows GitHub's repo picker so they can
// attach the App to it.
// ============================================================================
export async function handleInstallRedirect(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const platform = url.searchParams.get("platform") === "ios" ? "ios" : "web";
  // See handleStart - Setup.tsx's popup step 2 opens this in a popup instead of a full nav.
  const popup = platform === "web" && url.searchParams.get("popup") === "1";

  if (!CLIENT_ID) {
    // See handleStart's identical check for why this redirects instead of returning JSON.
    const headers = new Headers();
    headers.set(
      "Location",
      platform === "ios" ? "coachhq://callback?error=config_error" : `${url.origin}/?auth_error=config_error`,
    );
    return new Response(null, { status: 302, headers });
  }

  const codeVerifier = generateRandomString(48);
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const redirectUri = `${url.origin}/api/auth/callback`;

  const state = await signOAuthState({ codeVerifier, platform, popup }, OAUTH_HMAC_SECRET);

  // /installations/new/permissions runs the combined OAuth+install flow and returns
  // `code` in the callback; handleCallback requires `code` to exchange for a token.
  // suggested_target_id pre-selects the account and is required for this endpoint —
  // GitHub 404s without it. iOS always provides a valid user ID now (handleCallback
  // includes the token in the needs_setup=1 redirect so the client can call fetchUser).
  const suggestedTargetId = url.searchParams.get("suggested_target_id");
  const installUrl = new URL(`https://github.com/apps/${APP_SLUG}/installations/new/permissions`);
  if (suggestedTargetId) {
    installUrl.searchParams.set("suggested_target_id", suggestedTargetId);
    installUrl.searchParams.set("target_type", "User");
  }
  installUrl.searchParams.set("state", state);
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("client_id", CLIENT_ID);
  installUrl.searchParams.set("code_challenge", codeChallenge);
  installUrl.searchParams.set("code_challenge_method", "S256");

  const headers = new Headers();
  headers.set("Location", installUrl.toString());
  return new Response(null, { status: 302, headers });
}

// ============================================================================
// callback.ts — reached by the browser (or iOS's ASWebAuthenticationSession) navigating here
// directly, not by a fetch() from React - so failures redirect to a platform-appropriate
// destination (AuthError.tsx, or iOS's coachhq:// scheme) rather than returning raw JSON.
// In popup mode (GitHubAuthButton's window.open flow) every terminal redirect instead goes to
// AuthPopupComplete.tsx, which posts the result back to window.opener and closes itself - the
// popup never shows AuthError.tsx/Setup.tsx/the dashboard directly, the *opener* tab does.
// ============================================================================
// Decode platform from the state payload WITHOUT verifying the HMAC so that error
// redirects go to the right destination (coachhq://… for iOS) even when verification
// fails and tempData is not yet available. Safe because platform only affects routing,
// not any privileged action.
function extractPlatformFromState(stateParam: string | null): "web" | "ios" {
  if (!stateParam) return "web";
  try {
    const dot = stateParam.lastIndexOf(".");
    if (dot === -1) return "web";
    const json = new TextDecoder().decode(fromBase64Url(stateParam.slice(0, dot)));
    const d = JSON.parse(json) as Record<string, unknown>;
    return d.platform === "ios" ? "ios" : "web";
  } catch {
    return "web";
  }
}

function callbackErrorRedirect(
  origin: string,
  type: string,
  platform: "web" | "ios" = "web",
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
  return new Response(null, { status: 302, headers });
}

// iOS still handles first-time setup natively (SetupView.swift) since GitHub App tokens can't
// create repos on a personal account (confirmed via 404/403 on /repos/{template}/generate and
// /user/repos) - it has to be a GitHub-native step. Web no longer has an equivalent wizard:
// setup only happens in the iOS app now, so a web user with no install just gets sent to
// AuthError's needs_ios_setup message instead.
function callbackSetupRedirect(
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
  return new Response(null, { status: 302, headers });
}

export async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  try {
    return await callbackImpl(url);
  } catch {
    return callbackErrorRedirect(url.origin, "network_error", extractPlatformFromState(url.searchParams.get("state")));
  }
}

// GitHub API calls below aren't individually try/caught - a thrown exception (DNS blip, timeout)
// is caught by handleCallback's wrapper above instead of falling through to Vercel's generic
// 500 page.
async function callbackImpl(url: URL): Promise<Response> {
  // Extract platform before any other check so even the config_error bailout routes iOS
  // to coachhq:// instead of the web homepage - see extractPlatformFromState's doc comment.
  const unverifiedPlatform = extractPlatformFromState(url.searchParams.get("state"));

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return callbackErrorRedirect(url.origin, "config_error", unverifiedPlatform, false);
  }

  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return callbackErrorRedirect(url.origin, "missing_params", unverifiedPlatform, false);
  }

  // State is HMAC-signed (set by handleStart/handleInstallRedirect) — no cookie needed.
  const tempData = await verifyOAuthState(stateParam, OAUTH_HMAC_SECRET);
  if (!tempData) {
    return callbackErrorRedirect(url.origin, "corrupt_oauth_session", unverifiedPlatform, false);
  }

  const platform: "web" | "ios" = tempData.platform;
  const popup = platform === "web" && tempData.popup;

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
    return callbackErrorRedirect(url.origin, "token_exchange_failed", platform, popup);
  }
  // refresh_token/expires_in are always present - "expire user authorization tokens" is
  // opted in on the GitHub App. ensureFreshSession / iOS's refresh logic need both to rotate.
  if (!tokenBody.refresh_token || !tokenBody.expires_in) {
    return callbackErrorRedirect(url.origin, "token_exchange_failed", platform, popup);
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
    return callbackErrorRedirect(url.origin, "user_fetch_failed", platform, popup);
  }

  const user = await userRes.json();

  let installationId: number | null;
  try {
    installationId = await resolveInstallationId(ghToken, user.login as string, APP_SLUG);
  } catch (e) {
    if (e instanceof InstallationLookupFailedError) {
      return callbackErrorRedirect(url.origin, "lookup_failed", platform, popup);
    }
    throw e;
  }

  if (!installationId) {
    // iOS: include the token so GitHubAuthManager can call fetchUser() and populate
    // user.id before the install step. handleInstallRedirect requires a valid
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
      return new Response(null, { status: 302, headers });
    }
    return callbackSetupRedirect(url.origin, user.login as string, platform, popup);
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

  return new Response(null, { status: 302, headers });
}

// ============================================================================
// logout.ts
// ============================================================================
export async function handleLogout(): Promise<Response> {
  const headers = new Headers();
  headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
}

// ============================================================================
// me.ts — returns current session user info.
// ============================================================================
export async function handleMe(req: Request): Promise<Response> {
  const fresh = await ensureFreshSession(req);
  if (fresh instanceof Response) return fresh;

  return withSessionCookie(
    Response.json({
      github_user_id: fresh.session.github_user_id,
      login: fresh.session.login,
      repo_full_name: fresh.session.repo_full_name ?? null,
    }),
    fresh.setCookie,
  );
}

// ============================================================================
// refresh.ts — mints a fresh GitHub access token from a refresh_token, for iOS.
// Web doesn't need this: ensureFreshSession (_lib/session.ts) does the same exchange inline.
// iOS holds its refresh_token in Keychain with no client_secret embedded in the app, so it
// needs this server-side helper for the confidential part of the exchange.
// No cookie/bearer auth here - possession of a valid refresh_token is the auth; GitHub's own
// token endpoint validates it, same trust model as handleCallback's initial exchange.
// ============================================================================
export async function handleRefresh(req: Request): Promise<Response> {
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
}

// ============================================================================
// list-my-repos.ts — repo resolution: find the signed-in user's coach-phelps repo and
// remember it in their session. Almost always resolves to exactly one candidate (installs
// are single-repo by design), but keeps the marker-file check and picker path for accounts
// installed before that convention.
//
// Auth: session cookie (web) or Authorization: Bearer <github_token> (iOS, before it has a
// resolved repo for X-Coach-Repo). This is iOS's fallback for the 0-or-2+ candidate case;
// handleCallback already includes `repo` in its redirect for the common single-candidate case.
//
// GET                          → list/confirm candidates, auto-select if exactly one.
// POST ?select=<owner>/<name>  → confirm and persist a specific pick (2+ case). POST because
//                                 this mutates the session cookie - a GET would be reachable
//                                 via link prefetching/CSRF from a plain browser tab.
// ============================================================================
interface ListMyReposAuthContext {
  login: string;
  gh_token: string;
  installation_id: number;
  repo_full_name?: string;
  via: "cookie" | "bearer";
  /** Cookie mode only - full session, spread into any new session this handler builds so a
   * rotated token from ensureFreshSession never gets dropped. */
  fullSession?: SessionPayload;
  /** Cookie mode only - set when ensureFreshSession rotated the token this request. Only
   * needs attaching to responses that don't already Set-Cookie a full new session. */
  rotatedCookie?: string;
}

async function resolveListMyReposAuthContext(req: Request): Promise<ListMyReposAuthContext | Response> {
  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) {
    const fresh = await ensureFreshSession(req);
    if (fresh instanceof Response) return fresh;
    return {
      login: fresh.session.login,
      gh_token: fresh.session.gh_token,
      installation_id: fresh.session.installation_id,
      repo_full_name: fresh.session.repo_full_name,
      via: "cookie",
      fullSession: fresh.session,
      rotatedCookie: fresh.setCookie,
    };
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authorization.slice("Bearer ".length).trim();

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userRes.ok) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const user = await userRes.json();

  let installationId: number | null;
  try {
    installationId = await resolveInstallationId(token, user.login as string, APP_SLUG);
  } catch (e) {
    if (e instanceof InstallationLookupFailedError) {
      return Response.json({ error: "Failed to look up installation" }, { status: 502 });
    }
    throw e;
  }
  if (!installationId) return Response.json({ error: "Not authenticated" }, { status: 401 });

  return { login: user.login as string, gh_token: token, installation_id: installationId, via: "bearer" };
}

function withUpdatedSession(body: unknown, sessionToken: string, status = 200): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.append("Set-Cookie", buildCookie(SESSION_COOKIE, sessionToken, SESSION_MAX_AGE_SEC));
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleListMyRepos(req: Request): Promise<Response> {
  // Declared outside the try block so a throw can still attach a rotated cookie -
  // refresh_token is single-use (ADR 0009), losing a rotation strands the next request.
  let ctx: ListMyReposAuthContext | undefined;
  try {
    const resolved = await resolveListMyReposAuthContext(req);
    if (resolved instanceof Response) return resolved;
    ctx = resolved;
    return await listMyReposImpl(req, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to look up your repos";
    console.error("[list-my-repos]", err);
    return withSessionCookie(Response.json({ error: message }, { status: 502 }), ctx?.rotatedCookie);
  }
}

async function listMyReposImpl(req: Request, ctx: ListMyReposAuthContext): Promise<Response> {
  const url = new URL(req.url);
  const selected = url.searchParams.get("select");

  // Explicit pick from a 2+ candidate list - mutates the session, so only POST accepts it.
  // A GET here would be reachable via link prefetching/CSRF now that RepoPicker.tsx calls
  // this from a plain browser tab (previously only iOS's bearer-token flow used this route).
  if (selected) {
    if (req.method !== "POST") {
      return withSessionCookie(
        Response.json({ error: "Use POST to select a repo" }, { status: 405 }),
        ctx.rotatedCookie,
      );
    }
    if (!isOwnedBy(selected, ctx.login)) {
      return withSessionCookie(
        Response.json({ error: "You can only select a repo you own" }, { status: 403 }),
        ctx.rotatedCookie,
      );
    }
    const ok = await hasMarkerFile(selected, ctx.gh_token);
    if (!ok) {
      return withSessionCookie(
        Response.json(
          { error: "That repo doesn't look like a coach-phelps repo (no user_data/ledger/challenge_v2.json)" },
          { status: 400 }
        ),
        ctx.rotatedCookie,
      );
    }
    if (ctx.via === "bearer") {
      return Response.json({ repo_full_name: selected });
    }
    // fullSession already carries any rotation - this Set-Cookie supersedes it.
    const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: selected });
    return withUpdatedSession({ repo_full_name: selected }, newSession);
  }

  // Re-confirm an already-resolved repo still exists and is owned by this account before
  // trusting it. Bearer auth never has a cached repo_full_name.
  if (ctx.repo_full_name) {
    const stillOwned = isOwnedBy(ctx.repo_full_name, ctx.login);
    const stillOk = stillOwned && (await hasMarkerFile(ctx.repo_full_name, ctx.gh_token));
    if (stillOk) {
      return withSessionCookie(Response.json({ repo_full_name: ctx.repo_full_name }), ctx.rotatedCookie);
    }
    // Falls through to re-resolve if not owned or it 404s (deleted/renamed/access lost).
  }

  let confirmed: string[];
  try {
    confirmed = await resolveOwnedRepos(ctx.installation_id, ctx.gh_token, ctx.login);
  } catch (e) {
    if (e instanceof MarkerLookupFailedError) {
      return withSessionCookie(
        Response.json({ error: "Failed to check your repos - try again" }, { status: 502 }),
        ctx.rotatedCookie,
      );
    }
    throw e;
  }

  // Auto-select on exactly one match.
  if (confirmed.length === 1) {
    if (ctx.via === "bearer") {
      return Response.json({ repo_full_name: confirmed[0] });
    }
    const newSession = await encryptSession({ ...ctx.fullSession!, repo_full_name: confirmed[0] });
    return withUpdatedSession({ repo_full_name: confirmed[0] }, newSession);
  }

  // Distinguish "nothing granted that you own" (fix: Setup wizard) from "some repos
  // granted, none look like a coach-phelps repo" (fix: finish setup) - different messaging.
  if (confirmed.length === 0) {
    const reposRes = await fetch(
      `https://api.github.com/user/installations/${ctx.installation_id}/repositories?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${ctx.gh_token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    const { repositories } = reposRes.ok
      ? ((await reposRes.json()) as { repositories: Array<{ owner: { login: string } }> })
      : { repositories: [] };
    const ownRepos = repositories.filter((r) => r.owner.login.toLowerCase() === ctx.login.toLowerCase());
    const reason = ownRepos.length === 0 ? "no_owned_repos" : "no_marker_match";
    return withSessionCookie(Response.json({ candidates: [], reason }), ctx.rotatedCookie);
  }

  // 2+ candidates - client renders the picker.
  return withSessionCookie(Response.json({ candidates: confirmed }), ctx.rotatedCookie);
}

// ============================================================================
// Dispatcher — Vercel's catch-all convention maps every /api/auth/<segment> request here.
// ============================================================================
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.replace(/^\/api\/auth\/?/, "").replace(/\/$/, "");
    switch (action) {
      case "start":
        return handleStart(req);
      case "install-redirect":
        return handleInstallRedirect(req);
      case "callback":
        return handleCallback(req);
      case "logout":
        return handleLogout();
      case "me":
        return handleMe(req);
      case "refresh":
        return handleRefresh(req);
      case "list-my-repos":
        return handleListMyRepos(req);
      default:
        return Response.json({ error: "Not found" }, { status: 404 });
    }
  },
};
