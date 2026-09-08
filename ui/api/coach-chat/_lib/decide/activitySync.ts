/** Activity-sync batch identity, hist lookup, and attachment rows. */
import { createHash } from "node:crypto";
import { getFileRaw, listDirectory, parseJsonOrNull } from "./coachChatFiles.js";
import { todayDividerLabel } from "./coachDay.js";
import {
  appendConversationTurn,
  mergeThreadToFront,
  sanitizeTitle,
  truncateTitle,
  THREAD_TITLE_MAX_CHARS,
  type ChatAttachment,
  type ChatMessage,
  type ChatThread,
  type SyncedActivityListAttachment,
  type SyncedActivityRow,
} from "../chatThreads.js";

export interface ActivitySyncRequest {
  action: "activity_sync";
  activity_ids: string[];
  knownSha?: string;
}

export const HK_ACTIVITY_PREFIX = "hk:";
export const ACTIVITIES_HIST_DIR = "user_data/activities/hist";
export const ACTIVITY_SYNC_USER_TEXT =
  "[Activity sync. Respond to the verified batch in context. The athlete did not type this.]";

const HIST_FILE_RE = /^hk_\d{4}-\d{2}-\d{2}_(.+)\.json$/;

/**
 * `/api/coach-chat`'s activity_sync request qualifies a HealthKit id as `hk:<uuid>`
 * (`ActivitySyncIDs.qualified` client-side) while `/api/coach-message`'s stricter validator
 * requires `healthkit:<UUID>` (`PostSyncFanout.coachActivityIds` client-side) - same activity,
 * two different wire prefixes. Normalize both to the `healthkit:` form, uppercased, before
 * hashing or looking up authoritative activity data, or the same sync's two server calls
 * compute two different batch ids and never find each other's thread.
 */
export function canonicalSyncActivityId(id: string): string {
  if (id.startsWith(HK_ACTIVITY_PREFIX)) {
    return `healthkit:${id.slice(HK_ACTIVITY_PREFIX.length).toUpperCase()}`;
  }
  if (id.startsWith("healthkit:")) {
    return `healthkit:${id.slice("healthkit:".length).toUpperCase()}`;
  }
  return id;
}

export function activitySyncBatchId(activityIds: readonly string[]): string {
  const unique = [...new Set(activityIds.map(canonicalSyncActivityId))].sort();
  return createHash("sha256").update(unique.join("\n")).digest("hex").slice(0, 16);
}

export function parseActivityIds(
  raw: unknown,
): { ok: true; activityIds: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "activity_ids must be a non-empty array" };
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !value.includes(":")) {
      return { ok: false, error: "Unknown activity id prefix" };
    }
    const colon = value.indexOf(":");
    const prefix = value.slice(0, colon + 1);
    const uuid = value.slice(colon + 1);
    if (prefix !== HK_ACTIVITY_PREFIX || uuid.length === 0) {
      return { ok: false, error: "Unknown activity id prefix" };
    }
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return { ok: true, activityIds: unique };
}

export function histUuidFromName(name: string): string | null {
  return name.match(HIST_FILE_RE)?.[1] ?? null;
}

// Must stay aligned with getActivityZoneLoad in
// ui/client/src/components/home-warm/warmHomeModel.ts.
const ZONE_LOAD_WEIGHTS = [1, 2, 3, 4, 5] as const;

export function activityZoneLoad(
  hrZones: Record<string, { seconds?: unknown }> | null | undefined,
): number | null {
  if (!hrZones) return null;
  let observedSeconds = 0;
  const weightedSeconds = ZONE_LOAD_WEIGHTS.reduce((total, weight) => {
    const seconds = Math.max(0, Number(hrZones[`Zone ${weight}`]?.seconds) || 0);
    observedSeconds += seconds;
    return total + seconds * weight;
  }, 0);
  return observedSeconds > 0 ? Math.round(weightedSeconds / 60) : null;
}

interface HistActivityJson {
  name?: unknown;
  sport_type?: unknown;
  start_date_local?: unknown;
  elapsed_time?: unknown;
  hr_zones?: Record<string, { seconds?: unknown }> | null;
}

export function attachmentRowFromJson(uuid: string, json: HistActivityJson): SyncedActivityRow {
  return {
    id: uuid,
    title: typeof json.name === "string" ? json.name : "",
    sport: typeof json.sport_type === "string" ? json.sport_type : "",
    start: typeof json.start_date_local === "string" ? json.start_date_local : "",
    duration_s: typeof json.elapsed_time === "number" ? json.elapsed_time : 0,
    load: activityZoneLoad(json.hr_zones),
  };
}

