import type { ChallengeV2 } from "@/lib/challenge";

const DAY_MS = 24 * 60 * 60 * 1000;
// ADR 0012: retention is a count cap (newest 7 active/archived threads), enforced server-side
// in ui/api/coach-chat.ts. Nothing to purge client-side any more - the server never returns
// more than 7 live threads to begin with.
export const MAX_RETAINED_THREADS = 7;

export type ChatRole = "user" | "coach" | "divider";

export type CoachChip =
  | { kind: "engine"; label: string; value: string; status: string }
  | { kind: "sport"; color: string; label: string; note: string };

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
    };

export type ChatThreadStatus = "active" | "archived" | "deleted";

export type ChatThread = {
  id: string;
  dayOffset: number;
  title: string;
  preview: string;
  ageLabel: string;
  statusLabel?: string;
  status?: ChatThreadStatus;
  /** @deprecated Prefer `status`. Kept for older localStorage payloads. */
  archived?: boolean;
  /** Epoch ms when moved to archived. */
  archivedAt?: number;
  /** Epoch ms when soft-deleted. */
  deletedAt?: number;
  messages: ChatMessage[];
};

export type ChatStarter = {
  id: string;
  label: string;
  icon: "week" | "cold" | "match";
};

/** Challenge day since start (1-indexed). Falls back to 1 if dates are missing. */
export function challengeDayNumber(challenge: ChallengeV2, now = new Date()): number {
  const startRaw = challenge.challenge?.start_date;
  if (!startRaw) return 1;
  const start = new Date(`${startRaw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1);
}

export function threadDayLabel(dayNumber: number, dayOffset: number): string {
  return `D-${Math.max(1, dayNumber - dayOffset)}`;
}

export const CHAT_STARTERS: ChatStarter[] = [
  { id: "week", label: "Review my week", icon: "week" },
  { id: "cold", label: "Why was the bar cold?", icon: "cold" },
  { id: "match", label: "Plan Thursday's match", icon: "match" },
];

export function threadStatus(thread: ChatThread): ChatThreadStatus {
  if (thread.status) return thread.status;
  if (thread.archived) return "archived";
  return "active";
}

export function normalizeThread(thread: ChatThread): ChatThread {
  const status = threadStatus(thread);
  return {
    ...thread,
    status,
    archived: status === "archived",
  };
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

// Mirrors githubGitData.ts's isTransient: retry a network failure or 5xx/429, never a 4xx
// rejection (400/401/etc are real answers, not blips to paper over).
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

async function fetchWithRetry(input: RequestInfo, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.ok || !isTransientStatus(res.status) || attempt === attempts - 1) return res;
    } catch (err) {
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
  return body.threads.map(normalizeThread);
}

// Nothing is persisted server-side until the athlete says wrap/close - the server is stateless
// per turn, so the client sends its own in-memory running history with every message. Only a
// `closed: true` response means an actual commit happened and `threads` reflects real repo state;
// otherwise the caller is responsible for appending the reply to its own local thread.
export type SendMessageResult =
  | { closed: false; reply: string }
  | { closed: true; reply: string; threadId: string; threads: ChatThread[] };

export async function sendMessage(
  threadId: string | null,
  priorMessages: ChatMessage[],
  message: string,
): Promise<SendMessageResult> {
  const res = await fetchWithRetry("/api/coach-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId: threadId ?? undefined, messages: priorMessages, message }),
  });
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Coach chat request failed (${res.status})`);
  }
  const body = (await res.json()) as SendMessageResult;
  if (!body.closed) return body;
  return { ...body, threads: body.threads.map(normalizeThread) };
}

export async function setThreadStatus(threadId: string, status: ChatThreadStatus): Promise<ChatThread[]> {
  const res = await fetchWithRetry("/api/coach-chat", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, status }),
  });
  if (res.status === 401) throw new CoachChatAccessRevokedError();
  if (!res.ok) throw new Error(`Failed to update thread (${res.status})`);
  const body = (await res.json()) as { threads: ChatThread[] };
  return body.threads.map(normalizeThread);
}
