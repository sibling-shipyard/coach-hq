/**
 * Explicit Gemini context caching for the static system-prompt prefix (persona + fixed
 * instructions + few-shot examples - see coach-chat.ts's STATIC_SYSTEM_TEXT). Implicit caching
 * (automatic, on by default) already discounts this, but only on a best-effort basis tied to
 * recent reuse; explicit caching guarantees the discount and stops the text from being resent
 * at all once cached. See docs/eng-docs/gemini-flow.md for the full design and numbers.
 *
 * The cache is not per-athlete - the static prefix is byte-identical for everyone, so one entry
 * (keyed by content hash, so a SOUL redeploy naturally invalidates it) serves every call. The
 * cache name + expiry live in Vercel's Edge Config product (rebranded "Global Config" in the
 * dashboard as of Aug 2026 - same product, connection string var read here as GLOBAL_CONFIG
 * since that's what "Connect Project" names it by default; EDGE_CONFIG_ID + VERCEL_API_TOKEN for
 * writes via the Vercel REST API, since Edge Config/Global Config has no write API of its own).
 * If it isn't configured, or any step here fails, this fails open: callers get `null` and
 * coach-chat.ts falls back to inlining the text in systemInstruction like before explicit
 * caching existed - a broken/misconfigured cache should never block a coaching reply.
 */
import { createClient } from "@vercel/edge-config";
import { fetchWithTimeout } from "./coachChatFiles.js";

const edgeConfigClient = process.env.GLOBAL_CONFIG ? createClient(process.env.GLOBAL_CONFIG) : null;

const EDGE_CONFIG_KEY = "gemini_soul_cache";
const CACHE_TTL_SECONDS = 7200; // 2h - long enough to amortize a normal session, short enough not to go far stale after a SOUL redeploy.

interface CacheRecord {
  name: string;
  expiresAt: number; // epoch ms
  contentHash: string;
  model: string;
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
  if (!edgeConfigClient) return null; // No GLOBAL_CONFIG env var - treat as cache miss.
  try {
    const record = await edgeConfigClient.get<CacheRecord>(EDGE_CONFIG_KEY);
    return record ?? null;
  } catch {
    // Edge Config unreachable - treat as cache miss.
    return null;
  }
}

/** Best-effort: drop the stored record so the next call recreates a cache instead of reusing a
 * name Gemini just rejected. Never throws - a failed invalidation just means one more request
 * pays the round-trip cost of hitting the same stale name before Edge Config's own TTL/next
 * write clears it. */
export async function invalidateCachedSoulName(): Promise<void> {
  const configId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  if (!configId || !token) return;
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  await fetchWithTimeout(
    `https://api.vercel.com/v1/edge-config/${configId}/items${teamQuery}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ operation: "delete", key: EDGE_CONFIG_KEY }] }),
    },
    10_000,
  ).catch(() => {});
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
 *
 * Known race, not fixed here (P2): read-then-write isn't atomic, so concurrent cold starts that
 * all miss the cache at once can each call createCache and each write their own record, the last
 * write winning. Harmless in practice - every created cache is independently valid, Gemini just
 * ends up with a few short-lived orphaned entries instead of one, and they age out via their own
 * TTL. Worth a proper compare-and-swap (or a lock) only if this is ever observed causing real
 * cost/behavior problems, not speculatively.
 */
export async function getCachedSoulName(apiKey: string, model: string, staticSystemText: string): Promise<string | null> {
  const hash = hashText(staticSystemText);
  const existing = await readRecord();
  // Model is checked alongside the content hash, not folded into it - a GEMINI_MODEL bump with
  // SOUL text unchanged must still invalidate: a cachedContents/... name is only valid for the
  // model it was created against, and reusing one across a model change gets rejected by Gemini
  // (the request-time retry in askGemini covers that failure mode too, but there's no reason to
  // pay that round-trip when it's knowable up front).
  if (existing && existing.contentHash === hash && existing.model === model && existing.expiresAt > Date.now()) {
    return existing.name;
  }
  const name = await createCache(apiKey, model, staticSystemText);
  if (!name) return null;
  await writeRecord({ name, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000, contentHash: hash, model });
  return name;
}
