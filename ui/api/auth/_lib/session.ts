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
import { queueServerException } from "../../_lib/sentry.js";

export const SESSION_COOKIE = "coach_session";
export const OAUTH_STATE_COOKIE = "coach_oauth_state";

// Sliding cap, renewed on each refresh (ensureFreshSession below) - roughly matches GitHub's
// own 6-month refresh-token validity. See ADR 0009 for the full reasoning.
export const SESSION_MAX_AGE_SEC = 180 * 24 * 60 * 60;

// Refresh this long before the access token's real expiry, so a request never races a token
// that's about to die mid-flight.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const CLIENT_ID = process.env.GITHUB_APP_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GITHUB_APP_CLIENT_SECRET ?? "";

export interface SessionPayload {
  github_user_id: number;
  login: string;
  gh_token: string;
  refresh_token: string;
  /** Epoch ms - GitHub's access-token expiry, distinct from the cookie's own SESSION_MAX_AGE_SEC. */
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
  return new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .encrypt(key);
}

/** jose's code for a cookie that only aged out. Every other code is a fault - see below. */
const JWT_EXPIRED = "ERR_JWT_EXPIRED";

export async function decryptSession(token: string): Promise<SessionPayload | null> {
  try {
    const key = getEncryptionKey();
    const { payload } = await jwtDecrypt(token, key);
    return payload as unknown as SessionPayload;
  } catch (err) {
    // Null is the whole answer here, and it reaches the athlete as "Not authenticated" - so a
    // rotated or unset SESSION_SECRET, a corrupted cookie, and a tampered one are all
    // indistinguishable from signing out, and are recorded nowhere. A cookie past
    // SESSION_MAX_AGE_SEC is the one case that really is signed out; jose codes it
    // ERR_JWT_EXPIRED and it stays uncaptured.
    if ((err as { code?: unknown } | null)?.code !== JWT_EXPIRED) {
      // Queued, never flushed here. decryptSession runs under ensureFreshSession on every
      // authenticated request, and captureServerException awaits a 2s flush - so on the very
      // failure this exists to reveal (a rotated SESSION_SECRET) every request from every
      // athlete would wait on it, and any caller could trigger that with a junk cookie. The
      // route wrapper already owns one flush per request; this rides it.
      console.error("[auth/session] session cookie did not decrypt", err);
      queueServerException(err);
    }
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
  /** Set only when the token was rotated this request - attach via withSessionCookie(). */
  setCookie?: string;
}

/**
 * The one place session cookies get read and, if needed, silently refreshed (ADR 0009).
 * Every handler should call this instead of parseCookies + decryptSession directly.
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

  // A thrown network error isn't a genuine rejection - fall back below rather than force a
  // re-login over a transient blip.
  let refreshRes: Response;
  try {
    refreshRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: session.refresh_token,
      }),
    });
  } catch {
    return { session };
  }

  const body = await refreshRes.json().catch(() => null);
  if (!refreshRes.ok || !body?.access_token || !body?.refresh_token || !body?.expires_in) {
    // Not necessarily a dead session (issue #117): GitHub rotates refresh_token on each use,
    // so two concurrent requests racing near the 8h boundary means the loser's exchange gets
    // rejected even though the session is fine. We refresh 5min early (REFRESH_BUFFER_MS), so
    // the old token is almost certainly still valid - fall back to it unrefreshed rather than
    // hard-fail. A genuine revocation surfaces on its own once that old token is actually used
    // (repo-file.ts's 401 check), a more reliable signal than guessing here. Matches iOS's
    // validToken(), which has always worked this way.
    return { session };
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
