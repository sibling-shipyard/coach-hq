/**
 * pkce.ts — PKCE + state helpers for the GitHub OAuth authorization-code flow.
 * Pure Web Crypto (crypto.subtle, crypto.getRandomValues) — no Node-only APIs,
 * so this works the same whether ui/api/* ends up on the Edge or Node runtime.
 */

function toBase64Url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random state/verifier string, base64url-encoded. */
export function generateRandomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** S256 code_challenge for a given code_verifier, per RFC 7636. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

// ────────────────────────────────────────────────────────────────────────────
// Stateless OAuth state — replaces the Set-Cookie approach so WKWebView's
// failure to persist cookies on 302 responses doesn't break the iOS auth flow.
// The signed state string is: base64url(json) + "." + base64url(hmac-sha256).
// GitHub echoes state back verbatim in the callback URL, so no server-side
// storage or cookies are needed.
// ────────────────────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  nonce: string;
  codeVerifier: string;
  platform: "web" | "ios";
  popup: boolean;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function fromBase64Url(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/** Encodes and HMAC-signs an OAuth state payload. */
export async function signOAuthState(data: OAuthStatePayload, secret: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(data)));
  const key = await hmacKey(secret, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Verifies the HMAC and decodes the state. Returns null if invalid or malformed. */
export async function verifyOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  const dot = state.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = state.slice(0, dot);
  let sigBytes: Uint8Array;
  try {
    sigBytes = fromBase64Url(state.slice(dot + 1));
  } catch {
    return null;
  }
  const key = await hmacKey(secret, "verify");
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  if (!valid) return null;
  try {
    const json = new TextDecoder().decode(fromBase64Url(payload));
    const d = JSON.parse(json) as Record<string, unknown>;
    return {
      nonce: String(d.nonce ?? ""),
      codeVerifier: String(d.codeVerifier ?? ""),
      platform: d.platform === "ios" ? "ios" : "web",
      popup: Boolean(d.popup),
    };
  } catch {
    return null;
  }
}
