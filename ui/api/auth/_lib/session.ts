/**
 * session.ts — encrypted session cookie helpers, shared by every handler in
 * ui/api/auth/ (and by ios/ once it talks to these same endpoints instead of
 * GitHub directly).
 *
 * The session is a JWE (encrypted, not just signed) so the raw GitHub access
 * token it carries isn't readable even if the cookie value leaks somewhere
 * (logs, a proxy, etc.) — HttpOnly already keeps it from client JS, this is
 * defense in depth on top of that. Key is SESSION_SECRET (32 random bytes,
 * base64-encoded), used directly as an A256GCM key.
 */
import { EncryptJWT, jwtDecrypt } from "jose";

export const SESSION_COOKIE = "coach_session";
export const OAUTH_STATE_COOKIE = "coach_oauth_state";

// Sliding absolute cap on the cookie itself, renewed on every successful refresh (see
// ensureFreshSession below). 180 days rather than unbounded: GitHub's own refresh token is
// only valid 6 months of inactivity (per their docs), so this roughly matches that ceiling -
// anyone who opens the app at least once every 6 months never sees a login screen again, but
// a genuinely abandoned device's session still has a real, bounded worst case instead of
// living forever.
export const SESSION_MAX_AGE_SEC = 180 * 24 * 60 * 60;

// Refresh this many ms before the access token's actual expiry, so a request never races a
// token that's about to die mid-flight.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";

export interface SessionPayload {
  github_user_id: number;
  login: string;
  gh_token: string;
  refresh_token: string;
  // Epoch ms. GitHub's own access token expiry (currently 8h - coach-phelps has "expire user
  // authorization tokens" opted in) - not the cookie's own expiry, which is the separate,
  // much longer SESSION_MAX_AGE_SEC above.
  gh_token_expires_at: number;
  installation_id: number;
  repo_full_name?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getEncryptionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not configured");
  return base64ToBytes(secret);
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  const key = getEncryptionKey();
  // JWE's own exp claim is the cookie's sliding cap, not the (much shorter) GitHub token
  // expiry embedded in the payload - the two are deliberately different clocks.
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .encrypt(key);
}

export async function decryptSession(token: string): Promise<SessionPayload | null> {
  try {
    const key = getEncryptionKey();
    const { payload } = await jwtDecrypt(token, key);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildCookie(name: string, value: string, maxAgeSec: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ].join("; ");
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export interface FreshSession {
  session: SessionPayload;
  // Present only when the access token was actually rotated this request - caller must
  // attach this as a Set-Cookie header on whatever response it returns, via
  // withSessionCookie() below, so the sliding renewal actually reaches the browser.
  setCookie?: string;
}

/**
 * The one place session cookies get read and, if needed, silently refreshed. Every handler
 * that used to do parseCookies -> decryptSession -> use session.gh_token directly should call
 * this instead - see round 4's plan for why: GitHub's own access token dies at 8h regardless
 * of the cookie's lifetime (coach-phelps has "expire user authorization tokens" opted in), so
 * treating the cookie alone as "is this session good" was already subtly wrong even before
 * this existed. This is what makes "stay logged in until you log out" actually work instead
 * of just moving the 8h wall into a confusing mid-session 401.
 */
export async function ensureFreshSession(req: Request): Promise<FreshSession | Response> {
  const cookies = parseCookies(req);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const session = await decryptSession(raw);
  if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

  if (Date.now() < session.gh_token_expires_at - REFRESH_BUFFER_MS) {
    return { session };
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Response.json({ error: "Site misconfigured" }, { status: 500 });
  }

  const refreshRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
    }),
  });

  const body = await refreshRes.json().catch(() => null);
  if (!refreshRes.ok || !body?.access_token || !body?.refresh_token || !body?.expires_in) {
    // Refresh token itself expired (6 months idle) or the user revoked the App's access on
    // GitHub's side - either way, this is a genuine "sign in again" case, not a transient
    // blip. Same shape RepoDataGate.tsx's accessRevoked state already expects.
    return Response.json(
      { error: "Your GitHub access was revoked or expired - sign in again to reconnect." },
      { status: 401 },
    );
  }

  const newSession: SessionPayload = {
    ...session,
    gh_token: body.access_token,
    refresh_token: body.refresh_token,
    gh_token_expires_at: Date.now() + Number(body.expires_in) * 1000,
  };
  const newCookieValue = await encryptSession(newSession);

  return {
    session: newSession,
    setCookie: buildCookie(SESSION_COOKIE, newCookieValue, SESSION_MAX_AGE_SEC),
  };
}

/** Attaches ensureFreshSession's rotated cookie (if any) to a handler's response. */
export function withSessionCookie(res: Response, setCookie?: string): Response {
  if (!setCookie) return res;
  const headers = new Headers(res.headers);
  headers.append("Set-Cookie", setCookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
