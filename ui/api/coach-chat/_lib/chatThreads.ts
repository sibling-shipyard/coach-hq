/**
 * Coach-chat's thread data model and chat_history.json persistence: the shape of a thread/message,
 * loading the committed thread list, merging/retention rules (ADR 0012 amendment - count-based,
 * no archive tier), and title cleanup. No Gemini/commit logic here - just the thread model.
 */
import { getFileRaw } from "./coachChatFiles.js";

export const CHAT_FILE_PATH = "user_data/coach/chat_history.json";

// Short by design - fits iOS's tight history-row layout. iOS also applies its own lineLimit(1)
// as a defensive backstop.
export const THREAD_TITLE_MAX_CHARS = 28;

// Strips anything outside printable ASCII rather than attempting script detection. Titles are no
// longer model-generated (see coachPrompt.ts) - this now only ever runs against the athlete's
// own first message, kept as a safety net against a stray typed character.
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

// No archive state: a thread is "active" until deleted, immediate and permanent (ADR 0012
// amendment). "deleted" never persists in chat_history.json - it's only the PATCH request shape.
type ChatThreadStatus = "active" | "deleted";

export interface ChatThread {
  id: string;
  dayOffset: number;
  // Set once at creation, never overwritten - dayOffset is recomputed from this on every read
  // (coachDay.ts's withComputedDayOffsets), so it stays correct as real time passes.
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

// Puts `thread` at the front, replacing any existing entry with the same id - keeps the
// newest-first invariant applyRetention() below depends on.
export function mergeThreadToFront(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  return [thread, ...threads.filter((t) => t.id !== thread.id)];
}

// ADR 0012 (amended): count-based retention, no archive tier. Only "active" threads count -
// the 7 most-recently-active survive, creating an 8th evicts the oldest. Threads must be
// newest-first for the cap to keep the right ones.
export const MAX_RETAINED_THREADS = 7;

export function applyRetention(threads: ChatThread[]): ChatThread[] {
  return threads.slice(0, MAX_RETAINED_THREADS);
}
