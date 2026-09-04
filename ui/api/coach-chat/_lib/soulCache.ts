/**
 * Shared, fail-open Gemini cache for the static system-prompt prefix (persona + fixed
 * instructions + few-shot examples). Guarantees the caching discount instead of implicit
 * caching's best-effort one. See docs/eng-docs/gemini-flow.md for the full design and numbers.
 *
 * Not per-athlete - one entry (keyed by content hash) serves every call. Cache name + expiry
 * live in Vercel's Edge Config ("Global Config" in the dashboard as of Aug 2026; GLOBAL_CONFIG
 * for reads, EDGE_CONFIG_ID + VERCEL_API_TOKEN for writes via the REST API, since Edge Config
 * has no write API of its own). Fails open on any error - callers get `null` and coach-chat
 * falls back to inlining the text in systemInstruction.
 */
import { createClient } from "@vercel/edge-config";
import { GEMINI_API_BASE_URL, geminiAuthHeaders } from "../../_lib/geminiAuth.js";
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";

const edgeConfigClient = process.env.GLOBAL_CONFIG ? createClient(process.env.GLOBAL_CONFIG) : null;

const EDGE_CONFIG_KEY = "gemini_soul_cache";
// 24h, not 2h - the content hash already catches a SOUL redeploy immediately regardless of TTL
// (see getCachedSoulName below), so TTL only bounds a stale-but-unhashed edge case that's
// already theoretical. A shorter TTL costs real money here: every expiry is a Global Config
// write, and the free tier caps at 250/month (issue #624) - 2h implied ~360/month before even
// counting the documented concurrent-cold-start race below, well over quota.
const CACHE_TTL_SECONDS = 86400;

interface CacheRecord {
  name: string;
  expiresAt: number; // epoch ms
  contentHash: string;
  model: string;
}

// Cheap non-cryptographic hash - only needs to detect drift, not resist tampering.
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return `${text.length}-${h}`;
}

async function readRecord(): Promise<CacheRecord | null> {
  if (!edgeConfigClient) {
    console.warn(
      "[soulCache] GLOBAL_CONFIG not set - explicit caching disabled, falling back to inline prompt every call.",
    );
    return null;
  }
  try {
    const record = await edgeConfigClient.get<CacheRecord>(EDGE_CONFIG_KEY);
    return record ?? null;
  } catch (err) {
    // Treat as cache miss, but log so a persistent failure is diagnosable from Runtime Logs.
    console.warn("[soulCache] Edge Config read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Best-effort: drops the stored record so the next call recreates a cache instead of reusing a
 * name Gemini just rejected. Never throws. */
export async function invalidateCachedSoulName(): Promise<void> {
  const configId = process.env.EDGE_CONFIG_ID;
  const token = process.env.VERCEL_API_TOKEN;
  if (!configId || !token) return;
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  await fetchWithTimeout(
    // /v1/global-config/... (renamed from /v1/edge-config/... in the Aug 2026 rebrand)
    `https://api.vercel.com/v1/global-config/${configId}/items${teamQuery}`,
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
  if (!configId || !token) {
    console.warn(
      "[soulCache] EDGE_CONFIG_ID/VERCEL_API_TOKEN not set - cache name created but can't persist, every cold start will recreate it.",
    );
    return;
  }
  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const res = await fetchWithTimeout(
    // /v1/global-config/... (renamed from /v1/edge-config/... in the Aug 2026 rebrand)
    `https://api.vercel.com/v1/global-config/${configId}/items${teamQuery}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: EDGE_CONFIG_KEY, value: record }],
      }),
    },
    10_000,
  ).catch((err) => {
    console.warn(
      "[soulCache] Edge Config write request failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  // Best-effort - a failed write just means the next call recreates the cache, but log a
  // non-2xx status so a persistent misconfiguration is diagnosable.
  if (res && !res.ok) {
    const detail = await res.text().catch(() => "");
    console.warn(`[soulCache] Edge Config write rejected (${res.status}):`, detail);
  }
}

async function createCache(
  apiKey: string,
  model: string,
  staticSystemText: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `${GEMINI_API_BASE_URL}/cachedContents`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...geminiAuthHeaders(apiKey) },
        body: JSON.stringify({
          model: `models/${model}`,
          systemInstruction: { parts: [{ text: staticSystemText }] },
          ttl: `${CACHE_TTL_SECONDS}s`,
          displayName: "coach-chat-soul-prefix",
        }),
      },
      10_000,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[soulCache] cachedContents create rejected (${res.status}):`, detail);
      return null;
    }
    const body = (await res.json()) as { name?: string };
    return body.name ?? null;
  } catch (err) {
    console.warn(
      "[soulCache] cachedContents create request failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Returns a Gemini `cachedContents/...` name to pass as `cachedContent`, or `null` if explicit
 * caching isn't available right now - callers fall back to inlining `staticSystemText` in
 * `systemInstruction` in that case.
 *
 * Known race, not fixed (P2): read-then-write isn't atomic, so concurrent cold starts can each
 * create and write their own record. Harmless - every cache is independently valid, just leaves
 * short-lived orphaned entries that age out via TTL.
 */
export async function getCachedSoulName(
  apiKey: string,
  model: string,
  staticSystemText: string,
): Promise<string | null> {
  const hash = hashText(staticSystemText);
  const existing = await readRecord();
  // Model checked alongside the hash so a GEMINI_MODEL bump invalidates even with SOUL text
  // unchanged - a cachedContents name is only valid for the model it was created against.
  if (
    existing &&
    existing.contentHash === hash &&
    existing.model === model &&
    existing.expiresAt > Date.now()
  ) {
    return existing.name;
  }
  const name = await createCache(apiKey, model, staticSystemText);
  if (!name) return null;
  await writeRecord({
    name,
    expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
    contentHash: hash,
    model,
  });
  return name;
}
