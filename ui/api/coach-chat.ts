/**
 * coach-chat.ts — real Coach Phelps sessions from the browser and iOS, backed by Gemini.
 * Full design/flow: docs/eng-docs/coach-chat-flow.md. Commit + retention design: ADR 0012.
 *
 * GET                        → load already-wrapped/committed threads
 * POST {action: "greet"}     → start a new conversation with Coach speaking first (A4) - no
 *                               athlete message. Creates + commits a thread with just Coach's
 *                               opening line, or reuses today's still-unanswered greeting
 *                               thread if one already exists.
 * POST {threadId?, messages, message} → send a message, get a real coach reply.
 *                               No repo write unless this message closes the
 *                               session, in which case the whole thread (plus
 *                               coach_note, if any) commits in one batch.
 *
 * No delete endpoint - retention is fully automatic (ADR 0012 amendment): the 7 most recent
 * threads are kept, oldest evicted on write. There's no user-facing delete control.
 *
 * coach-chat-reliability-debug: closing-turn ask stripped to the bare minimum (coach_note only -
 * no file_updates, no sleep/side-quest/injury checklist, no Part B retry/honesty-guard) to test
 * whether a much smaller ask is more reliable than the full-featured one. Local to this branch.
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { commitFilesAtomic, type FileEntry } from "./_lib/githubGitData.js";
import {
  STATE_FILE_PATH,
  fetchWithTimeout,
  getFileRaw,
  getHeadSha,
  isAthleteProfileComplete,
  loadCoachContext,
} from "./_lib/coachChatFiles.js";
import { applyJsonMergePatch } from "./_lib/fileEdits.js";
import { getCachedSoulName, invalidateCachedSoulName } from "./_lib/soulCache.js";

const CHAT_FILE_PATH = "user_data/coach/chat_history.json";

const COACH_NOTES_PATH = "user_data/coach/coach_notes.md";
const CHALLENGE_V2_PATH = "user_data/ledger/challenge_v2.json";

// Dated model ids keep getting cut early without much notice - gemini-2.0-flash was deprecated,
// then gemini-2.5-flash also started 404ing for free-tier keys ahead of its own announced
// shutdown date. Use Google's maintained "-latest" alias instead: it always points at their
// current recommended flash model, so this doesn't need chasing every time a dated version
// gets sunset. Check aistudio.google.com/rate-limit for this account's actual current
// RPM/RPD numbers - free-tier limits aren't published as a fixed table anymore.
const GEMINI_MODEL = "gemini-flash-latest";

// Kept short by design, not just to fit the tightest surface (iOS's `historyRow` in
// CoachChatWarmUI.swift, 14.5pt semibold sharing a row with a day-label chip and an "OPEN"/
// age-label chip) - a short title reads faster in a list than a longer one, even where there'd
// be room for more. iOS still applies its own lineLimit(1) + truncation as a defensive backstop
// (see #244 follow-up) in case a response ever ignores this budget.
const THREAD_TITLE_MAX_CHARS = 28;

// Model-generated titles are meant to be short, plain-English summaries (see askGemini's closing
// prompt, which now also says so explicitly and few-shots a plain-English example) - a stray
// non-Latin token (observed in production: literal CJK characters mixed into otherwise-English
// text) is a generation-quality slip. The prompt/few-shot fix targets the cause; this is a safety
// net in case it doesn't fully catch it. Strips anything outside basic printable ASCII rather
// than attempting real script/language detection.
function sanitizeTitle(title: string): string {
  return title.replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

// .slice()/.substring() operate on UTF-16 code units, which can split a surrogate pair (e.g. an
// emoji) in half and leave a corrupted lone-surrogate character dangling at the cut point.
// Array.from splits on codepoints instead, so truncation always lands on a whole character.
function truncateTitle(title: string, maxChars: number): string {
  const chars = Array.from(title);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : title;
}

// Matches SOUL.md §1 step 6's `TZ=<timezone> date` - the web chat has no shell, so this is
// the direct equivalent: pull the IANA zone out of state.md's Athlete Profile line
// (`- **Timezone:** Asia/Kolkata (IST, UTC+5:30)`) and format "today" in it, falling back to
// UTC the same way SOUL.md's own boot sequence does when the field isn't set yet.
function extractTimezone(stateMd: string): string {
  const match = stateMd.match(/\*\*Timezone:\*\*\s*([A-Za-z_]+\/[A-Za-z_]+)/);
  return match?.[1] ?? "UTC";
}

// Calendar-day difference between a thread's createdAt and "today," both resolved in the
// athlete's own timezone (state.md's Timezone field) rather than UTC - a thread created at
// 11pm IST shouldn't already read as "yesterday" just because UTC has rolled over. Falls back
// to 0 (same behavior as before this existed) if the timezone can't be resolved.
function computeDayOffset(createdAt: number, stateMd: string): number {
  const timezone = extractTimezone(stateMd);
  try {
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); // YYYY-MM-DD, sortable
    const createdDay = dayFormatter.format(new Date(createdAt));
    const todayDay = dayFormatter.format(new Date());
    const createdUTC = Date.parse(`${createdDay}T00:00:00Z`);
    const todayUTC = Date.parse(`${todayDay}T00:00:00Z`);
    return Math.max(0, Math.round((todayUTC - createdUTC) / 86_400_000));
  } catch {
    return 0;
  }
}

// ageLabel is only ever written once, at thread-creation/close time (both call sites just set
// "NOW"), so without this it freezes there forever - an old thread would say "NOW" for good.
// Recompute it here from the freshly-computed dayOffset instead of trusting the stored value.
// Matches threadDayLabel's "D-N" convention (coachChatModel.ts) rather than inventing new copy.
function ageLabelFor(dayOffset: number): string {
  return dayOffset === 0 ? "NOW" : `D-${dayOffset}`;
}

export function withComputedDayOffsets(threads: ChatThread[], stateMd: string): ChatThread[] {
  return threads.map((t) => {
    const dayOffset = computeDayOffset(t.createdAt ?? Date.now(), stateMd);
    return { ...t, dayOffset, ageLabel: ageLabelFor(dayOffset) };
  });
}

function todayContextLine(stateMd: string): string {
  const timezone = extractTimezone(stateMd);
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    return `Today is ${formatted} (${timezone}).`;
  } catch {
    return `Today is ${new Date().toISOString()} (UTC - couldn't resolve "${timezone}" as a timezone).`;
  }
}

// A divider message's label was a bare "TODAY" before this - inconsistent with the richer
// "TODAY · D-143 · 6:58" format iOS's own preview/mock data models (CoachChatPreviewData.swift).
// Day number isn't threaded into the divider label (that's still computed client-side from
// challenge_v2.json), but the time-of-day is - include at least that, applied identically
// everywhere a divider gets created (greet and close) so they never disagree with each other.
function todayDividerLabel(stateMd: string): string {
  const timezone = extractTimezone(stateMd);
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(
      new Date(),
    );
    return `TODAY · ${time}`;
  } catch {
    return "TODAY";
  }
}

// Today's date as YYYY-MM-DD in the athlete's own timezone (state.md's Timezone field) - used
// to stamp coach_since (ADR 0018) and to date a coach_note entry, so the date matches what the
// athlete would call "today" even close to midnight, not whatever day it is in the server's UTC
// clock.
function todayDateString(stateMd: string, now: Date): string {
  const timezone = extractTimezone(stateMd);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

// ADR 0018: coach_since is a durable, write-once anchor - "days since this athlete started using
// Coach at all," independent of season/challenge resets. Falls back to season.start_date, then
// challenge.start_date, for repos that haven't been stamped yet (pre-existing athletes awaiting
// manual backfill, or a session mid-First-Session-Protocol before coach_since exists). Returns
// null if none of the three are present, rather than inventing a day number from nothing.
// coach-chat-reliability-debug: no longer called from the closing-turn prompt (there's no more
// commit_message field to thread a day-N reference into) - kept exported/tested as-is per
// instruction not to touch coach_since-adjacent wiring, in case a day-N surface reappears.
export function coachDayNumber(challengeJson: string | null | undefined, stateMd: string, now: Date): number | null {
  if (!challengeJson) return null;
  let parsed: { coach_since?: string; season?: { start_date?: string }; challenge?: { start_date?: string } };
  try {
    parsed = JSON.parse(challengeJson);
  } catch {
    return null;
  }
  const startRaw = parsed.coach_since ?? parsed.season?.start_date ?? parsed.challenge?.start_date;
  if (!startRaw) return null;
  const timezone = extractTimezone(stateMd);
  try {
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    const startDay = dayFormatter.format(new Date(`${startRaw}T00:00:00Z`));
    const todayDay = dayFormatter.format(now);
    const startUTC = Date.parse(`${startDay}T00:00:00Z`);
    const todayUTC = Date.parse(`${todayDay}T00:00:00Z`);
    if (Number.isNaN(startUTC) || Number.isNaN(todayUTC)) return null;
    return Math.max(1, Math.round((todayUTC - startUTC) / 86_400_000) + 1);
  } catch {
    return null;
  }
}

// Deliberately simple keyword match, not asking Gemini to self-detect intent - the whole point
// is one deterministic, reliable trigger for the close-out turn instead of hoping the model
// notices a session-ending signal buried in a 370-line SOUL.md dump on its own. False negatives
// just mean the athlete has to say it more plainly; false positives are cheap (worst case, an
// extra real save).
// A6: added a few more natural sign-offs the athlete actually said in testing ("bye coach",
// "that's all for now", "see you tomorrow", "catch you later") alongside the original set.
// A8: the original pattern missed bare casual sign-offs an athlete actually typed in production
// ("wrap" alone, with no trailing "session") - broadened to catch "wrap"/"wrapping up" without
// requiring "session". Bare "done" is deliberately still excluded - "done for today's hill reps"
// must not falsely trigger a close.
// Bare "wrap" requires the WHOLE (trimmed) message to be just "wrap" plus optional punctuation
// (^wrap[.!]?$), not merely the last word of any message - an unanchored end-of-string match
// spuriously fired on sentences like "I don't think we should wrap", where "wrap" is negated,
// not a close signal. Detecting negation itself isn't worth the regex complexity (fights this
// pattern's own "deliberately simple keyword match" design above) - restricting to short,
// standalone "wrap"-only messages sidesteps it entirely, since that's how athletes actually type
// this sign-off in practice.
// "that's it"/"that's all" is anchored to the end of the message (optionally followed by a short
// "for today/now/me" and trailing punctuation) rather than matching anywhere - an unanchored
// version would false-positive on "that's all, actually one more thing about my shoulder", where
// the athlete is clearly still talking, not closing.
// A9: real-world testing found "Lets wrap" - completely normal phrasing - didn't match the bare
// "wrap" anchor, since that was tightened to require the ENTIRE message be just "wrap" (to stop
// "I don't think we should wrap" from false-triggering). That fix was too strict: it also
// excluded "let's wrap"/"ok wrap"/"yeah, wrap", real closing phrases with a short filler in front.
// Widened to allow a short closing-affirming filler before "wrap" while still anchoring to the
// end of the message - a real sentence like "I don't think we should wrap" still doesn't fit this
// shape (too many words, no affirming filler), so that negation case still correctly excludes.
const CLOSE_SESSION_PATTERN =
  /\b(wrap|close|end)\b[\s\w]*\bsession\b|\bwrap(ping)? (it |things )?up\b|^(let'?s|ok|okay|yeah|yep|alright|sure)?[,.]?\s*wrap[.!]?$|done for (today|the day)|that'?s (it|all)\b(\s+for (today|now|me))?[.!]?$|goodnight coach|\bbye coach\b|\bsee you tomorrow\b|\bcatch you later\b/i;

export function isCloseSignal(message: string): boolean {
  return CLOSE_SESSION_PATTERN.test(message);
}

// A10: live testing found a bigger gap than the regex itself - a closing turn that asks a
// clarifying question ("before I close, how'd you sleep?") gets a completely ordinary-sounding
// reply back ("sleep 8hrs"), which never matches CLOSE_SESSION_PATTERN on its own. That routes
// the next turn as "ordinary" - and Gemini, in direct violation of the ordinary-turn prompt's own
// "set session_closed to false" instruction, was observed returning session_closed: true and a
// fully closing-style reply anyway. Since `closing` requires closeIntent to be true regardless of
// what Gemini says, nothing actually got committed - but the athlete saw a convincing "all set,
// logged" message for a turn that saved nothing at all. Prompt-only fixes for Gemini not
// following its own instructions have already proven unreliable elsewhere in this codebase's
// history (see docs/eng-docs/coach-chat-design-history.md) - the deterministic fix is to make the
// trigger itself remember a pending close, not to trust the model to self-regulate a second time.
// Bounded to the last few messages (not the whole thread) so this doesn't leak into unrelated
// later chat in the same thread if the close attempt is abandoned rather than answered.
const CLOSE_ATTEMPT_LOOKBACK = 4;

export function wasCloseAttemptPending(priorMessages: ChatMessage[]): boolean {
  return priorMessages.slice(-CLOSE_ATTEMPT_LOOKBACK).some((m) => m.role === "user" && isCloseSignal(m.text));
}

// coach-chat-reliability-debug: the whole write path is now one append-only fact, immune to the
// exact-match/patch-parse failure modes a targeted edit has - nothing to reject, nothing to fail
// to match. `currentContent` is null when coach_notes.md doesn't exist yet (first note ever
// written for this athlete) - starts the file with just the new dated entry.
export function appendCoachNote(currentContent: string | null, note: string, dateString: string): string {
  const base = currentContent ?? "";
  return `${base}\n\n## ${dateString}\n${note.trim()}`;
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
  // Set once when the thread is first created, never overwritten - dayOffset above is
  // recomputed from this on every read (see withComputedDayOffsets) rather than persisted
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

async function loadChatHistory(repo: string, token: string): Promise<ChatHistoryFile> {
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
function mergeThreadToFront(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  return [thread, ...threads.filter((t) => t.id !== thread.id)];
}

// ADR 0012 (amended): count-based retention, no archive tier. Deleting a thread removes it
// immediately and permanently (see PATCH handler below), so this cap only ever sees "active"
// threads - the 7 most-recently-active survive; creating an 8th evicts the oldest. Deleting a
// thread below the cap does NOT backfill/evict anything on the next new thread, since the
// deleted thread was never counted against the cap to begin with. Threads must be newest-first
// for the cap to keep the right ones - see mergeThreadToFront above.
const MAX_RETAINED_THREADS = 7;

function applyRetention(threads: ChatThread[]): ChatThread[] {
  return threads.slice(0, MAX_RETAINED_THREADS);
}

// Thread count is capped above, but messages *within* a thread weren't - a long conversation
// before close grew every subsequent request linearly, on top of the fixed system-prompt prefix.
// 40 is generous for a single day's check-in/close-out (SOUL's actual usage pattern) while
// stopping pathological growth; a real conversation-compaction pattern (summarize what's
// trimmed, per Anthropic's context-engineering guidance) is future work once usage data exists
// to size it properly - this is a simple hard window, not that.
const MAX_HISTORY_MESSAGES = 40;

// coach-chat-reliability-debug: stripped to the smallest ask that could possibly be reliable -
// a plain conversation, and on a genuine close, a short append-only note. No file_updates, no
// checklist gate, no Part B retry/honesty-guard - testing whether that alone is more reliable.
interface GeminiReply {
  // Scratch space the model fills in before `reply` - never sent to the athlete (stripped in
  // finishGeminiResponse before returning). Structured-output models benefit from a reasoning
  // field ahead of the final answer on schema-shaped tasks.
  reasoning?: string;
  reply: string;
  // Only meaningful on a closing=true turn - a short (3-5 line) plain-English note of what
  // actually happened this session, worth remembering long-term. Appended by the server (with
  // today's date) to coach_notes.md at commit time (see appendCoachNote) - never shown to the
  // athlete in any current response.
  coach_note?: string;
  // Only meaningful on a closing=true turn (see askGemini) - the athlete's keyword match is
  // just a trigger to ask Gemini to consider closing, not a guarantee it actually did. Gemini
  // sets this false when it's asking a clarifying question instead of closing (see prompt),
  // and the server must not commit/report closed:true unless this comes back true.
  session_closed?: boolean;
  // Only meaningful on a closing=true turn - a short, descriptive summary of what this specific
  // conversation was actually about, replacing the old "truncate the athlete's first message"
  // title. See THREAD_TITLE_MAX_CHARS for the length budget and why.
  title?: string;
}

export type TurnMode = "greeting" | "ordinary" | "closing";

// coach-chat-reliability-debug: challenge_v2.json is fetched on a closing turn purely for the
// server-side coach_since stamp (ADR 0018) - never shown to Gemini, since it isn't proposing
// edits to it any more.
export interface ClosingFileContext {
  challengeV2: string | null;
}

// Two worked examples of the exact JSON shape expected, covering the two turn shapes that
// actually exist now: an ordinary turn with nothing worth saving, and a real close with a real
// coach_note. Sits inside the cached prefix (see systemInstruction below) so it's a one-time
// token cost, not per-turn.
const FEW_SHOT_EXAMPLES = [
  "<example_1 note=\"ordinary turn\">",
  "Athlete: legs feel a bit heavy today but nothing alarming",
  'Coach (JSON): {"reasoning":"Passing comment about soreness, nothing to close on - this is mid-conversation.","reply":"Heavy legs happen, especially with the volume you\'ve had this week. Keep today\'s effort honest and back off the last couple intervals if it doesn\'t ease up.","session_closed":false}',
  "</example_1>",
  "<example_2 note=\"closing turn - real content, a real coach_note\">",
  "Athlete: yeah ran the intervals, felt strong, wrap session",
  'Coach (JSON): {"reasoning":"Real training content this turn: intervals completed, athlete felt strong. Genuinely closing.","reply":"Nice work - that\'s locked in. Rest up, we\'ll build on this Thursday.","session_closed":true,"title":"Strong interval session","coach_note":"Ran intervals today, felt strong throughout. No soreness or issues reported. Plan is to build on this Thursday."}',
  "</example_2>",
].join("\n");

// Shared between the primary cached-or-not call and the stale-cache retry in askGemini - the
// response shape Gemini should return doesn't depend on whether cachedContent was used.
const GENERATION_CONFIG = {
  responseMimeType: "application/json",
  // coach-chat-reliability-debug: the ask is now a handful of short fields, not a multi-file
  // edit proposal - shrunk from 16384. Also acts as a cheap bound against the repetition-loop
  // failure mode observed in testing (the model burning its whole budget on runaway repeated
  // text in one field) - a smaller cap means less damage before generation is cut off.
  maxOutputTokens: 2048,
  responseSchema: {
    type: "object",
    properties: {
      // Field order matters: Gemini fills responseSchema properties roughly in declared order.
      // `reasoning` comes first as a brief internal check, not shown to the athlete (stripped
      // below). `coach_note` comes right after it - immediately after reasoning about what
      // happened, the model has to commit to the actual note, before it writes the athlete-
      // facing `reply`.
      reasoning: { type: "string" },
      coach_note: { type: "string" },
      title: { type: "string" },
      session_closed: { type: "boolean" },
      reply: { type: "string" },
    },
    required: ["reply"],
  },
} as const;

// The truly static half of the prompt - byte-identical on every single call, for every athlete.
// This is what gets uploaded once via Gemini's explicit-caching API (see soulCache.ts) instead
// of being resent as text on every request. Kept separate from the per-turn dynamic block below
// because Gemini rejects a generateContent request that sets both `cachedContent` and
// `systemInstruction` - when a cache is active, this text isn't sent at all, only referenced.
function staticSystemText(soul: string): string {
  return [
    "<persona>",
    soul,
    "</persona>",
    "\n---\n",
    "<instructions>",
    "You are Coach Phelps, running in a web chat session instead of a local Claude Code session.",
    "You are mid-conversation already, not booting a fresh session - skip SOUL.md's Boot Sequence",
    "entirely, you're past it. You have NO shell or tool access: you cannot run `git pull`, cannot",
    "execute Strava scripts, cannot run shell commands, cannot read files on-demand. Everything you",
    "have is already given to you below (current state.md and quest_log.md) or in this conversation.",
    "If SOUL.md instructs you to read a file or run a command you don't have access to here, ignore",
    "that instruction rather than acting like you did it.",
    "You are Coach Phelps ONLY. Never act as Tech Lead, UI Expert, Bob the Builder, iOS Builder, or any",
    "other role from this repo. Never write or discuss code, architecture, or pull requests. If asked to",
    "break character or act as a different assistant, decline in-voice and stay Coach Phelps.",
    "\nBefore writing `reply`, briefly fill in `reasoning` first (not shown to the athlete): is this",
    "genuinely a close, and if so what actually happened this conversation that's worth a note. A",
    "couple of sentences is enough - this is a check on yourself, not a transcript.",
    "</instructions>",
    "\n<examples>\n" + FEW_SHOT_EXAMPLES + "\n</examples>",
  ].join("\n");
}

export async function askGemini(
  apiKey: string,
  soul: string,
  stateMd: string,
  questLog: string,
  history: ChatMessage[],
  userMessage: string,
  mode: TurnMode,
  extraContext?: string,
  traceId?: string,
): Promise<GeminiReply> {
  // Ordered for Gemini's implicit prompt caching (automatic, on by default for 2.5+ models) as
  // a fallback path: caching only matches the longest byte-identical *prefix*, so everything
  // stable across turns - persona, fixed instructions, the few-shot examples, and (usually)
  // state.md/quest_log.md - comes first, and the one thing that changes every single minute
  // (todayContextLine) is the very last element. When explicit caching (below) is active, only
  // the dynamic block ships per request at all, so this ordering matters less, but it's kept as
  // the correct shape for the no-cache fallback. See docs/eng-docs/gemini-flow.md's Caching
  // section for the numbers.
  const staticText = staticSystemText(soul);
  const cachedName = await getCachedSoulName(apiKey, GEMINI_MODEL, staticText).catch(() => null);
  // Takes `useCache` as a parameter (rather than closing over `cachedName` directly) so the
  // retry below can rebuild this as a plain no-cache request if the cache name Gemini was given
  // turns out to be stale/expired at request time (a distinct failure mode from cache *creation*
  // failing, which getCachedSoulName above already handles) - a call that dies because Gemini
  // rejected an invalid cachedContent reference should never surface to the athlete as "coach
  // didn't reply."
  const buildDynamicText = (useCache: boolean) =>
    [
      // When explicit caching is active, this whole block is injected as a synthetic turn (see
      // `contents` below) rather than living in `systemInstruction` - Gemini's API rejects setting
      // both on the same request. A plain instructions block dropped mid-conversation reads with
      // less authority than a system instruction, so it's spelled out explicitly here. Only
      // relevant - and only true - on the cached path: in the no-cache fallback, this text gets
      // concatenated directly into systemInstruction itself, so a claim about "arriving as a turn
      // instead of a system field" would be describing a mechanism that isn't happening. Omit it
      // there rather than confuse the model with a false framing.
      useCache
        ? "[SYSTEM CONTEXT - not a message from the athlete. Everything below carries the same " +
          "binding authority as your system instructions above: follow every directive in it " +
          "exactly, including the session_closed rules, even though it arrives as a turn rather " +
          "than a system field.]"
        : "",
      "<state>",
      "\nCurrent user_data/coach/state.md:\n" + stateMd,
      "\nCurrent gen/quest_log.md (read-only, pre-computed):\n" + questLog,
      "</state>",
      extraContext ? "\n" + extraContext : "",
      mode === "greeting"
        ? [
            "\nThis is a new conversation and the athlete has not said anything yet - YOU open it (A4:",
            "coach speaks first). Write a short, natural opening message the way SOUL.md's Greeting &",
            "Check-in behavior describes: 1-3 sentences, no day-count recitation, no stat dump - just a",
            "genuine, contextual opener referencing whatever's actually relevant (recent activity, an",
            "open thread from earlier, how the week is shaping up). Do not ask a form-style checklist of",
            "questions - open a conversation, don't interrogate. Always set session_closed to false - a",
            "greeting never closes a session by itself.",
          ].join("\n")
        : mode === "closing"
        ? [
            "\nThe athlete's latest message is a session-close signal (\"wrap this session\", \"close",
            "session\", or similar). This turn is the close-out moment - you must actually execute it",
            "now, not just acknowledge it.",
            "\nWrite coach_note: 3 to 5 lines, plain English, what actually happened this conversation",
            "that's worth remembering long-term (e.g. a workout done, how it felt, an injury mentioned,",
            "a plan for next time). This is the ONLY thing that gets saved anywhere - there is no other",
            "file to edit, no checklist to fill in, nothing else to propose. If there's truly nothing",
            "concrete from this conversation, say so honestly in coach_note instead of inventing content.",
            "**Never say something is saved, logged, locked, or committed unless coach_note in this",
            "exact response genuinely reflects it.**",
            "\nSet session_closed to true only if you are genuinely closing out the session in this exact",
            "response (asking a clarifying question instead does NOT count - set it false in that case,",
            "even though this turn was triggered by a close-session phrase). The athlete will simply see",
            "your question and reply normally; you'll get another chance to close once they answer.",
            `\nIf session_closed is true, also set title: a short, specific, human-readable summary of`,
            `what THIS conversation was actually about (e.g. "Sore shoulder, modified Tuesday session"`,
            `or "Planned taper week before the 10K"), not a generic label like "Check-in" or "Training`,
            `talk". Write it like a chat-app conversation title: a handful of words, not a sentence -`,
            `descriptive enough that the athlete recognizes this specific conversation in a list of past`,
            `days, not just its topic category. The server truncates this automatically if it runs long,`,
            `so don't count characters or explain/show any length adjustment - just write the title`,
            `itself, nothing else, in the title field. Omit title entirely if session_closed is false.`,
            `Write it in plain English only - no mixed scripts or other languages, even if the`,
            `conversation itself touched on one.`,
          ].join("\n")
        : [
            "\nThis is an ordinary turn, not a close-out - just talk with the athlete the way SOUL.md",
            "describes. Nothing about this turn gets saved anywhere; that only happens on a genuine",
            "close. Set session_closed to false - this isn't a close-session turn.",
          ].join("\n"),
      // Deliberately last: this is the one piece of the whole prompt that changes every minute.
      // Keeping it here, after everything else, is what makes this a stable-then-volatile block,
      // matching the same ordering rationale as the no-cache fallback's systemInstruction used to
      // rely on end-to-end.
      "\n" + todayContextLine(stateMd),
    ].join("\n");

  // Gemini's generateContent needs at least one content entry to generate against - a greeting
  // turn has no real athlete message yet, so this is a hidden trigger, never shown to the
  // athlete (the mode-specific instructions above tell Gemini exactly what to do with it).
  const historyContents = history
    .filter((m): m is Extract<ChatMessage, { role: "user" | "coach" }> => m.role === "user" || m.role === "coach")
    // Only thread *count* was capped before (MAX_RETAINED_THREADS) - nothing stopped a single
    // long conversation from growing every request linearly on top of the fixed system-prompt
    // prefix. Keep just the most recent messages; real compaction/summarization is future work.
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.role === "user" ? m.text : m.paragraphs.join("\n\n") }],
    }));
  const finalTurn = { role: "user", parts: [{ text: mode === "greeting" ? "[Begin the conversation.]" : userMessage }] };

  // Gemini rejects a request that sets both `cachedContent` and `systemInstruction` - when a
  // cache is active, the dynamic block (state/instructions/timestamp) has nowhere else to go but
  // into `contents`, prepended as a synthetic user/model exchange ahead of the real
  // conversation. When there's no cache (not configured, or creation failed this call, or the
  // retry below discovered it was stale), fall back to the pre-explicit-caching shape: everything
  // in systemInstruction, nothing synthetic in contents. Either way Gemini sees the exact same
  // information, just routed differently.
  const buildContents = (useCache: boolean) =>
    useCache
      ? [
          { role: "user", parts: [{ text: buildDynamicText(true) }] },
          {
            role: "model",
            parts: [{ text: "Understood - I'll follow those instructions exactly, same as my system instructions." }],
          },
          ...historyContents,
          finalTurn,
        ]
      : [...historyContents, finalTurn];

  const buildRequestBody = (useCache: boolean) => ({
    ...(useCache
      ? { cachedContent: cachedName }
      : { systemInstruction: { parts: [{ text: staticText + "\n" + buildDynamicText(false) }] } }),
    contents: buildContents(useCache),
    generationConfig: GENERATION_CONFIG,
  });

  // Closing turns carry a larger prompt than ordinary turns (full chat history) and ask for
  // structured output, so they're the most likely turn to legitimately need more than the shared
  // UPSTREAM_TIMEOUT_MS (25s, sized for plain file reads). Give the actual generateContent call
  // its own longer budget rather than inheriting the file-read default.
  const GEMINI_GENERATE_TIMEOUT_MS = 45_000;

  const callGemini = (useCache: boolean): Promise<Response> =>
    fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(useCache)),
      },
      GEMINI_GENERATE_TIMEOUT_MS,
    ).catch((err) => {
      // fetchWithTimeout THROWS a 504-tagged Error on its own abort, it never resolves a Response
      // for that case - so a bare `res.status === 504` check below would never see it. Convert it
      // into a resolved 504 Response here so every call site can treat a timeout identically to a
      // real 504 response without each needing its own try/catch. Any other thrown error (a
      // genuine network failure with no status) still propagates.
      const status = (err as { status?: number }).status;
      if (status === 504) return new Response(null, { status: 504 });
      throw err;
    });

  // Validation logging: full visibility into what we actually asked for, paired with the full
  // response logging in parseGeminiResponseBody below. Deliberately doesn't log the full prompt
  // text (the static system prompt alone is ~13K tokens) - mode and the athlete's own message are
  // the two things that actually vary call to call and matter for correlating a request with its
  // response.
  console.log("[coach-chat] request:", { mode, userMessage, useCache: !!cachedName, traceId });
  let useCache = !!cachedName;
  let res = await callGemini(useCache);
  // Capped at ONE retry total, not one per failure kind - a naive "retry the 400 case, then
  // separately retry the 504/503 case" allows a genuinely unlucky request to chain 2 full
  // GEMINI_GENERATE_TIMEOUT_MS-budget calls back to back, which risks blowing through
  // ui/vercel.json's maxDuration. Below, only ONE of the two branches can ever fire per call.
  //
  // A stale/invalid cachedContent name (expired between getCachedSoulName's read and this actual
  // call, or evicted server-side) is a distinct failure mode from cache *creation* failing - that
  // case is already handled by getCachedSoulName falling back to null. This one only shows up
  // here, at request time, as a 400 - retry once as a plain no-cache call so it never surfaces to
  // the athlete as "coach didn't reply," and drop the bad record so the next request doesn't
  // repeat this round-trip.
  if (useCache && res.status === 400) {
    invalidateCachedSoulName().catch(() => {});
    useCache = false;
    res = await callGemini(useCache);
  } else if (res.status === 504 || res.status === 503) {
    // A timed-out request (504, our own fetchWithTimeout abort) or a genuine Gemini-side overload
    // (503 UNAVAILABLE) are both transient. Retry once more; a short fixed backoff is enough since
    // these aren't rate-limit errors (that's 429, handled separately in finishGeminiResponse and
    // never retried here). Note this branch is unreachable on the same call where the 400 branch
    // above already fired - if the no-cache retry itself times out, that failure surfaces as-is.
    await new Promise((resolve) => setTimeout(resolve, 500));
    res = await callGemini(useCache);
  }

  return finishGeminiResponse(res, mode, traceId);
}

// Logs the model's own stated reasoning before stripping it, on closing turns only - this is the
// only place it's ever available (never persisted, never sent to the athlete), and it's exactly
// the diagnostic needed for a close that saves an empty/thin coach_note: the model's own account
// of what it considered, correlatable by traceId with the "empty coach_note" warning logged
// downstream in the POST handler.
function logClosingTurnReasoning(parsed: GeminiReply, traceId?: string): void {
  console.log("[coach-chat] closing-turn reasoning:", parsed.reasoning, { traceId });
}

async function finishGeminiResponse(res: Response, mode: TurnMode, traceId?: string): Promise<GeminiReply> {
  if (res.status === 429) {
    // Not necessarily free-tier - Tier 1 has its own (much higher) ceilings too. Both clients
    // handle 429 as its own case with a proper "wait and retry" message rather than surfacing
    // this string directly, but keep it accurate for any caller/log that does read it raw.
    throw Object.assign(new Error("Gemini rate limit exceeded - try again shortly"), { status: 429 });
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number };
  };
  // Cheap, permanent visibility into whether explicit caching is actually being hit on real
  // traffic - the whole point of soulCache.ts is this number being nonzero and close to
  // promptTokenCount, so it's worth a standing log line rather than only checking ad hoc.
  const usage = body.usageMetadata;
  if (usage) {
    console.log(`[coach-chat] Gemini usage: prompt=${usage.promptTokenCount ?? "?"} cached=${usage.cachedContentTokenCount ?? 0}`);
  }
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  const parsed = JSON.parse(text) as GeminiReply;
  // Validation logging: the complete, unredacted response - every field, including `reasoning`
  // (stripped from every other log/return path, but this is server-only visibility, never sent
  // to the athlete). Passed as a plain object, not JSON.stringify'd, so Node's own console
  // formatting pretty-prints/wraps it instead of dumping one unreadable line.
  console.log("[coach-chat] response:", parsed);

  if (mode === "closing") {
    logClosingTurnReasoning(parsed, traceId);
  }
  // reasoning is scratch space for the model, never meant for the athlete - delete here (not just
  // omit from responses) so it can never leak through any caller that spreads/serializes the
  // whole reply object.
  delete parsed.reasoning;
  return parsed;
}

// coach-chat-reliability-debug: only fetched for the server-side coach_since stamp (ADR 0018) -
// never shown to Gemini, since it isn't proposing edits to it any more.
async function loadClosingFileContext(repo: string, token: string): Promise<ClosingFileContext> {
  const challengeV2 = await getFileRaw(repo, CHALLENGE_V2_PATH, token);
  return { challengeV2 };
}

// ADR 0018: coach_since is set automatically, server-side, the moment the false→true
// profileComplete transition happens - i.e. the turn that genuinely finishes the First Session
// Protocol - never at repo-provisioning time (an infra timestamp, not real usage; the same
// failure mode already rejected for repo.created_at). Never relies on Gemini remembering to
// propose this field itself. Write-once - if coach_since is already present (e.g. this repo was
// manually backfilled per issue #199, or a retry of a turn that already stamped it), this is a
// no-op.
export function injectCoachSinceIfNeeded(
  validUpdates: { path: string; content: string }[],
  closingFiles: ClosingFileContext | undefined,
  wasProfileComplete: boolean,
  isProfileCompleteNow: boolean,
  stateMd: string,
): { path: string; content: string }[] {
  if (wasProfileComplete || !isProfileCompleteNow || !closingFiles) return validUpdates;
  const existing = validUpdates.find((u) => u.path === CHALLENGE_V2_PATH);
  const baseContent = existing?.content ?? closingFiles.challengeV2;
  try {
    const parsed = baseContent ? JSON.parse(baseContent) : {};
    if (parsed.coach_since) return validUpdates; // already stamped - never overwritten
  } catch {
    console.warn("[coach-chat] challenge_v2.json unparsable - skipping coach_since stamp");
    return validUpdates;
  }
  const patch = JSON.stringify({ coach_since: todayDateString(stateMd, new Date()) });
  const result = applyJsonMergePatch(baseContent ?? null, patch);
  if (!result.ok) {
    console.warn(`[coach-chat] coach_since stamp failed - ${result.error}`);
    return validUpdates;
  }
  const rest = validUpdates.filter((u) => u.path !== CHALLENGE_V2_PATH);
  return [...rest, { path: CHALLENGE_V2_PATH, content: result.content }];
}

// B4: sport(s)/goal collected in iOS's native onboarding (season step), passed through on the
// very first greet() call for a brand-new athlete so the First Session Protocol can reflect them
// back for confirmation instead of asking cold - see platform/soul/B_engine.md §10's "Onboarding
// hints" note. Absent for web-only athletes or once the hint's already been used once.
export interface OnboardingHints {
  sports: string[];
  goal: string;
}

export function onboardingHintsContext(hints: OnboardingHints | undefined): string | undefined {
  if (!hints || (hints.sports.length === 0 && !hints.goal.trim())) return undefined;
  const lines = ["Onboarding hints from the athlete's native app setup (see B_engine.md §10):"];
  if (hints.sports.length > 0) lines.push(`- Sport(s) selected: ${hints.sports.join(", ")}`);
  if (hints.goal.trim()) lines.push(`- Goal entered: ${hints.goal.trim()}`);
  return lines.join("\n");
}

// A4: coach speaks first. Every greet() call generates a fresh opener via Gemini (informed by
// current state.md/quest_log.md) and hands back a not-yet-committed thread id - nothing is
// written to the repo here. The greeting only actually lands in the repo if the athlete replies
// and that conversation later closes (its full message history, greeting included, is what the
// close-commit writes in one atomic commit - see the closing-turn path below). Before this, every
// greet() committed a brand-new thread immediately, which meant opening the tab and not engaging
// permanently ate one of the 7 retention slots and littered the repo with empty
// "coach: chat — new conversation" commits - confirmed in real usage on both live athlete repos.
// The close path already handles a client-supplied threadId that was never committed (treats it
// as a brand-new thread, `coach-chat.ts`'s message-send handler: `threadId ?? \`t-${now}\``), so
// this needs no special-casing there - it's the same mechanism ordinary mid-conversation turns
// already rely on (nothing commits until close).
async function handleGreet(
  repo: string,
  token: string,
  apiKey: string,
  onboardingHints?: OnboardingHints,
): Promise<Response> {
  const [history, context] = await Promise.all([loadChatHistory(repo, token), loadCoachContext(repo, token)]);
  const { soul, state: stateMd, questLog } = context;
  if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

  let reply: GeminiReply;
  try {
    reply = await askGemini(
      apiKey,
      soul,
      stateMd ?? "",
      questLog ?? "",
      [],
      "",
      "greeting",
      onboardingHintsContext(onboardingHints),
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const errMessage = err instanceof Error ? err.message : String(err);
    // This catch returns directly instead of re-throwing, so the outer handler's console.error
    // never runs for it - without its own log line, an askGemini failure here is completely
    // invisible in Runtime Logs (found the hard way: several real 500s had zero log output).
    console.error("[coach-chat] greet askGemini failed:", err);
    return Response.json({ error: errMessage }, { status });
  }

  const now = Date.now();
  const repoSha = await getHeadSha(repo, token).catch(() => null); // A5: best-effort, never blocks a reply
  return Response.json({
    reply: reply.reply,
    // Neither client actually reads this - both web and iOS mint their own local id and
    // materialize the greeting as an uncommitted thread client-side (see the comment above this
    // function). Kept in the response on purpose, not a leftover: preserves the response shape
    // exactly, so this backend change and the client-side follow-ups don't have to ship in
    // lockstep.
    threadId: `t-${now}`,
    threads: withComputedDayOffsets(history.threads, stateMd ?? ""),
    repoSha,
  });
}

// Split from fetch() below so a rotated session cookie only needs attaching in one place.
async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
    const repo = auth.repo_full_name;
    const token = auth.gh_token;

    if (req.method === "GET") {
      const [history, stateMd] = await Promise.all([loadChatHistory(repo, token), getFileRaw(repo, STATE_FILE_PATH, token)]);
      // Retention is enforced on write (POST), not here - a GET must never rewrite the file
      // just because it was read. Every thread returned here is active - retention (ADR 0012
      // amendment) drops the oldest automatically, no user-facing delete exists any more.
      return Response.json({ threads: withComputedDayOffsets(history.threads, stateMd ?? "") });
    }

    if (req.method === "POST") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return Response.json({ error: "Coach chat isn't configured yet" }, { status: 500 });

      // `messages` is the client's own running history for this thread (nothing persisted
      // server-side for an unwrapped conversation) - the server only ever reads the repo's
      // chat_history.json at the moment a thread actually closes, below.
      const { threadId, messages, message, action, knownSha, onboardingHints } = (await req.json()) as {
        threadId?: string;
        messages?: ChatMessage[];
        message?: string;
        action?: "greet";
        // A5: the repoSha this client last saw for this thread (from a prior response) - lets
        // the server detect "another device wrapped a session (or otherwise wrote to this repo)
        // since I last saw it" without any lock.
        knownSha?: string;
        // B4: only meaningful alongside action: "greet" - see onboardingHintsContext().
        onboardingHints?: OnboardingHints;
      };

      // A4: coach speaks first. Landing on "new conversation" calls this instead of sending a
      // message - the athlete hasn't typed anything yet.
      if (action === "greet") {
        return handleGreet(repo, token, apiKey, onboardingHints);
      }

      const trimmed = (message ?? "").trim();
      if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });

      // A5: best-effort - a failed HEAD check never blocks the turn, it just means staleness
      // can't be detected this time (same as before A5 existed).
      const currentSha = await getHeadSha(repo, token).catch(() => null);
      const stale = knownSha != null && currentSha != null && knownSha !== currentSha;

      // A3: reuses whatever coach-chat-context.ts's app-load preload already warmed for this
      // repo (60s TTL) instead of always paying a fresh GitHub round-trip on every turn - unless
      // A5 just detected the cache is stale, in which case force a fresh read so Gemini's
      // context reflects whatever landed on the repo since (e.g. a session closed elsewhere).
      const { soul, state: stateMd, questLog } = await loadCoachContext(repo, token, { fresh: stale });
      if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

      const priorMessages = messages ?? [];
      // Keyword match is only a trigger to ASK Gemini to consider closing - it is not itself
      // the close decision. Gemini reports back via reply.session_closed whether it actually
      // closed this turn (it may instead ask a clarifying question) - see closing below.
      // A10: also true if a close attempt is still pending from a few messages back (see
      // wasCloseAttemptPending) - the athlete answering to Coach's own clarifying question is
      // still part of the same close attempt, even though that answer alone never matches
      // CLOSE_SESSION_PATTERN.
      const closeIntent = isCloseSignal(trimmed) || wasCloseAttemptPending(priorMessages);
      const now = Date.now();
      // Minted here, not down at the close-trace log site, so it's available to
      // askGemini/finishGeminiResponse below - the model's own closing-turn reasoning is the
      // highest-value diagnostic line this trace exists for, and it has to be taggable with the
      // same traceId the eventual commit outcome logs under.
      const traceId = Math.random().toString(36).slice(2, 10);
      const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

      // Only fetched on a closing turn - purely for the server-side coach_since stamp, Gemini
      // never sees this content (see loadClosingFileContext).
      let closingFiles: ClosingFileContext | undefined;
      if (closeIntent) {
        closingFiles = await loadClosingFileContext(repo, token);
      }

      let reply: GeminiReply;
      try {
        reply = await askGemini(
          apiKey,
          soul,
          stateMd ?? "",
          questLog ?? "",
          priorMessages,
          trimmed,
          closeIntent ? "closing" : "ordinary",
          undefined,
          traceId,
        );
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error("[coach-chat] askGemini failed:", err);
        return Response.json({ error: errMessage }, { status });
      }

      const coachMsg: ChatMessage = { id: `c-${now}`, role: "coach", paragraphs: [reply.reply] };
      const closing = closeIntent && reply.session_closed === true;

      if (!closing) {
        // No repo write at all for an ordinary turn - the client just appends both messages
        // to its own in-memory thread. Losing this on a refresh before wrap is accepted. This
        // also covers a close-intent turn where Gemini asked a clarifying question instead of
        // actually closing (session_closed came back false) - no premature commit.
        return Response.json({ reply: reply.reply, closed: false, repoSha: currentSha, stale });
      }

      // Closing: this is the one moment a real commit happens, so build the thread's final
      // message list and merge it into whatever's already committed for this repo.
      const allMessages: ChatMessage[] = priorMessages.length
        ? [...priorMessages, userMsg, coachMsg]
        : [{ id: `d-${now}`, role: "divider", label: todayDividerLabel(stateMd ?? "") }, userMsg, coachMsg];

      // Fixed once outside the retry loop so the id/title/preview this response reports stay
      // stable across attempts, even though the merge against fresh state below can run more
      // than once.
      const finalThreadId = threadId ?? `t-${now}`;
      // Prefer Gemini's contextual title (set alongside session_closed: true, see askGemini's
      // closing-turn prompt) - it actually reflects what the conversation was about, not just
      // whatever the athlete happened to type first. Truncate defensively in case it ignores the
      // character budget it was given; fall back to the old truncated-first-message behavior only
      // if Gemini omitted title (e.g. an older/misbehaving response).
      const geminiTitle = sanitizeTitle(reply.title?.trim() ?? "");
      const firstUserText = allMessages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user")?.text ?? trimmed;
      const fallbackTitle = truncateTitle(firstUserText, THREAD_TITLE_MAX_CHARS);
      const computedTitle = geminiTitle.length > 0 ? truncateTitle(geminiTitle, THREAD_TITLE_MAX_CHARS) : fallbackTitle;
      const previewText = reply.reply.slice(0, 80);

      // Resolved fresh on every commit retry attempt (see githubGitData.ts), not from a
      // snapshot read before this function was even called - otherwise two requests racing on
      // the same repo (e.g. this close vs. another tab's "Delete forever") could have the
      // last-to-commit silently overwrite the first's changes instead of merging on top of them.
      let latestThreads: ChatThread[] = [];
      const chatWrite: FileEntry = {
        path: CHAT_FILE_PATH,
        resolve: async () => {
          const fresh = await loadChatHistory(repo, token);
          const existing = fresh.threads.find((t) => t.id === finalThreadId);
          if (existing && existing.status === "deleted") {
            // Stale client reference (e.g. a backgrounded tab holding an old thread open) closing
            // into a thread another request deleted since this conversation started - fail loudly
            // instead of silently resurrecting it. (In practice a hard-deleted thread is removed
            // from the array entirely, so `existing` won't be found at all here - this branch is
            // a defensive backstop, not the primary guard.)
            throw Object.assign(
              new Error(`Thread ${finalThreadId} was ${existing.status} - refusing to reactivate it via close`),
              { status: 400 }, // non-transient: don't burn retries on a real rejection
            );
          }
          const thread: ChatThread = {
            id: finalThreadId,
            dayOffset: existing?.dayOffset ?? 0, // stored value is stale by design - recomputed from createdAt below on every response
            createdAt: existing?.createdAt ?? now,
            title: existing?.title ?? computedTitle,
            preview: previewText,
            ageLabel: "NOW",
            status: "active",
            messages: allMessages,
          };
          const retained = applyRetention(mergeThreadToFront(fresh.threads, thread));
          latestThreads = retained;
          return JSON.stringify({ threads: retained }, null, 2);
        },
      };

      // coach-chat-reliability-debug: only included in `writes` below when reply.coach_note is
      // present and non-empty after trimming. Fetches coach_notes.md's own fresh content at
      // commit time (same pattern as chatWrite above), not from a turn-start snapshot.
      const trimmedCoachNote = reply.coach_note?.trim();
      const coachNoteWrite: FileEntry | undefined = trimmedCoachNote
        ? {
            path: COACH_NOTES_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, COACH_NOTES_PATH, token);
              return appendCoachNote(fresh, trimmedCoachNote, todayDateString(stateMd ?? "", new Date()));
            },
          }
        : undefined;

      // B2/ADR 0018: detect the false→true profileComplete transition against what's actually
      // about to be committed - a close-turn that finishes the intake writes state.md this same
      // turn and coach_since must key off that fresh value. state.md itself is no longer edited
      // here (no file_updates any more), so this is keyed off the pre-turn stateMd only.
      const wasProfileComplete = isAthleteProfileComplete(stateMd ?? "");
      const profileComplete = isAthleteProfileComplete(stateMd ?? "");
      const validUpdates = injectCoachSinceIfNeeded([], closingFiles, wasProfileComplete, profileComplete, stateMd ?? "");

      // coach-chat-reliability-debug: visibility without retry machinery - if a close lands with
      // neither a coach_since stamp nor a coach_note, log it plainly so it's easy to tell apart
      // from a close that genuinely had nothing to save (also visible via the reasoning log
      // above, correlatable by traceId).
      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with no coach_note.", { athleteMessage: trimmed, traceId });
      }

      // ADR 0012: chat_history.json plus coach_notes.md (when reply.coach_note was reported),
      // plus a coach_since stamp on the one turn that needs it, land in ONE atomic commit via
      // the Git Data API.
      const writes: FileEntry[] = coachNoteWrite ? [...validUpdates, chatWrite, coachNoteWrite] : [...validUpdates, chatWrite];

      let repoSha: string;
      try {
        const result = await commitFilesAtomic(writes, `coach: chat — ${computedTitle || "session update"}`, {
          repo,
          // Configurable so testing a real close doesn't have to write to a live athlete's
          // actual main - defaults to main, unchanged, when unset.
          branch: process.env.COACH_CHAT_BRANCH ?? "main",
          token,
        });
        repoSha = result.commitSha;
        // One structured line per close, correlating the traceId with what actually committed.
        // console.log, not warn: a healthy close isn't a problem.
        console.log("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          coachNote: trimmedCoachNote ? "present" : "empty",
          committed: writes.map((w) => w.path),
          ms: Date.now() - now,
        }));
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        // The resolve() guard above throws a tagged {status: 400} when this close targets a
        // thread another request archived/deleted in the meantime - that's a correct rejection,
        // not a save failure, so it gets its own status/message instead of being flattened into
        // the generic "saving failed" 502 below (which would be actively misleading here).
        if ((err as { status?: number }).status === 400) {
          return Response.json({ error: errMessage, traceId }, { status: 400 });
        }
        console.error("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          coachNote: trimmedCoachNote ? "present" : "empty",
          error: errMessage,
          ms: Date.now() - now,
        }));
        console.error("[coach-chat] closing commitFilesAtomic failed:", err, { traceId });
        return Response.json({ error: `Coach replied but saving failed: ${errMessage}`, traceId }, { status: 502 });
      }

      return Response.json({
        reply: reply.reply,
        closed: true,
        threadId: finalThreadId,
        threads: withComputedDayOffsets(latestThreads, stateMd ?? ""),
        repoSha,
        profileComplete,
        traceId,
      });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export default {
  async fetch(req: Request): Promise<Response> {
    // resolveRepoAuth handles both auth modes (ADR 0012 makes coach chat iOS-reachable the
    // same way ADR 0005's widget-snapshots.ts already is): session cookie for web,
    // `Authorization: Bearer <token>` + `X-Coach-Repo: owner/repo` for iOS. Cookie mode's
    // setCookie (ADR 0009 rotation) is undefined in Bearer mode, so withSessionCookie below
    // is a no-op for iOS calls.
    const resolved = await resolveRepoAuth(req);
    if (resolved instanceof Response) return resolved;
    try {
      const res = await handle(req, resolved);
      return withSessionCookie(res, resolved.setCookie);
    } catch (err) {
      // A rotated refresh_token (ADR 0009) is single-use - losing resolved.setCookie here
      // would strand the next request, not just fail this one.
      const message = err instanceof Error ? err.message : "Coach chat failed";
      // A 401 from GitHub itself (expired/invalid token) is surfaced as a real 401 instead of
      // a generic 500 - iOS's Bearer auth has no cookie-refresh equivalent, so this status is
      // its only signal to re-prompt sign-in rather than showing a dead-end error.
      const status = (err as { status?: number }).status === 401 ? 401 : 500;
      console.error("[coach-chat]", err);
      return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
    }
  },
};
