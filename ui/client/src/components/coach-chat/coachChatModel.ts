import type { CoachMessageSnapshot } from "@/components/home-warm/snapshots";

const DAY_MS = 24 * 60 * 60 * 1000;
// ADR 0012 (amended): retention is a count cap (newest 7 active threads, no archive tier),
// enforced server-side in ui/api/coach-chat.ts. Nothing to purge client-side any more - the
// server never returns more than 7 threads to begin with, and deleting one is immediate and
// permanent (no restore).
export const MAX_RETAINED_THREADS = 7;

// .slice()/.substring() operate on UTF-16 code units, which can split a surrogate pair (e.g. an
// emoji) in half and leave a corrupted lone-surrogate character dangling at the cut point.
// Array.from splits on codepoints instead, so truncation always lands on a whole character.
// Mirrors truncateTitle in ui/api/coach-chat.ts (server-side titles), used here for the
// client-only fallback titles derived from the athlete's own typed text.
export function truncateTitle(title: string, maxChars: number): string {
  const chars = Array.from(title);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : title;
}

export type ChatRole = "user" | "coach" | "divider";

export type CoachChip =
  | { kind: "engine"; label: string; value: string; status: string }
  | { kind: "sport"; color: string; label: string; note: string };

// Mirrors ui/api/coach-chat/_lib/chatThreads.ts. Do not import API files into Vite.
export interface SyncedActivityRow {
  id: string;
  title: string;
  sport: string;
  start: string;
  duration_s: number;
  load: number | null;
}

export interface SyncedActivityListAttachment {
  version: 1;
  kind: "synced_activity_list";
  batch_id: string;
  activities: SyncedActivityRow[];
}

export type ChatAttachment =
  | SyncedActivityListAttachment
  | { version: number; kind: string; [key: string]: unknown };

export type ChatMessage =
  | { id: string; role: "divider"; label: string }
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "coach";
      paragraphs: string[];
      chips?: CoachChip[];
      /** Inline mono highlight segments keyed as {{token}} in paragraphs. */
      highlights?: Record<string, { text: string; color: string }>;
      attachments?: ChatAttachment[];
    };

/** Local-only thread shown while an activity_sync POST is in flight (or failed, awaiting Retry). */
export const PENDING_SYNC_THREAD_ID = "local-sync-pending";

export type ChatThreadStatus = "active" | "deleted";

export type ChatThread = {
  id: string;
  dayOffset: number;
  /** Raw epoch ms the thread was first created - server has always sent this, client just
   * didn't decode it until now (needed to replace the D-N relative age badge with a real date). */
  createdAt?: number;
  title: string;
  preview: string;
  ageLabel: string;
  statusLabel?: string;
  status?: ChatThreadStatus;
  messages: ChatMessage[];
};

const PROACTIVE_SEED_PREFIX = "local-proactive-cm-";
const PROACTIVE_SNAPSHOT_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProactiveSeed(value: string): boolean {
  return value.length <= 200
    && value.startsWith(PROACTIVE_SEED_PREFIX)
    && /^local-proactive-cm-[A-Za-z0-9-]+$/.test(value);
}

export function parseProactiveSeed(search: string): string | null {
  const values = new URLSearchParams(search).getAll("seed");
  if (values.length !== 1 || !isProactiveSeed(values[0])) return null;
  return values[0];
}

export function selectProactiveCoachMessage(
  payload: unknown,
  requestedSeed: string,
): CoachMessageSnapshot | null {
  if (!isProactiveSeed(requestedSeed) || !isRecord(payload)) return null;
  const home = payload.home;
  if (!isRecord(home) || !isRecord(home.coachMessage)) return null;
  const message = home.coachMessage;
  if (
    typeof message.id !== "string"
    || !/^cm-[A-Za-z0-9-]+$/.test(message.id)
    || typeof message.created_at !== "string"
    || Number.isNaN(Date.parse(message.created_at))
    || typeof message.body !== "string"
    || message.body.trim().length === 0
    || typeof message.conversation_seed_id !== "string"
    || message.conversation_seed_id !== requestedSeed
    || message.conversation_seed_id !== `local-proactive-${message.id}`
  ) return null;
  return {
    id: message.id,
    created_at: message.created_at,
    body: message.body,
    conversation_seed_id: message.conversation_seed_id,
  };
}

