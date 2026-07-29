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
