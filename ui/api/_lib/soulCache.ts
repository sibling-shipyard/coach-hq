/**
 * Explicit Gemini context caching for the static system-prompt prefix (persona + fixed
 * instructions + few-shot examples - see coach-chat.ts's STATIC_SYSTEM_TEXT). Implicit caching
 * (automatic, on by default) already discounts this, but only on a best-effort basis tied to
 * recent reuse; explicit caching guarantees the discount and stops the text from being resent
 * at all once cached. See docs/eng-docs/gemini-flow.md for the full design and numbers.
 *
 * The cache is not per-athlete - the static prefix is byte-identical for everyone, so one entry
 * (keyed by content hash, so a SOUL redeploy naturally invalidates it) serves every call. The
 * cache name + expiry live in Vercel Edge Config (EDGE_CONFIG env var for reads via the SDK,
 * EDGE_CONFIG_ID + VERCEL_API_TOKEN for writes via the Vercel REST API - Edge Config has no
 * write API of its own). If Edge Config isn't configured, or any step here fails, this fails
 * open: callers get `null` and coach-chat.ts falls back to inlining the text in
 * systemInstruction like before explicit caching existed - a broken/misconfigured cache should
 * never block a coaching reply.
 */
import { get } from "@vercel/edge-config";
import { fetchWithTimeout } from "./coachChatFiles.js";

const EDGE_CONFIG_KEY = "gemini_soul_cache";
const CACHE_TTL_SECONDS = 7200; // 2h - long enough to amortize a normal session, short enough not to go far stale after a SOUL redeploy.

interface CacheRecord {
  name: string;
  expiresAt: number; // epoch ms
  contentHash: string;
}

// Cheap non-cryptographic hash - this only needs to detect "the static prefix text changed
// since we cached it," not resist tampering.
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return `${text.length}-${h}`;
}

async function readRecord(): Promise<CacheRecord | null> {
  try {
    const record = await get<CacheRecord>(EDGE_CONFIG_KEY);
    return record ?? null;
  } catch {
    // No EDGE_CONFIG env var, or Edge Config unreachable - treat as cache miss.
    return null;
  }
}

async function writeRecord(record: CacheRecord): Promise<void> {
  const configId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  if (!configId || !token) return; // Not configured - this request still works (see getCachedSoulName), just won't persist.
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  await fetchWithTimeout(
    `https://api.vercel.com/v1/edge-config/${configId}/items${teamQuery}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ operation: "upsert", key: EDGE_CONFIG_KEY, value: record }] }),
    },
    10_000,
  ).catch(() => {
    // Best-effort - a failed write just means the next cold instance recreates the cache.
  });
}

async function createCache(apiKey: string, model: string, staticSystemText: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: `models/${model}`,
          systemInstruction: { parts: [{ text: staticSystemText }] },
          ttl: `${CACHE_TTL_SECONDS}s`,
          displayName: "coach-chat-soul-prefix",
        }),
      },
      10_000,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string };
    return body.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns a Gemini `cachedContents/...` name to pass as `cachedContent` on generateContent
 * calls, or `null` if explicit caching isn't available right now (not configured, or the
 * create call failed) - callers must fall back to inlining `staticSystemText` in
 * `systemInstruction` in that case, since Gemini rejects a request that sets both `cachedContent`
 * and `systemInstruction`.
 */
export async function getCachedSoulName(apiKey: string, model: string, staticSystemText: string): Promise<string | null> {
  const hash = hashText(staticSystemText);
  const existing = await readRecord();
  if (existing && existing.contentHash === hash && existing.expiresAt > Date.now()) {
    return existing.name;
  }
  const name = await createCache(apiKey, model, staticSystemText);
  if (!name) return null;
  await writeRecord({ name, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000, contentHash: hash });
  return name;
}