export async function fetchProactiveCoachMessage(
  requestedSeed: string,
  fetcher: typeof fetch = fetch,
): Promise<CoachMessageSnapshot | null> {
  if (!isProactiveSeed(requestedSeed)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROACTIVE_SNAPSHOT_TIMEOUT_MS);
  try {
    const response = await fetcher("/api/widget-snapshots", {
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return selectProactiveCoachMessage(await response.json(), requestedSeed);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function materializeProactiveThread(
  message: CoachMessageSnapshot,
  cachedMessages: ChatMessage[] | null = null,
): ChatThread {
  const createdAt = Date.parse(message.created_at);
  const messages = cachedMessages && cachedMessages.length > 0
    ? cachedMessages
    : [
        { id: `d-${createdAt}`, role: "divider" as const, label: "TODAY" },
        { id: `c-${createdAt}`, role: "coach" as const, paragraphs: [message.body] },
      ];
  const lastCoach = [...messages].reverse().find(
    (item): item is Extract<ChatMessage, { role: "coach" }> => item.role === "coach",
  );
  const firstUser = messages.find(
    (item): item is Extract<ChatMessage, { role: "user" }> => item.role === "user",
  );
  const dayOffset = computeLocalDayOffset(createdAt);
  return {
    id: message.conversation_seed_id,
    dayOffset,
    createdAt,
    title: firstUser ? truncateTitle(firstUser.text, 28) : "After your session",
    preview: lastCoach?.paragraphs.join(" ").slice(0, 80) ?? "",
    ageLabel: dayOffset === 0 ? "NOW" : `D-${dayOffset}`,
    status: "active",
    messages,
  };
}

export function resolveProactiveThread(
  requestedSeed: string | null,
  latestMessage: CoachMessageSnapshot | null,
  existingThreads: readonly ChatThread[],
  cachedMessages: ChatMessage[] | null = null,
): ChatThread | null {
  if (!requestedSeed || !isProactiveSeed(requestedSeed)) return null;
  const existing = existingThreads.find((thread) => thread.id === requestedSeed);
  if (existing) return existing;
  if (!latestMessage || latestMessage.conversation_seed_id !== requestedSeed) {
    return null;
  }
  return materializeProactiveThread(latestMessage, cachedMessages);
}

/**
 * Day since coach_since (ADR 0018) - durable, never resets with a new season/challenge. Falls
 * back to season.start_date, then challenge.start_date, for repos not yet stamped (pre-existing
 * athletes awaiting manual backfill, or a session before First Session Protocol completes).
 * Falls back to 1 if none of the three are present.
 */
export function challengeDayNumber(profile: any, ledger: any, now = new Date()): number {
  const startRaw = profile?.coach_since ?? ledger?.seasons?.seasons?.find((s: any) => s.id === ledger?.seasons?.current_season_id)?.start_date;
  if (!startRaw) return 1;
  const start = new Date(`${startRaw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1);
}

export function threadDayLabel(dayNumber: number, dayOffset: number): string {
  return `D-${Math.max(1, dayNumber - dayOffset)}`;
}

// Replaces the relative "D-1"/"D-2"/"D-13" age badge (thread.ageLabel) - that number resets
// meaning every time you look at it days later and was reported as "useless" in practice. A real
// date reads the same regardless of when you look at it. "NOW" for the active same-day thread,
// no time-of-day anywhere (also replaces the stale, frozen-at-creation-time "TODAY · 2:00 AM"
// divider label - see threadDividerLabel below).
function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function formatThreadDate(createdAt: number | undefined): string {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${ordinal(date.getDate())} ${month}`;
}

/** Age badge for a thread row: "NOW" for today's active thread, otherwise a real date instead
 * of the relative D-N count. Falls back to the relative label only if createdAt is somehow
 * missing (shouldn't happen for anything the server sends, but keeps this from rendering blank). */
export function threadAgeDisplay(thread: ChatThread): string {
  if (thread.dayOffset === 0) return "NOW";
  const formatted = formatThreadDate(thread.createdAt);
  return formatted || thread.ageLabel;
}

/** Leading divider label for a conversation pane: "TODAY" for the active same-day thread,
 * otherwise the thread's real date, never a time-of-day - replaces trusting the server's stored
 * divider string, which is frozen at creation time and reads e.g. "TODAY · 2:00 AM" forever,
 * even days later. */
export function threadDividerLabel(thread: ChatThread): string {
  return thread.dayOffset === 0 ? "TODAY" : formatThreadDate(thread.createdAt) || "TODAY";
}

export function threadStatus(thread: ChatThread): ChatThreadStatus {
  return thread.status ?? "active";
}

function normalizeAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kept: ChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const version = (item as { version?: unknown }).version;
    const kind = (item as { kind?: unknown }).kind;
    if (typeof version !== "number" || typeof kind !== "string") continue;
    kept.push(item as ChatAttachment);
  }
  return kept.length > 0 ? kept : undefined;
}

export function normalizeMessage(message: ChatMessage): ChatMessage {
  if (message.role !== "coach") return message;
  const attachments = normalizeAttachments(message.attachments);
  return attachments ? { ...message, attachments } : { ...message, attachments: undefined };
}

export function normalizeThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    status: threadStatus(thread),
    messages: thread.messages.map(normalizeMessage),
  };
}

/** Trial kind only. Unknown kinds/versions return null — callers must not crash. */
export function syncedActivityList(
  attachments: ChatAttachment[] | undefined,
): SyncedActivityListAttachment | null {
  if (!attachments) return null;
  for (const attachment of attachments) {
    if (attachment.kind !== "synced_activity_list" || attachment.version !== 1) continue;
    if (!Array.isArray(attachment.activities)) continue;
    return attachment as SyncedActivityListAttachment;
  }
  return null;
}

export function coachMessageHasCopy(message: Extract<ChatMessage, { role: "coach" }>): boolean {
  return message.paragraphs.some((paragraph) => paragraph.trim().length > 0);
}

export function qualifiedActivityId(id: string): string {
  return id.includes(":") ? id : `hk:${id}`;
}

export function retryActivityIdsFromThread(thread: ChatThread): string[] | null {
  const coach = [...thread.messages]
    .reverse()
    .find((message): message is Extract<ChatMessage, { role: "coach" }> => message.role === "coach");
  if (!coach) return null;
  const list = syncedActivityList(coach.attachments);
  if (!list || coachMessageHasCopy(coach)) return null;
  return list.activities.map((row) => qualifiedActivityId(row.id));
}

export function findClientActivity(activities: unknown, id: string): {
  id: string;
  name: string;
  sport_type: string;
  start_date_local: string;
  elapsed_time: number;
  calories?: number;
  average_heartrate?: number | null;
  description?: string | null;
  hr_zones?: unknown;
} | undefined {
  if (!Array.isArray(activities)) return undefined;
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  for (const item of activities) {
    if (!item || typeof item !== "object" || !("id" in item)) continue;
    const aid = String((item as { id: unknown }).id);
    if (aid !== id && aid !== bare) continue;
    const row = item as {
      id: unknown;
      name?: unknown;
      sport_type?: unknown;
      start_date_local?: unknown;
      elapsed_time?: unknown;
      calories?: unknown;
      average_heartrate?: unknown;
      description?: unknown;
      hr_zones?: unknown;
    };
    return {
      id: aid,
      name: typeof row.name === "string" ? row.name : "",
      sport_type: typeof row.sport_type === "string" ? row.sport_type : "",
      start_date_local: typeof row.start_date_local === "string" ? row.start_date_local : "",
      elapsed_time: typeof row.elapsed_time === "number" ? row.elapsed_time : 0,
      calories: typeof row.calories === "number" ? row.calories : undefined,
      average_heartrate: typeof row.average_heartrate === "number" ? row.average_heartrate : row.average_heartrate === null ? null : undefined,
      description: typeof row.description === "string" ? row.description : row.description === null ? null : undefined,
      hr_zones: row.hr_zones,
    };
  }
  return undefined;
}

/** Thrown instead of a plain Error on a 401 from /api/coach-chat - the session cookie is
 * valid but GitHub access itself was revoked/expired, same case useRepoData.ts's
 * `accessRevoked` covers for the rest of the dashboard. CoachChat.tsx checks for this and shows
 * RepoDataGate's "sign in again" card instead of a generic toast. */
export class CoachChatAccessRevokedError extends Error {
  constructor() {
    super("Your GitHub access expired - sign in again");
    this.name = "CoachChatAccessRevokedError";
  }
}

/** Thrown instead of a plain Error on a 429 that survived all of fetchWithRetry's attempts -
 * distinguished from a generic Error so CoachChat.tsx can show a message that actually explains
 * what happened (rate-limited, try again shortly) instead of the raw, stale server string
 * ("Gemini free-tier quota exceeded" even post-billing) or a generic "didn't reply" toast that
 * gives no indication retrying immediately won't help either. */
export class CoachChatRateLimitedError extends Error {
  constructor() {
    super("Coach is getting a lot of requests right now - wait a moment and try again");
    this.name = "CoachChatRateLimitedError";
  }
}

// Mirrors githubGitData.ts's isTransient: retry a network failure or 5xx/429, never a 4xx
// rejection (400/401/etc are real answers, not blips to paper over).
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

// sendMessage() passes retryNetworkFailures: false - retrying a raw network failure (as opposed
// to a confirmed 5xx/429 response) risks re-running a close-session commit that already landed.
// See docs/eng-docs/coach-chat-flow.md's Resilience section.
async function fetchWithRetry(
  input: RequestInfo,
  init?: RequestInit,
  attempts = 3,
  retryNetworkFailures = true,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !isTransientStatus(res.status) || attempt === attempts - 1) return res;
    } catch (err) {
      if (!retryNetworkFailures) throw err;
      lastError = err;
      if (attempt === attempts - 1) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  // Unreachable in practice (the loop above always returns or throws), but keeps TS happy.
  throw lastError ?? new Error("Coach chat request failed");
}

