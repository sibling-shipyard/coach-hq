/**
 * Coach-chat's thread data model and chat_history.json persistence: the shape of a thread/message,
 * loading the committed thread list, merging/retention rules (ADR 0012 amendment - count-based,
 * no archive tier), and title cleanup. No Gemini/commit logic here - just the thread model.
 */
import { getFileRaw } from "./coachChatFiles.js";

export const CHAT_FILE_PATH = "user_data/coach/chat_history.json";

// Kept short by design, not just to fit the tightest surface (iOS's `historyRow` in
// CoachChatWarmUI.swift, 14.5pt semibold sharing a row with a day-label chip and an "OPEN"/
// age-label chip) - a short title reads faster in a list than a longer one, even where there'd
// be room for more. iOS still applies its own lineLimit(1) + truncation as a defensive backstop
// (see #244 follow-up) in case a response ever ignores this budget.
export const THREAD_TITLE_MAX_CHARS = 28;

// Model-generated titles are meant to be short, plain-English summaries - a stray non-Latin
// token (observed in production: literal CJK characters mixed into otherwise-English text) is a
// generation-quality slip. Strips anything outside basic printable ASCII rather than attempting
// real script/language detection. coach-chat-reliability-debug: titles are no longer model-
// generated at all (see coachPrompt.ts's history) - this and truncateTitle now only ever run
// against the athlete's own first message, kept as a safety net for the same reason (a stray
// character in the athlete's own typed text is just as possible).
export function sanitizeTitle(title: string): string {
  return title.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

// .slice()/.substring() operate on UTF-16 code units, which can split a surrogate pair (e.g. an
// emoji) in half and leave a corrupted lone-surrogate character dangling at the cut point.
// Array.from splits on codepoints instead, so truncation always lands on a whole character.
export function truncateTitle(title: string, maxChars: number): string {
  const chars = Array.from(title);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : title;
}

export type ChatMessage =
  | { id: string; role: "divider"; label: string }
  | { id: string; role: "user"; text: string }
  | { id: string; role: "coach"; paragraphs: string[] };

// No archive state: a thread is "active" until the athlete deletes it, which is immediate and
// permanent (ADR 0012 amendment - see below). "deleted" never actually persists in
// chat_history.json; it exists only as the PATCH request shape (status: "deleted" in ⇒ thread
// removed from the array, never written back with that status).
type ChatThreadStatus = "active" | "deleted";

export interface ChatThread {
  id: string;
  dayOffset: number;
  // Set once when the thread is first created, never overwritten - dayOffset is recomputed from
  // this on every read (see coachDay.ts's withComputedDayOffsets) rather than persisted
  // statically, so it stays correct as real time passes instead of freezing at creation.
  createdAt?: number;
  title: string;
  preview: string;
  ageLabel: string;
  status: ChatThreadStatus;
  messages: ChatMessage[];
}

interface ChatHistoryFile {
  threads: ChatThread[];
}

export async function loadChatHistory(repo: string, token: string): Promise<ChatHistoryFile> {
  const raw = await getFileRaw(repo, CHAT_FILE_PATH, token);
  if (!raw) return { threads: [] };
  try {
    const parsed = JSON.parse(raw) as ChatHistoryFile;
    return { threads: Array.isArray(parsed.threads) ? parsed.threads : [] };
  } catch {
    return { threads: [] };
  }
}

// Puts `thread` at the front of `threads`, replacing any existing entry with the same id.
// Used for both brand-new threads and reactivated ones (reopening + closing an old thread used
// to leave it wherever it already sat in the array, silently breaking the newest-first
// invariant applyRetention() below depends on).
export function mergeThreadToFront(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  return [thread, ...threads.filter((t) => t.id !== thread.id)];
}

// ADR 0012 (amended): count-based retention, no archive tier. Deleting a thread removes it
// immediately and permanently (see PATCH handler in coach-chat.ts), so this cap only ever sees
// "active" threads - the 7 most-recently-active survive; creating an 8th evicts the oldest.
// Deleting a thread below the cap does NOT backfill/evict anything on the next new thread, since
// the deleted thread was never counted against the cap to begin with. Threads must be newest-
// first for the cap to keep the right ones - see mergeThreadToFront above.
export const MAX_RETAINED_THREADS = 7;

export function applyRetention(threads: ChatThread[]): ChatThread[] {
  return threads.slice(0, MAX_RETAINED_THREADS);
}