export function syncThreadTitle(rows: readonly SyncedActivityRow[]): string {
  if (rows.length === 1) {
    const title = rows[0]?.title.trim();
    return title && title.length > 0 ? title : "1 session synced";
  }
  return `${rows.length} sessions synced`;
}

export function findThreadForActivitySyncBatch(
  threads: ChatThread[],
  batchId: string,
): ChatThread | undefined {
  return threads.find((thread) =>
    thread.messages.some((message) => {
      if (message.role !== "coach" || !message.attachments) return false;
      return message.attachments.some((attachment) => attachmentBatchId(attachment) === batchId);
    }),
  );
}

/** Write-time merge: one batch_id keeps the first thread; a retry must not add another. */
export function commitActivitySyncHistory(
  threads: ChatThread[],
  batchId: string,
  newThread: ChatThread,
): { threads: ChatThread[]; duplicate: boolean; thread: ChatThread } {
  const existing = findThreadForActivitySyncBatch(threads, batchId);
  if (existing) {
    return { threads, duplicate: true, thread: existing };
  }
  return {
    threads: mergeThreadToFront(threads, newThread),
    duplicate: false,
    thread: newThread,
  };
}

export function coachReplyText(thread: ChatThread): string {
  const coach = [...thread.messages].reverse().find((message) => message.role === "coach");
  return coach && coach.role === "coach" ? coach.paragraphs.join("\n\n") : "";
}

function attachmentBatchId(attachment: ChatAttachment): string | undefined {
  if (attachment.kind !== "synced_activity_list") return undefined;
  const batchId = (attachment as { batch_id?: unknown }).batch_id;
  return typeof batchId === "string" ? batchId : undefined;
}

export function syncedActivityListAttachment(
  batchId: string,
  activities: SyncedActivityRow[],
): SyncedActivityListAttachment {
  return {
    version: 1,
    kind: "synced_activity_list",
    batch_id: batchId,
    activities,
  };
}

/**
 * The one thread shape both post-sync callers write: activitySyncTurn's own commit (a thread
 * already open) and /api/coach-message's fallback mint (no thread exists yet for this batch).
 * One generator, one thread id - this is the only place either caller builds a ChatThread.
 */
export function buildActivitySyncThread(params: {
  batchId: string;
  rows: SyncedActivityRow[];
  replyText: string;
  now: number;
  timezone: string;
}): ChatThread {
  const { batchId, rows, replyText, now, timezone } = params;
  const coachMsg: ChatMessage = {
    id: `c-${now}`,
    role: "coach",
    paragraphs: [replyText],
    attachments: [syncedActivityListAttachment(batchId, rows)],
  };
  const allMessages = appendConversationTurn([], undefined, coachMsg, {
    id: `d-${now}`,
    role: "divider",
    label: todayDividerLabel(timezone),
  });
  return {
    id: `t-${now}`,
    createdAt: now,
    title: truncateTitle(sanitizeTitle(syncThreadTitle(rows)), THREAD_TITLE_MAX_CHARS),
    preview: replyText.slice(0, 80),
    messages: allMessages,
  };
}

export async function loadVerifiedActivities(
  repo: string,
  token: string,
  activityIds: readonly string[],
): Promise<{ ok: true; rows: SyncedActivityRow[] } | { ok: false }> {
  const listing = await listDirectory(repo, ACTIVITIES_HIST_DIR, token);
  const byUuid = new Map<string, string>();
  for (const entry of listing ?? []) {
    if (entry.type !== "file") continue;
    const uuid = histUuidFromName(entry.name);
    if (uuid && !byUuid.has(uuid)) byUuid.set(uuid, entry.path);
  }

  const sortedIds = [...activityIds].sort();
  const fetched = await Promise.all(
    sortedIds.map(async (qualified) => {
      const uuid = qualified.slice(HK_ACTIVITY_PREFIX.length);
      const path = byUuid.get(uuid);
      if (!path) return null;
      const parsed = parseJsonOrNull<HistActivityJson>(await getFileRaw(repo, path, token));
      if (!parsed) return null;
      return attachmentRowFromJson(uuid, parsed);
    }),
  );
  if (fetched.some((row) => row == null)) return { ok: false };
  const rows = fetched as SyncedActivityRow[];
  rows.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return { ok: true, rows };
}