export async function fetchThreads(): Promise<ChatThread[]> {
  const res = await fetchWithRetry("/api/coach-chat");
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (!res.ok) throw new Error(`Failed to load coach chat (${res.status})`);
  const body = (await res.json()) as { threads: ChatThread[] };
  pruneRepoSha(body.threads.map((t) => t.id));
  return body.threads.map(normalizeThread);
}

// A5: last repoSha seen per thread, kept purely client-side (module-level, not React state -
// nothing needs to re-render off it). Sent back as knownSha on the next message in that thread
// so the server can detect "the repo changed since I last saw it" (e.g. a session was wrapped
// on another device) without any lock. No entry yet for a thread means no comparison happens -
// same as before A5 existed.
const lastKnownSha = new Map<string, string>();

export function rememberRepoSha(threadId: string | null | undefined, sha: string | null | undefined): void {
  if (threadId && sha) lastKnownSha.set(threadId, sha);
}

export function shouldSendEndConversation(
  pendingThreadIds: ReadonlySet<string>,
  threadId: string | null,
  explicitlyRequested: boolean,
): boolean {
  return explicitlyRequested || (threadId != null && pendingThreadIds.has(threadId));
}

export function updatePendingEndThreads(
  pendingThreadIds: ReadonlySet<string>,
  threadId: string,
  pending: boolean,
): Set<string> {
  const next = new Set(pendingThreadIds);
  if (pending) next.add(threadId);
  else next.delete(threadId);
  return next;
}

