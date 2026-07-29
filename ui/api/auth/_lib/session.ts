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
export const SESSION_MAX_AGE_SEC = 8 * 60 * 60; // ~8h

export interface SessionPayload {
  github_user_id: number;
  login: string;
  gh_token: string;
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
