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
 *                               any file_updates) commits in one batch.
 *
 * No delete endpoint - retention is fully automatic (ADR 0012 amendment): the 7 most recent
 * threads are kept, oldest evicted on write. There's no user-facing delete control.
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
import { applyJsonMergePatch, applyStringEdits, type StringEdit } from "./_lib/fileEdits.js";
import { getCachedSoulName, invalidateCachedSoulName } from "./_lib/soulCache.js";

const CHAT_FILE_PATH = "user_data/coach/chat_history.json";

const SESSIONS_PREFIX = "user_data/activities/workout_plans/sessions/";

const COACH_NOTES_PATH = "user_data/coach/coach_notes.md";
const CHALLENGE_V2_PATH = "user_data/ledger/challenge_v2.json";
const CURRENT_WEEK_PATH = "user_data/ledger/current_week.json";
const SLEEP_LOG_PATH = "user_data/coach/sleep_log.json";

// A7: which write strategy applies to which coach-writable file. Markdown files get exact-match
// string edits; JSON files get RFC 7396 merge patches (ui/api/_lib/fileEdits.ts); session files
// (SESSIONS_PREFIX) are usually whole-new-file writes, so they keep full-content replacement.
// coach-commit-mvp: coach_notes.md is no longer an edits-eligible target - Gemini reports a
// `coach_note` fact instead (see GeminiReply/appendCoachNote below) and the server appends it
// directly, so state.md is the only remaining markdown-edit file.
const MARKDOWN_EDIT_FILES = new Set([STATE_FILE_PATH]);
const JSON_MERGE_FILES = new Set([CHALLENGE_V2_PATH, CURRENT_WEEK_PATH, SLEEP_LOG_PATH]);

// Dated model ids keep getting cut early without much notice - gemini-2.0-flash was deprecated,
// then gemini-2.5-flash also started 404ing for free-tier keys ahead of its own announced
// shutdown date. Use Google's maintained "-latest" alias instead: it always points at their
// current recommended flash model, so this doesn't need chasing every time a dated version
// gets sunset. Check aistudio.google.com/rate-limit for this account's actual current
// RPM/RPD numbers - free-tier limits aren't published as a fixed table anymore.
const GEMINI_MODEL = "gemini-flash-latest";

// Only these files carry Coach's write authority (SOUL.md §2, §12) - anything a Gemini
// response proposes outside this set is dropped, even though the prompt already tells it
// not to propose others. Defense in depth, not trust in the model's instruction-following.
// Derived from MARKDOWN_EDIT_FILES + JSON_MERGE_FILES above rather than a separate literal
// list, so the two can't drift out of sync.
const COACH_WRITABLE_FILES = new Set([...MARKDOWN_EDIT_FILES, ...JSON_MERGE_FILES]);

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