// Audit fix: lastKnownSha never had anything removing an entry once its thread was deleted or
// aged out of the server's 7-thread retention cap - harmless in practice (a handful of small
// string entries for as long as the tab stays open), but unbounded. Every call that returns a
// full, authoritative thread list is a natural point to drop anything no longer in it.
function pruneRepoSha(currentThreadIds: readonly string[]): void {
  const keep = new Set(currentThreadIds);
  for (const id of lastKnownSha.keys()) {
    if (!keep.has(id)) lastKnownSha.delete(id);
  }
}

// Nothing is persisted server-side until the athlete says wrap/close - the server is stateless
// per turn, so the client sends its own in-memory running history with every message. Only a
// `closed: true` response means an actual commit happened and `threads` reflects real repo state;
// otherwise the caller is responsible for appending the reply to its own local thread.
export type SendMessageResult =
  | { closed: false; reply: string; stale?: boolean; profileComplete: boolean }
  | { closed: true; reply: string; threadId: string; threads: ChatThread[]; profileComplete: boolean };

export async function sendMessage(
  threadId: string | null,
  priorMessages: ChatMessage[],
  message: string,
  endConversationRequested = false,
): Promise<SendMessageResult> {
  const knownSha = threadId ? lastKnownSha.get(threadId) : undefined;
  const res = await fetchWithRetry(
    "/api/coach-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: threadId ?? undefined, messages: priorMessages, message, knownSha, endConversationRequested }),
    },
    3,
    false,
  );
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (res.status === 429) throw new CoachChatRateLimitedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Coach chat request failed (${res.status})`);
  }
  const body = (await res.json()) as SendMessageResult & { repoSha?: string };
  const effectiveThreadId = body.closed ? body.threadId : threadId;
  rememberRepoSha(effectiveThreadId, body.repoSha);
  if (!body.closed) return body;
  pruneRepoSha(body.threads.map((t) => t.id));
  return { ...body, threads: body.threads.map(normalizeThread) };
}

export type ActivitySyncResult = {
  reply: string;
  closed: false;
  duplicate: boolean;
  threadId: string;
  threads: ChatThread[];
  profileComplete: boolean;
};

export async function activitySync(activityIds: string[]): Promise<ActivitySyncResult> {
  const res = await fetchWithRetry(
    "/api/coach-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activity_sync", activity_ids: activityIds }),
    },
    3,
    false,
  );
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (res.status === 429) throw new CoachChatRateLimitedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Coach chat request failed (${res.status})`);
  }
  const body = (await res.json()) as ActivitySyncResult & { repoSha?: string };
  rememberRepoSha(body.threadId, body.repoSha);
  pruneRepoSha(body.threads.map((t) => t.id));
  return { ...body, threads: body.threads.map(normalizeThread) };
}

// A4: coach speaks first. Called on landing on "new conversation" - no athlete message yet.
// The server either reuses today's still-unanswered greeting thread or creates + commits a new
// one with just Coach's opening line (see coach-chat.ts's handleGreet).
export interface GreetResult {
  reply: string;
  threadId: string;
  threads: ChatThread[];
  profileComplete: boolean;
}

export async function fetchProfileComplete(): Promise<boolean> {
  const res = await fetchWithRetry("/api/coach-chat-profile-status");
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (!res.ok) throw new Error(`Failed to load coach profile status (${res.status})`);
  const body = (await res.json()) as { profileComplete: boolean };
  return body.profileComplete;
}

export async function greet(): Promise<GreetResult> {
  const res = await fetchWithRetry(
    "/api/coach-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "greet" }),
    },
    3,
    false,
  );
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (res.status === 429) throw new CoachChatRateLimitedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Coach chat request failed (${res.status})`);
  }
  const body = (await res.json()) as GreetResult & { repoSha?: string };
  rememberRepoSha(body.threadId, body.repoSha);
  pruneRepoSha(body.threads.map((t) => t.id));
  return { ...body, threads: body.threads.map(normalizeThread) };
}

// Mirrors iOS's CoachChatLocalCache: nothing is persisted server-side until a thread closes (see
// sendMessage's doc comment above), so an in-progress conversation only ever exists in this tab's
// React state - a refresh loses it completely. Saved after every append, restored on load,
// cleared on a successful close. Web has no per-account namespacing the way iOS's cache key
// includes repoFullName - acceptable simplification since a browser's localStorage is already
// scoped to one signed-in session/account at a time in practice, unlike a phone that could
// plausibly hold multiple accounts' Keychain-backed sessions.
const LOCAL_CACHE_PREFIX = "coachChatLocalCache.";

export function saveThreadLocally(threadId: string, messages: ChatMessage[]): void {
  try {
    localStorage.setItem(LOCAL_CACHE_PREFIX + threadId, JSON.stringify(messages));
  } catch {
    // Quota exceeded, private browsing, etc. - never let this block the actual conversation.
  }
}

export function restoreThreadMessagesLocally(threadId: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_PREFIX + threadId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed.map(normalizeMessage) : null;
  } catch {
    return null;
  }
}

export function clearThreadLocally(threadId: string): void {
  try {
    localStorage.removeItem(LOCAL_CACHE_PREFIX + threadId);
  } catch {
    // Not fatal - a leftover cache entry for an already-closed thread is harmless clutter, not a
    // correctness problem (restore only ever adds messages on top of what the server already has
    // for a thread id that exists server-side; it can't resurrect a closed thread's stale draft).
  }
}

/** Thread ids cached locally that never made it into `currentThreadIds` (the server's committed
 * list) - i.e. genuinely uncommitted conversations, not just a stale cache entry for something
 * that already closed. Scan happens once on load, before the first render decides what to show. */
export function findOrphanedLocalThreadIds(currentThreadIds: readonly string[]): string[] {
  const known = new Set(currentThreadIds);
  const orphaned: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_CACHE_PREFIX)) continue;
      const threadId = key.slice(LOCAL_CACHE_PREFIX.length);
      if (!known.has(threadId)) orphaned.push(threadId);
    }
  } catch {
    return [];
  }
  return orphaned;
}

/** Parses the epoch-ms timestamp embedded in a message id (e.g. "d-1738798412345"). An orphaned
 * local thread (findOrphanedLocalThreadIds above) never gets a server-computed `createdAt` - the
 * cache only ever stored `messages`, not thread metadata - so this recovers a real creation time
 * from the divider message's own id instead of the caller hardcoding "today." Missing this was a
 * real bug (found via code review): a stale unreplied greeting from days ago would get restored
 * as dayOffset 0, get picked up by ensureTodayThread as "today's" thread, and permanently block
 * the fresh greeting every open is supposed to get. */
export function epochMsFromMessageId(id: string): number | null {
  const match = id.match(/^[a-z]-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Calendar-day difference (browser's local timezone) between an epoch-ms timestamp and now -
 * mirrors coach-chat.ts's server-side computeDayOffset, but purely client-side since an orphaned
 * thread (see epochMsFromMessageId above) never had a server-computed dayOffset to begin with. */
export function computeLocalDayOffset(createdAt: number): number {
  const created = new Date(createdAt);
  const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((todayDay.getTime() - createdDay.getTime()) / 86_400_000));
}