export function isCoachWritable(path: string): boolean {
  return COACH_WRITABLE_FILES.has(path) || path.startsWith(SESSIONS_PREFIX);
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

// A6: side-quest follow-up dedup. No structural field exists anywhere for "what topics were
// already covered today" (challenge_v2.json/quest_log.md are pure training-completion data) -
// so this is built from today's OTHER already-committed threads' previews as extra prompt
// context, not from any dedicated schema. Excludes the thread currently being closed (it isn't
// "another" conversation) and anything without a real preview yet.
function todaysOtherThreadsSummary(threads: ChatThread[], stateMd: string, excludeThreadId: string): string | undefined {
  const today = withComputedDayOffsets(threads, stateMd).filter(
    (t) => t.dayOffset === 0 && t.id !== excludeThreadId && t.status === "active" && t.preview.trim().length > 0,
  );
  if (today.length === 0) return undefined;
  const lines = today.map((t) => `- "${t.title}": ${t.preview}`);
  return [
    "Earlier today, the athlete already had these other conversation(s) with you (topic/preview",
    "only, not full transcripts):",
    ...lines,
    "If a side quest or check-in item was already covered in one of these, don't ask about it",
    "again in this close-out - only ask about what's genuinely still missing.",
  ].join("\n");
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
// to stamp coach_since (ADR 0018), so the date matches what the athlete would call "today" even
// close to midnight, not whatever day it is in the server's UTC clock.
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

// B1 (docs/eng-docs/coach-chat-closing-followup.md): heuristic for "reasoning describes real
// content the model intends to save, but file_updates came back empty/absent anyway" - the exact
// failure mode confirmed live (2026-08-14, coach-akash-suresh, traceId xuij2ft9): reasoning
// explicitly described a state.md edit, file_updates was []. Part A (schema reorder + broader
// close-trigger regex, #284) alone did not reliably prevent this in practice.
// The 40-char length threshold is a plain judgment call, not a principled one - long enough to
// skip empty/terse reasoning ("", "ok, nothing here") while still catching a real multi-fact
// reasoning string; revisit if it proves too strict or too loose once B1's retry has run in
// production for a while.
const NOTHING_TO_SAVE_PATTERN =
  /nothing (concrete|new|to save)|no (changes|updates) needed|already reflect(s|ed)|genuinely empty/i;

// coach-commit-mvp: a non-trivial coach_note is now a fully legitimate, independent way to
// satisfy a close - not just a fallback for when file_updates is empty. 10 chars is a plain
// judgment call, same spirit as the 40-char reasoning threshold above: long enough to skip an
// empty/placeholder note, short enough not to demand a full sentence.
const COACH_NOTE_MIN_LENGTH = 10;

export function hasUnsavedContentMismatch(
  reasoning: string | undefined,
  fileUpdates: GeminiFileUpdate[] | undefined,
  coachNote: string | undefined,
): boolean {
  if (fileUpdates && fileUpdates.length > 0) return false;
  if ((coachNote?.trim().length ?? 0) >= COACH_NOTE_MIN_LENGTH) return false;
  const trimmed = reasoning?.trim() ?? "";
  if (trimmed.length <= 40) return false;
  if (NOTHING_TO_SAVE_PATTERN.test(trimmed)) return false;
  return true;
}

// B1: the nudge sent back to Gemini, replaying its own prior turn verbatim, when the mismatch
// heuristic above fires on a closing turn. Asks it to either genuinely populate file_updates to
// match its own stated reasoning, or admit there's nothing to save and say so explicitly.
const UNSAVED_CONTENT_RETRY_NUDGE =
  "Your reasoning above described saving specific content, but file_updates was empty. Populate " +
  "file_updates now with the exact edits your reasoning described (or, if there is truly nothing " +
  "to save, say so explicitly in reasoning and leave file_updates empty). Also re-set " +
  "checklist_covered and reply to match whatever you decide here — this is the final answer.";

// The model's own commit_message sometimes already includes a "coach:"-style prefix, which
// would otherwise stutter with the one the code adds below (observed in testing:
// "coach: chat — coach: day-38 — ..."). Strip it defensively.
function cleanCommitMessage(message: string): string {
  return message.replace(/^\s*coach:?\s*[-—]*\s*/i, "").trim();
}

// coach-commit-mvp: the whole point of coach_note is append-only, no exact-match, no patch parse
// - so this is deliberately the simplest possible write strategy, immune to the three silent-drop
// causes documented at the top of coach-commit-mvp.md. Pure/testable on its own, same spirit as
// applyStringEdits/applyJsonMergePatch in fileEdits.ts, even though it's simple enough to live
// here rather than in that file. `currentContent` is null when coach_notes.md doesn't exist yet
// (first note ever written for this athlete) - starts the file with just the new dated entry.
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

// Deliberately NOT dispatching sync.yml here - a repo whose workflow has a push trigger on
// challenge_v2.json already re-syncs from the commit above; dispatching too would risk a second,
// racing run. See docs/eng-docs/coach-chat-flow.md's "What does NOT happen" section.

// A7: file_updates entries carry exactly one of these, chosen by which set the path falls in
// (MARKDOWN_EDIT_FILES / JSON_MERGE_FILES / session files) - see coach-chat.ts's apply logic.
export interface GeminiFileUpdate {
  path: string;
  /** Markdown files: one or more exact-match edits. */
  edits?: StringEdit[];
  /** JSON files: an RFC 7396 merge patch, JSON-encoded as a string (see fileEdits.ts). */
  merge_patch?: string;
  /** Session files only: full new file content - these are usually whole-new-file writes. */
  content?: string;
}

interface GeminiReply {
  // Scratch space the model fills in before `reply` - never sent to the athlete (stripped in
  // askGemini before returning). Structured-output models benefit from a reasoning field ahead
  // of the final answer on schema-shaped tasks (OpenAI's own structured-outputs guide reports a
  // large accuracy gain from this ordering) - Gemini Flash isn't a reasoning-first model, so this
  // scaffold still helps here the way it wouldn't for an o1/o3-style model that reasons natively.
  reasoning?: string;
  reply: string;
  file_updates?: GeminiFileUpdate[];
  // Only meaningful on a closing=true turn - a short plain-English note of what actually
  // happened this session, worth remembering long-term. Appended by the server (with today's
  // date) to coach_notes.md at commit time (see appendCoachNote) - never shown to the athlete in
  // any current response, same treatment as commit_message/title below.
  coach_note?: string;
  commit_message?: string;
  // Only meaningful on a closing=true turn (see askGemini) - the athlete's keyword match is
  // just a trigger to ask Gemini to consider closing, not a guarantee it actually did. Gemini
  // sets this false when it's asking a clarifying question instead of closing (see prompt),
  // and the server must not commit/report closed:true unless this comes back true.
  session_closed?: boolean;
  // Only meaningful on a closing=true turn - a short, descriptive summary of what this specific
  // conversation was actually about, replacing the old "truncate the athlete's first message"
  // title. See THREAD_TITLE_MAX_CHARS for the length budget and why.
  title?: string;
  // Only meaningful on a closing=true turn - self-reported, not enforced (there's a deliberate
  // "close anyway" escape hatch in the prompt for a second close attempt with info still
  // missing). Purely diagnostic: logged in finishGeminiResponse so a real incident report ("coach
  // closed without asking about sleep") can be told apart from "model legitimately used the
  // escape hatch on a second ask" instead of guessing from the reply text alone.
  checklist_covered?: boolean;
  // Internal-only, same treatment as `reasoning` above: never sent to the athlete, never meant to
  // leak through any response shape. Unlike `reasoning` (stripped inside askGemini itself, never
  // leaves this file), this one has to survive one layer higher - set by askGemini's B1 retry
  // logic (docs/eng-docs/coach-chat-closing-followup.md) when a closing turn's file_updates still
  // looks mismatched against its own reasoning after the retry, then read and stripped by the
  // HTTP handler's honesty guard right after askGemini returns.
  _unsavedContentSuspected?: boolean;
}

export type TurnMode = "greeting" | "ordinary" | "closing";

// A7: current content of the other coach-writable files, fetched only on closing turns (the
// only turns file_updates realistically needs this for - see the "ordinary" prompt block below).
// Gemini has to see a file's actual current content to produce a valid old_string match or a
// sensible merge patch against it - it was never given these before A7 either, but that only
// mattered when it was regenerating whole files from scratch; edits/patches need the real thing.
export interface ClosingFileContext {
  challengeV2: string | null;
  currentWeek: string | null;
  sleepLog: string | null;
}

// Three worked examples of the exact JSON shape expected, covering the highest-stakes failure
// modes already seen in this codebase's own prompt warnings above: silently touching files on
// an ordinary turn, fabricating a "saved" close when info is missing, and a real well-formed
// edit. Sits inside the cached prefix (see systemInstruction below) so it's a one-time token
// cost, not per-turn - per Anthropic's multishot-prompting guidance, worked examples reduce
// persona/structured-output drift more reliably than prose rules alone.
const FEW_SHOT_EXAMPLES = [
  "<example_1 note=\"ordinary turn, nothing worth saving\">",
  "Athlete: legs feel a bit heavy today but nothing alarming",
  'Coach (JSON): {"reasoning":"Passing comment about soreness, not a workout log or injury flag - nothing concrete to save. Ordinary turns should touch state.md only for things that genuinely need it.","reply":"Heavy legs happen, especially with the volume you\'ve had this week. Keep today\'s effort honest and back off the last couple intervals if it doesn\'t ease up.","session_closed":false}',
  "</example_1>",
  "<example_2 note=\"closing turn, missing info - ask, don't fabricate\">",
  "Athlete: wrap session",
  'Coach (JSON): {"reasoning":"Close signal, but sleep was never mentioned anywhere in this conversation or in state.md/quest_log.md above. Cannot honestly close without it - asking, not inventing a number.","reply":"Before I lock this in - how\'d you sleep last night? Want that in before I close out.","session_closed":false}',
  "</example_2>",
  "<example_3 note=\"closing turn, real content - well-formed edit\">",
  "Athlete: yeah ran the intervals, felt strong, closing out",
  'Coach (JSON): {"reasoning":"Real training content this turn: intervals completed, athlete felt strong. state.md\'s Training Log section is shown above with exact current text I can match against - safe, targeted edit, not a whole-file rewrite.","reply":"Nice work - that\'s locked in. Rest up, we\'ll build on this Thursday.","session_closed":true,"title":"Strong interval session","checklist_covered":true,"commit_message":"day-12 — logged interval session, felt strong","file_updates":[{"path":"user_data/coach/state.md","edits":[{"old_string":"## Training Log\\n(no entries yet)","new_string":"## Training Log\\n- Day 12: Interval session, felt strong"}]}]}',
  "</example_3>",
].join("\n");

// Shared between the primary cached-or-not call and the stale-cache retry in askGemini - the
// response shape Gemini should return doesn't depend on whether cachedContent was used.
const GENERATION_CONFIG = {
  responseMimeType: "application/json",
  // A7: file_updates now carries targeted edits/patches instead of whole-file bodies, so this
  // needs far less headroom than the old full-file-regen design did - kept generous anyway since
  // a close-out turn can still propose several files at once.
  maxOutputTokens: 16384,
  responseSchema: {
    type: "object",
    properties: {
      // Field order matters: Gemini fills responseSchema properties roughly in declared order.
      // `reasoning` comes first as a brief internal check (is this genuinely a close, does every
      // proposed edit have real backing content), not shown to the athlete (stripped below).
      // `file_updates` comes right after it - immediately after reasoning about what needs saving,
      // the model has to commit to the actual edits, before it writes the athlete-facing `reply`
      // describing what was saved. Previously `file_updates` was declared last and `reply` early,
      // which let the model write a confident "saved" reply before (or without) ever populating
      // file_updates to back it up - observed in production (A8).
      reasoning: { type: "string" },
      file_updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            edits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
            },
            merge_patch: { type: "string" },
            content: { type: "string" },
          },
          required: ["path"],
        },
      },
      // coach-commit-mvp: a "commitment" field, same category as file_updates above (real
      // content the model is committing to save) - declared here, right after file_updates and
      // still well ahead of the narrative fields (reply/title/session_closed) below, for the same
      // ordering reason documented on `reasoning`/`file_updates` above.
      coach_note: { type: "string" },
      checklist_covered: { type: "boolean" },
      commit_message: { type: "string" },
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
    "genuinely a close, what if anything actually changed and needs a file edit, and is every",
    "proposed edit backed by real content you were actually shown this turn. A couple of sentences",
    "is enough - this is a check on yourself, not a transcript.",
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
  closingFiles?: ClosingFileContext,
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
      // less authority than a system instruction (measured: eval regressions on commit_message/
      // session_closed when this framing line was missing), so it's spelled out explicitly here.
      // Only relevant - and only true - on the cached path: in the no-cache fallback, this text
      // gets concatenated directly into systemInstruction itself (see `contents`/request body
      // below), so a claim about "arriving as a turn instead of a system field" would be describing
      // a mechanism that isn't happening. Omit it there rather than confuse the model with a false
      // framing.
      useCache
        ? "[SYSTEM CONTEXT - not a message from the athlete. Everything below carries the same " +
          "binding authority as your system instructions above: follow every directive in it " +
          "exactly, including the commit_message and session_closed rules, even though it arrives " +
          "as a turn rather than a system field.]"
        : "",
      "<state>",
    "\nCurrent user_data/coach/state.md:\n" + stateMd,
    "\nCurrent gen/quest_log.md (read-only, pre-computed):\n" + questLog,
    closingFiles
      ? [
          "\nCurrent contents of the other files you may need to edit this turn (only fetched on a",
          "close-out turn):",
          "\nuser_data/ledger/challenge_v2.json:\n" + (closingFiles.challengeV2 ?? "(file does not exist yet)"),
          "\nuser_data/ledger/current_week.json:\n" + (closingFiles.currentWeek ?? "(file does not exist yet)"),
          "\nuser_data/coach/sleep_log.json:\n" + (closingFiles.sleepLog ?? "(file does not exist yet)"),
        ].join("\n")
      : "",
    "</state>",
    extraContext ? "\n" + extraContext : "",
    mode === "greeting"
      ? [
          "\nThis is a new conversation and the athlete has not said anything yet - YOU open it (A4:",
          "coach speaks first). Write a short, natural opening message the way SOUL.md's Greeting &",
          "Check-in behavior describes: 1-3 sentences, no day-count recitation, no stat dump - just a",
          "genuine, contextual opener referencing whatever's actually relevant (recent activity, an",
          "open thread from earlier, how the week is shaping up). Do not ask a form-style checklist of",
          "questions - open a conversation, don't interrogate. Never propose file_updates on this turn",
          "and always set session_closed to false - a greeting never closes a session by itself.",
        ].join("\n")
      : mode === "closing"
      ? [
          "\nThe athlete's latest message is a session-close signal (\"wrap this session\", \"close",
          "session\", or similar). This turn IS the commit-protocol moment (SOUL.md §12) - you must",
          "actually execute it now, not just acknowledge it: reflect on this whole conversation, and",
          "propose edits for every file that genuinely changed via file_updates (state.md at minimum",
          "if anything was discussed; challenge_v2.json/current_week.json/sleep_log.json",
          "/user_data/activities/workout_plans/sessions/<name>.json if relevant - their current",
          "contents are given to you above). If something the pre-commit checklist needs - today's",
          "sleep, side-quest status, injury flags - was never covered anywhere in this conversation or",
          "in the state.md/quest_log.md above, ask for it now instead of closing out. Only once you",
          "actually have what you need should you close - if this is the athlete's second time asking",
          "to close and you still don't have it, close anyway with what you have rather than stall",
          "forever.",
          "\nBefore deciding file_updates, use `reasoning` to do this mechanically, not just describe",
          "it: list every concrete fact this conversation contains (a workout done, how it felt, sleep",
          "mentioned, an injury, a plan for tomorrow, a proposed session) that state.md/quest_log.md",
          "above does NOT already reflect, one per line. Every line on that list needs either a",
          "file_updates entry or an explicit reason it doesn't need saving - a real training",
          "conversation that ends with file_updates empty is a mistake, not a valid outcome, unless",
          "that list is genuinely empty too. This applies equally to proposing a new",
          "user_data/activities/workout_plans/sessions/<name>.json when you and the athlete actually",
          "settled on a plan for an upcoming session - don't just describe the plan in `reply` and",
          "drop it; a session file that doesn't get created won't show up anywhere for the athlete.",
          "**Never say something is saved, logged, locked, or committed unless it is genuinely present",
          "in file_updates in this exact response.** If there is truly nothing concrete to save this",
          "session, say so honestly instead of pretending to close one out.",
          "\nSet session_closed to true only if you are genuinely closing out the session in this exact",
          "response (asking for missing info instead does NOT count - set it false in that case, even",
          "though this turn was triggered by a close-session phrase). The athlete will simply see your",
          "question and reply normally; you'll get another chance to close once they answer.",
          `\nIf session_closed is true, also set title: a short, specific, human-readable summary of`,
          `what THIS conversation was actually about (e.g. "Sore shoulder, modified Tuesday session"`,
          `or "Planned taper week before the 10K"), not a generic label like "Check-in" or "Training`,
          `talk". Write it like a chat-app conversation title: descriptive enough that the athlete`,
          `recognizes this specific conversation in a list of past days, not just its topic category.`,
          `Max ${THREAD_TITLE_MAX_CHARS} characters - if the natural phrasing runs longer, cut it down`,
          `to the most specific/important part rather than a generic fallback. Omit title entirely if`,
          `session_closed is false. Write it in plain English only - no mixed scripts or other`,
          `languages, even if the conversation itself touched on one.`,
          `\nAlso set checklist_covered: true if sleep/side-quest/injury status genuinely got covered`,
          `this conversation (or wasn't relevant), or false if you're closing via the "athlete asked`,
          `twice, close anyway" escape hatch above without it. This is diagnostic only, not a gate -`,
          `be honest about which case this is rather than defaulting to true.`,
          `\nAlways include coach_note on a closing turn: a short (2-3 sentence) plain-English note of`,
          `what actually happened this session, worth remembering long-term (e.g. "Ran intervals,`,
          `felt strong, no soreness. Planning a rest day tomorrow before Thursday's tempo run."). This`,
          `is separate from file_updates and does not require you to propose an edit to`,
          `coach_notes.md - the server appends coach_note to that file with today's date on its own.`,
          `You never see or need to see coach_notes.md's current content - just report the fact.`,
        ].join("\n")
      : [
          "\nThis is an ordinary turn, not a close-out - you were not given the current contents of",
          "challenge_v2.json/current_week.json/sleep_log.json this turn (only state.md",
          "and quest_log.md above), so you cannot safely propose edits to those files right now - you'd",
          "be guessing at content you haven't actually seen. If something happened this turn that",
          "genuinely needs saving (a workout logged, a check-in, a quest completion), you may propose",
          "edits to state.md only (you do have its current content above) using the edits format below;",
          "otherwise wait for the close-out turn, when you'll see everything and can do it properly.",
          "Most turns should NOT touch any files at all.",
          "\nSet session_closed to false - this isn't a close-session turn.",
        ].join("\n"),
    [
      "\nHow to propose a file change in file_updates - use exactly ONE of these per file, matching",
      "its type:",
      "\n1. Markdown files (state.md) - `edits`: an array of {old_string, new_string}.",
      "Each old_string must be copied EXACTLY, character-for-character, from the current content given",
      "to you above, and must be long enough (include a line or two of surrounding context) to match",
      "only ONE place in the file - an old_string that doesn't appear, or appears more than once, will",
      "be rejected and that specific edit silently skipped. Never include a whole file's content here -",
      "only the lines actually changing, plus enough surrounding text to pin the match uniquely.",
      "\n2. JSON files (challenge_v2.json, current_week.json, sleep_log.json) - `merge_patch`: a JSON",
      "MERGE PATCH (RFC 7396), encoded as a STRING (not a nested object). Only include the keys that",
      "are actually changing - a merge patch is shallow-merged onto the current object, so omitted",
      "keys are left untouched automatically (you do not need to repeat them). To delete a key, set",
      "its value to null in the patch. To replace an array, provide the whole new array (arrays",
      "replace wholesale, never merge element-by-element). Example patch string for adding a",
      "completed date to a quest: '{\"quests\":[{\"id\":\"cold_shower\",\"completed_dates\":[\"2026-08-02\"]}]}'",
      "- but only if that's really how the array should look after the change (you're replacing the",
      "whole quests array's matching entry, so reproduce its other current fields you're not changing).",
      "\n3. Session files (user_data/activities/workout_plans/sessions/<name>.json) - `content`: the",
      "full new file content as a string, same as before - these are almost always whole-new-file",
      "writes, not edits to an existing one.",
      "\nWhichever you use, never fabricate content for a file whose current contents you were not",
      "given above this turn.",
    ].join("\n"),
    "\nAlways include a short commit_message (SOUL.md §12 style, e.g. 'day-12 — logged sprint",
    "intervals', with no leading \"coach:\" - the caller adds that prefix itself) whenever",
    "file_updates is non-empty.",
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

  // B1: optional `contentsOverride` lets a caller (the closing-turn mismatch retry below) reuse
  // the exact same auth shape (cachedContent vs. systemInstruction) and generationConfig as
  // whichever useCache value the original successful call ended up using, while swapping in a
  // different `contents` array (the replayed prior turn + nudge) - only `contents` legitimately
  // differs for that retry, nothing else about the request.
  const buildRequestBody = (useCache: boolean, contentsOverride?: ReturnType<typeof buildContents>) => ({
    ...(useCache
      ? { cachedContent: cachedName }
      : { systemInstruction: { parts: [{ text: staticText + "\n" + buildDynamicText(false) }] } }),
    contents: contentsOverride ?? buildContents(useCache),
    generationConfig: GENERATION_CONFIG,
  });

  // Closing turns routinely carry the largest prompts in the system (full chat history plus four
  // extra files) and ask for the hardest output (a structured close-out summary), so they're the
  // most likely turn to legitimately need more than the shared UPSTREAM_TIMEOUT_MS (25s, sized
  // for plain file reads). Give the actual generateContent call its own longer budget rather than
  // inheriting the file-read default.
  const GEMINI_GENERATE_TIMEOUT_MS = 45_000;

  const callGemini = (useCache: boolean, contentsOverride?: ReturnType<typeof buildContents>): Promise<Response> =>
    fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(useCache, contentsOverride)),
      },
      GEMINI_GENERATE_TIMEOUT_MS,
    ).catch((err) => {
      // fetchWithTimeout THROWS a 504-tagged Error on its own abort, it never resolves a Response
      // for that case - so a bare `res.status === 504` check below would never see it. Convert it
      // into a resolved 504 Response here so every call site (the retry logic below,
      // finishGeminiResponse) can treat a timeout identically to a real 504 response without each
      // needing its own try/catch. Any other thrown error (a genuine network failure with no
      // status) still propagates.
      const status = (err as { status?: number }).status;
      if (status === 504) return new Response(null, { status: 504 });
      throw err;
    });

  // Validation logging: full visibility into what we actually asked for, paired with the full
  // response logging in parseGeminiResponseBody below - added while diagnosing how often/why
  // Gemini fails to populate coach_note/file_updates despite claiming to. Deliberately doesn't
  // log the full prompt text (the static system prompt alone is ~13K tokens) - mode and the
  // athlete's own message are the two things that actually vary call to call and matter for
  // correlating a request with its response.
  console.log("[coach-chat] request:", { mode, userMessage, useCache: !!cachedName, traceId });
  let useCache = !!cachedName;
  let res = await callGemini(useCache);
  // Capped at ONE retry total, not one per failure kind - a naive "retry the 400 case, then
  // separately retry the 504/503 case" allows a genuinely unlucky request to chain 3 full
  // GEMINI_GENERATE_TIMEOUT_MS-budget calls back to back (up to ~135s), which blows straight
  // through ui/vercel.json's maxDuration regardless of how generous that's set - the function
  // gets killed mid-request and the reliability fix doesn't help. Below, only ONE of the two
  // branches can ever fire per call to askGemini.
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
    // (503 UNAVAILABLE) are both transient and previously fatal on the first hit - confirmed in
    // production Vercel logs as the dominant cause of closing turns failing outright with nothing
    // committed. Retry once more; a short fixed backoff is enough since these aren't rate-limit
    // errors (that's 429, handled separately in finishGeminiResponse and never retried here). Note
    // this branch is unreachable on the same call where the 400 branch above already fired - if
    // the no-cache retry itself times out, that failure surfaces as-is rather than chaining a
    // third attempt.
    await new Promise((resolve) => setTimeout(resolve, 500));
    res = await callGemini(useCache);
  }

  if (mode !== "closing") {
    return finishGeminiResponse(res, mode, traceId);
  }

  // B1 (docs/eng-docs/coach-chat-closing-followup.md): closing-turn-only retry for a mismatch
  // between what `reasoning` claims and what `file_updates` actually contains - a distinct
  // failure class from the 400/504/503 transport/cache handling above (content mismatch, not a
  // failed request), so it deliberately shares no state or retry budget with that block and only
  // ever runs after `res` has already settled there. Confirmed necessary live: Part A alone
  // (schema reorder + broader close-trigger regex, #284) did not reliably prevent this.
  let { parsed: finalParsed, rawText } = await parseGeminiResponseBody(res);
  if (hasUnsavedContentMismatch(finalParsed.reasoning, finalParsed.file_updates, finalParsed.coach_note)) {
    try {
      // Replay the model's own prior turn verbatim, then nudge it to either genuinely populate
      // file_updates to match its own reasoning or admit there's nothing to save. Same auth shape
      // (cachedContent/systemInstruction) and generationConfig as the original successful call -
      // only `contents` differs.
      const retryContents = [
        ...buildContents(useCache),
        { role: "model", parts: [{ text: rawText }] },
        { role: "user", parts: [{ text: UNSAVED_CONTENT_RETRY_NUDGE }] },
      ];
      console.log("[coach-chat] request (retry):", { mode, userMessage, useCache, traceId });
      const retryRes = await callGemini(useCache, retryContents);
      const retryResult = await parseGeminiResponseBody(retryRes);
      finalParsed = retryResult.parsed;
      rawText = retryResult.rawText;
      console.log("[coach-chat] closing-turn retry fired - file_updates/reasoning mismatch", { traceId });
    } catch (err) {
      // Best-effort improvement only - a close that already has a valid (if incomplete) original
      // response must not become a hard failure just because the retry itself broke (network
      // error, non-ok status, bad JSON). Fall back to the original parsed result silently, aside
      // from this warning.
      console.warn("[coach-chat] closing-turn retry failed, falling back to original response", {
        traceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Same closing-turn logging finishGeminiResponse does for every close - factored out into a
  // shared helper (not a second call to finishGeminiResponse itself) because `res`'s body has
  // already been consumed by parseGeminiResponseBody above, and a Response body can only be read
  // once; re-invoking finishGeminiResponse(res, ...) here would throw trying to re-read it.
  logClosingTurnReasoning(finalParsed, traceId);
  // B1 point 9: still true after everything above (whether or not a retry ran) - the internal
  // flag consumed one layer up by the HTTP handler's honesty guard (B2), then stripped there.
  if (hasUnsavedContentMismatch(finalParsed.reasoning, finalParsed.file_updates, finalParsed.coach_note)) {
    finalParsed._unsavedContentSuspected = true;
  }
  delete finalParsed.reasoning;
  return finalParsed;
}

// B1: status/429/text-extraction/parsing only - NOT the mode-specific logging or the
// `delete parsed.reasoning` (finishGeminiResponse still owns those, see below). Split out so the
// closing-turn retry logic in askGemini can see the raw response text (to replay the model's own
// prior turn verbatim) and the parsed body (to run the mismatch heuristic) before `reasoning`
// gets stripped - finishGeminiResponse deletes it immediately, so nothing downstream of it could
// ever see either.
async function parseGeminiResponseBody(res: Response): Promise<{ parsed: GeminiReply; rawText: string }> {
  if (res.status === 429) {
    // Not necessarily free-tier - Tier 1 has its own (much higher) ceilings too. Both clients now
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
  // to the athlete). Covers every call site that goes through this function - greeting, ordinary,
  // closing, and B1's retry - so it's the one place to look to see exactly what Gemini actually
  // returned, not just the two fields logClosingTurnReasoning surfaces. Paired with the request
  // log in askGemini above (same traceId when one exists) to correlate ask vs. answer.
  console.log("[coach-chat] response:", JSON.stringify(parsed));
  return { parsed, rawText: text };
}

// On closing turns specifically, log the model's own stated reasoning before stripping it - this
// is the only place it's ever available (never persisted, never sent to the athlete), and it's
// exactly the diagnostic needed for a close that silently saves nothing: the model's own account
// of what it considered and why, correlatable by request time with the "zero file_updates"
// warning logged downstream once resolveFileUpdate/injectCoachSinceIfNeeded have run. Shared
// between finishGeminiResponse (greeting/ordinary paths never call this) and askGemini's own
// closing-turn retry logic above, so there's exactly one place this logging happens.
function logClosingTurnReasoning(parsed: GeminiReply, traceId?: string): void {
  console.log("[coach-chat] closing-turn reasoning:", parsed.reasoning, { traceId });
  console.log("[coach-chat] closing-turn checklist_covered:", parsed.checklist_covered, { traceId });
}

async function finishGeminiResponse(res: Response, mode: TurnMode, traceId?: string): Promise<GeminiReply> {
  const { parsed } = await parseGeminiResponseBody(res);
  // mode is never "closing" here in practice - askGemini intercepts closing turns before calling
  // this (see above) so it can run the B1 retry logic against the parsed/raw body first. Kept as
  // a real check anyway (not assumed away) so this function stays correct as a standalone entry
  // point, not just in its one current call site.
  if (mode === "closing") {
    logClosingTurnReasoning(parsed, traceId);
  }
  // reasoning is scratch space for the model, never meant for the athlete - delete here (not just
  // omit from responses) so it can never leak through any caller that spreads/serializes the
  // whole reply object, now or in the future, and so eval-coach-chat.ts's leak check
  // (`"reasoning" in reply`) holds on askGemini's actual return contract, not just this file's
  // own Response.json call sites.
  delete parsed.reasoning;
  return parsed;
}

// A7: only called on closing turns (see POST handler) - ordinary turns don't fetch these, per
// the "ordinary" prompt block in askGemini above. All four best-effort/independent; a missing
// file (never yet written) is a legitimate null, not an error.
async function loadClosingFileContext(repo: string, token: string): Promise<ClosingFileContext> {
  // coach_notes.md is deliberately not fetched here any more - Gemini never edits it, it only
  // reports a coach_note fact, and the actual append fetches its own fresh copy at commit time
  // (see the coachNoteWrite FileEntry below), not from this turn-start snapshot.
  const [challengeV2, currentWeek, sleepLog] = await Promise.all([
    getFileRaw(repo, CHALLENGE_V2_PATH, token),
    getFileRaw(repo, CURRENT_WEEK_PATH, token),
    getFileRaw(repo, SLEEP_LOG_PATH, token),
  ]);
  return { challengeV2, currentWeek, sleepLog };
}

// A7: resolves one Gemini-proposed file_update into final content using whichever strategy
// matches its path, against the current content already fetched into this turn's context
// (never re-fetched fresh here - same eventual-consistency window every other file write in
// this handler already accepts; only chat_history.json gets the resolve-fresh-on-retry
// treatment, since it's the one file every turn contends on). Returns null if the update
// should be dropped (wrong file, failed edit, invalid patch, blank content).
//
// currentContent distinguishes three states, not two:
//   - a string: fetched this turn, has real content
//   - null: fetched this turn, file genuinely doesn't exist yet (legitimate - first write)
//   - undefined: NOT fetched this turn at all (an ordinary turn never fetches
//     challenge_v2.json/current_week.json/sleep_log.json - only closing turns do). An edit/patch
//     proposed for a path in this state is Gemini disobeying its own turn-mode instructions -
//     applying it anyway would mean editing/patching against content we never actually saw,
//     which for a merge patch means silently replacing the whole file with just the patch's
//     keys. Reject outright rather than guessing.
// MVP (coach-commit-mvp.md): every drop now carries a named reason instead of a bare null, both
// logged here and returned to the caller so the close-trace line below doesn't have to scrape
// log output to know why a proposed update didn't land. `path` is always the update's own path,
// whether it landed or was dropped, so the caller can build a trace without re-deriving it.
export type ResolveFileUpdateResult =
  | { ok: true; path: string; content: string }
  | { ok: false; path: string; reason: string };

function dropped(reason: string, path: string): ResolveFileUpdateResult {
  console.warn(`[coach-chat] dropped update for ${path}: ${reason}`);
  return { ok: false, path, reason };
}

export function resolveFileUpdate(
  update: GeminiFileUpdate,
  currentContent: string | null | undefined,
): ResolveFileUpdateResult {
  if (!isCoachWritable(update.path)) return dropped("path is not coach-writable", update.path);

  // Session files never look at currentContent (full-content replacement, always) - only
  // markdown-edit and JSON-merge-patch files need to have actually been fetched this turn.
  const needsFetchedContent = MARKDOWN_EDIT_FILES.has(update.path) || JSON_MERGE_FILES.has(update.path);
  if (needsFetchedContent && currentContent === undefined) {
    return dropped("proposed without its current content having been fetched this turn", update.path);
  }

  if (MARKDOWN_EDIT_FILES.has(update.path)) {
    if (!update.edits || update.edits.length === 0) return dropped("markdown update with no edits array", update.path);
    const before = currentContent ?? "";
    const { content, failed } = applyStringEdits(before, update.edits);
    if (failed.length > 0) {
      console.warn(`[coach-chat] ${update.path}: ${failed.length} edit(s) didn't match and were skipped`);
    }
    // If every edit failed, content is identical to before - drop it rather than committing a
    // no-op write (and never commit a wipe-to-blank, same guard as before A7).
    if (content === before) return dropped("all edits failed to match - no-op, not committed", update.path);
    if (content.trim().length === 0) return dropped("result would be blank - refusing to wipe the file", update.path);
    return { ok: true, path: update.path, content };
  }

  if (JSON_MERGE_FILES.has(update.path)) {
    if (!update.merge_patch) return dropped("JSON update with no merge_patch", update.path);
    const result = applyJsonMergePatch(currentContent ?? null, update.merge_patch);
    if (!result.ok) {
      return dropped(`merge patch rejected - ${result.error}`, update.path);
    }
    return { ok: true, path: update.path, content: result.content };
  }

  // Session files (SESSIONS_PREFIX) - full-content replacement, same as before A7.
  if (!update.content || update.content.trim().length === 0) return dropped("session file update with blank content", update.path);
  return { ok: true, path: update.path, content: update.content };
}

// ADR 0018: coach_since is set automatically, server-side, the moment the false→true
// profileComplete transition happens - i.e. the turn that genuinely finishes the First Session
// Protocol - never at repo-provisioning time (an infra timestamp, not real usage; the same
// failure mode already rejected for repo.created_at). Defense in depth, same as the rest of A7:
// never relies on Gemini remembering to propose this field itself. Write-once - if coach_since
// is already present (e.g. this repo was manually backfilled per issue #199, or a retry of a
// turn that already stamped it), this is a no-op. Merges onto whatever challenge_v2.json write
// Gemini already proposed this turn (First Session Protocol also writes the season/quests here),
// so both land in the same commit rather than two separate writes.
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
      const closeIntent = isCloseSignal(trimmed);
      const now = Date.now();
      // MVP (coach-commit-mvp.md): minted here, not down at the close-trace log site, so it's
      // available to askGemini/finishGeminiResponse below - the model's own closing-turn
      // reasoning is the highest-value diagnostic line this trace exists for, and it has to be
      // taggable with the same traceId the eventual commit outcome logs under.
      const traceId = Math.random().toString(36).slice(2, 10);
      const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

      // A6/A7: only fetch today's other threads + the other coach-writable files' current
      // content when actually closing - an ordinary turn has no use for either and shouldn't
      // pay the extra reads (see the "ordinary" prompt block in askGemini).
      let extraContext: string | undefined;
      let closingFiles: ClosingFileContext | undefined;
      if (closeIntent) {
        const [history, files] = await Promise.all([loadChatHistory(repo, token), loadClosingFileContext(repo, token)]);
        extraContext = todaysOtherThreadsSummary(history.threads, stateMd ?? "", threadId ?? "");
        closingFiles = files;
        const dayNumber = coachDayNumber(closingFiles.challengeV2, stateMd ?? "", new Date());
        const dayNumberLine =
          dayNumber != null
            ? `Today is day ${dayNumber} since this athlete started with Coach. If commit_message includes a ` +
              `day-N reference, use exactly ${dayNumber} - never guess or increment from a previous message.`
            : "No coach_since or season start date is available yet to compute a day number - omit any day-N " +
              "reference from commit_message rather than inventing one.";
        extraContext = extraContext ? `${extraContext}\n\n${dayNumberLine}` : dayNumberLine;
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
          extraContext,
          closingFiles,
          traceId,
        );
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error("[coach-chat] askGemini failed:", err);
        return Response.json({ error: errMessage }, { status });
      }

      // B2 (docs/eng-docs/coach-chat-closing-followup.md): honesty guard - if askGemini's B1
      // retry still couldn't resolve the reasoning/file_updates mismatch, and this turn is
      // genuinely claiming a close (session_closed: true, not a clarifying question), append a
      // caveat to what the athlete actually sees/what gets persisted, before coachMsg is built
      // below. Checked session_closed === true specifically (not the broader `closing` local var,
      // not computed yet) - the guard's whole purpose is correcting a false "saved" framing; if
      // the model is asking a clarifying question instead, it isn't claiming anything was saved,
      // so there's nothing to caveat. The delete runs unconditionally regardless of whether the
      // caveat fired, same defense-in-depth treatment as `reasoning` gets, even though no current
      // Response.json call site spreads `reply` wholesale.
      if (reply._unsavedContentSuspected && reply.session_closed === true) {
        reply.reply =
          reply.reply +
          "\n\n(One thing to flag: I ran into trouble saving today's notes — worth double-checking " +
          "your log next time you're in, and let me know if anything's missing.)";
      }
      delete reply._unsavedContentSuspected;

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

      // coach-commit-mvp: only included in `writes` below when reply.coach_note is present and
      // non-empty after trimming. Fetches coach_notes.md's own fresh content at commit time
      // (same pattern as chatWrite above), not from a turn-start snapshot - closingFileContext no
      // longer fetches this file at all (see loadClosingFileContext).
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

      // A7: resolve each proposed update (edits/merge_patch/content, depending on file type)
      // against whatever current content this turn actually had for that path - drops anything
      // unwritable, unresolvable (edit didn't match, patch invalid), or blank. `undefined` here
      // means "not fetched this turn at all" (distinct from `null`, "fetched, doesn't exist yet")
      // - challenge_v2.json/current_week.json/sleep_log.json are only fetched on
      // closing turns, so on an ordinary turn they're `undefined` and resolveFileUpdate rejects
      // any proposed edit/patch against them rather than guessing at unseen content.
      const currentContentByPath: Record<string, string | null | undefined> = {
        [STATE_FILE_PATH]: stateMd ?? null,
        [CHALLENGE_V2_PATH]: closingFiles ? closingFiles.challengeV2 : undefined,
        [CURRENT_WEEK_PATH]: closingFiles ? closingFiles.currentWeek : undefined,
        [SLEEP_LOG_PATH]: closingFiles ? closingFiles.sleepLog : undefined,
      };

      // Dedup by path before resolving - two file_updates entries for the same path would
      // otherwise both resolve against the same stale snapshot and land as two blob entries at
      // the same tree path in one commit (githubGitData.ts's tree builder has no defined
      // precedence for that). Last one in Gemini's response wins, matching what the underlying
      // Git Data API would silently do anyway - but now it's an explicit, logged choice.
      const dedupedFileUpdates = new Map<string, GeminiFileUpdate>();
      for (const update of reply.file_updates ?? []) {
        if (dedupedFileUpdates.has(update.path)) {
          console.warn(`[coach-chat] duplicate file_updates entry for ${update.path} in one turn - using the last one`);
        }
        dedupedFileUpdates.set(update.path, update);
      }

      const resolveResults = [...dedupedFileUpdates.values()].map((f) => resolveFileUpdate(f, currentContentByPath[f.path]));
      const resolvedUpdates = resolveResults
        .filter((r): r is Extract<ResolveFileUpdateResult, { ok: true }> => r.ok)
        .map(({ path, content }) => ({ path, content }));
      const droppedUpdates = resolveResults.filter((r): r is Extract<ResolveFileUpdateResult, { ok: false }> => !r.ok);

      // B2/ADR 0018: detect the false→true profileComplete transition against what's actually
      // about to be committed (not the pre-turn snapshot alone) - a close-turn that finishes the
      // intake writes state.md this same turn and coach_since must key off that fresh value.
      const wasProfileComplete = isAthleteProfileComplete(stateMd ?? "");
      const committedStateMd = resolvedUpdates.find((u) => u.path === STATE_FILE_PATH)?.content ?? stateMd ?? "";
      const profileComplete = isAthleteProfileComplete(committedStateMd);
      const validUpdates = injectCoachSinceIfNeeded(resolvedUpdates, closingFiles, wasProfileComplete, profileComplete, stateMd ?? "");

      // Nothing in code blocks a close from landing with zero file_updates - the prompt asks
      // Gemini to always propose something on genuine content and to say so honestly when there's
      // truly nothing, but compliance isn't enforced here. Without this, a close that silently
      // saved nothing was completely invisible (found the hard way: real conversations with real
      // training content closing with only chat_history.json touched, no way to tell from a commit
      // history alone whether that was a deliberate empty close or a missed one). The model's own
      // reasoning for this specific request was already logged in finishGeminiResponse (stripped
      // from `reply` by the time it reaches here) - correlate by request time.
      // coach-commit-mvp: a coach_note-only close (real content, no file_updates) is now a
      // legitimate, complete close on its own - only warn when BOTH are empty/missing, not just
      // validUpdates alone, so a healthy coach_note-only close doesn't cry wolf.
      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with zero file_updates and no coach_note.", { athleteMessage: trimmed });
      }

      const commitMessage = reply.commit_message ? cleanCommitMessage(reply.commit_message) : "session update";

      // ADR 0012: every file_update plus the updated chat_history.json (plus coach_notes.md, when
      // reply.coach_note was reported) lands in ONE atomic commit via the Git Data API, instead of
      // a separate REST PUT per file.
      const writes: FileEntry[] = coachNoteWrite ? [...validUpdates, chatWrite, coachNoteWrite] : [...validUpdates, chatWrite];

      // MVP (coach-commit-mvp.md) P2: distinguishes "Gemini didn't propose file_updates at all"
      // from "Gemini proposed an empty array" (both used to render as a bare `[]`), and records
      // which write strategy (edits/merge_patch/content, see GeminiFileUpdate) each entry used -
      // exactly the detail this trace exists to capture for a strategy-specific bug. A path could
      // in principle carry none of the three, so that's represented rather than assumed away.
      const emittedTrace =
        reply.file_updates === undefined
          ? { proposed: false as const }
          : {
              proposed: true as const,
              entries: reply.file_updates.map((u) => ({
                path: u.path,
                strategy:
                  u.edits !== undefined
                    ? ("edits" as const)
                    : u.merge_patch !== undefined
                    ? ("merge_patch" as const)
                    : u.content !== undefined
                    ? ("content" as const)
                    : ("none" as const),
              })),
            };

      let repoSha: string;
      try {
        const result = await commitFilesAtomic(writes, `coach: chat — ${commitMessage}`, {
          repo,
          // MVP (coach-commit-mvp.md): configurable so testing a real close doesn't have to write
          // to a live athlete's actual main - defaults to main, unchanged, when unset.
          branch: process.env.COACH_CHAT_BRANCH ?? "main",
          token,
        });
        repoSha = result.commitSha;
        // MVP (coach-commit-mvp.md): one structured line per close, correlating everything the
        // model proposed with what actually got committed and why anything didn't - a close that
        // proposed five unwritable paths and a close that proposed nothing used to be
        // indistinguishable in the logs. Logged only now, after the commit has genuinely landed -
        // logging this before the try block (as result: "committed") meant a close that actually
        // threw still asserted success for every path, directly contradicting the error line
        // logged right after it. console.log, not warn: a healthy close isn't a problem, and warn
        // is the level used to filter for real ones - see the catch block's failure variant below.
        console.log("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          emitted: emittedTrace,
          outcomes: [
            ...validUpdates.map((u) => ({ path: u.path, result: "committed" as const })),
            ...droppedUpdates.map((d) => ({ path: d.path, result: "dropped" as const, reason: d.reason })),
          ],
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
        // Failure variant of the close-trace line above, same shape/fields and same traceId -
        // nothing in `writes` actually landed (the commit is atomic), so every resolved update is
        // reported "commit_failed" rather than "committed". console.error: unlike the healthy-close
        // line above, this genuinely is the problem this trace exists to catch.
        console.error("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          emitted: emittedTrace,
          outcomes: [
            ...validUpdates.map((u) => ({ path: u.path, result: "commit_failed" as const })),
            ...droppedUpdates.map((d) => ({ path: d.path, result: "dropped" as const, reason: d.reason })),
          ],
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
