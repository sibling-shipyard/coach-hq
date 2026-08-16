/**
 * Coach-chat's Gemini prompt construction: response schema, static (cacheable) persona/
 * instructions text, per-turn dynamic text, onboarding-hint context. Pure text-building - no
 * network calls, no caching I/O (that's geminiClient.ts).
 *
 * coach-chat-reliability-debug: stripped to the smallest reliable ask - a plain conversation,
 * plus a short append-only note on close. No file_updates, checklist gate, retry/honesty guard,
 * or title. `reasoning` removed too - it was suspected of acting as a release valve, letting the
 * model narrate intent there instead of committing it to coach_note.
 */
import type { ChatMessage } from "./chatThreads.js";
import { todayContextLine } from "./coachDay.js";

export interface GeminiReply {
  reply: string;
  // Closing turns only - a short plain-English note appended (with today's date) to
  // coach_notes.md at commit time (coachWrites.ts's appendCoachNote). Never shown to the athlete.
  // Also reused server-side (unchanged, no new field) into rolling_state.json's last-N-sessions
  // log - see coachIntents.ts's applyRollingState.
  coach_note?: string;
  // Closing turns only - the athlete's keyword match just triggers asking Gemini to consider
  // closing, not a guarantee it did. False means Gemini asked a clarifying question instead.
  session_closed?: boolean;
}

export type TurnMode = "greeting" | "ordinary" | "closing";

// Caps messages within a thread (thread count itself is capped separately, chatThreads.ts's
// MAX_RETAINED_THREADS) - a simple hard window against pathological growth, not real compaction.
export const MAX_HISTORY_MESSAGES = 40;

// Two worked examples covering the two turn shapes that exist now: an ordinary turn with
// nothing to save, and a real close with a coach_note. Sits in the cached prefix, so it's a
// one-time token cost.
const FEW_SHOT_EXAMPLES = [
  "<example_1 note=\"ordinary turn\">",
  "Athlete: legs feel a bit heavy today but nothing alarming",
  'Coach (JSON): {"reply":"Heavy legs happen, especially with the volume you\'ve had this week. Keep today\'s effort honest and back off the last couple intervals if it doesn\'t ease up.","session_closed":false}',
  "</example_1>",
  "<example_2 note=\"closing turn - real content, a real coach_note\">",
  "Athlete: yeah ran the intervals, felt strong, wrap session",
  'Coach (JSON): {"coach_note":"Ran intervals today, felt strong throughout. No soreness or issues reported. Plan is to build on this Thursday.","session_closed":true,"reply":"Nice work - that\'s locked in. Rest up, we\'ll build on this Thursday."}',
  "</example_2>",
].join("\n");

// Shared between the primary call and the stale-cache retry in geminiClient.ts - the response
// shape doesn't depend on whether cachedContent was used.
export const GENERATION_CONFIG = {
  responseMimeType: "application/json",
  // Shrunk from 16384 now that the ask is a handful of short fields - also caps the damage from
  // the repetition-loop failure mode observed in testing.
  maxOutputTokens: 2048,
  responseSchema: {
    type: "object",
    properties: {
      // Declared first, before reply, so there's nothing else to commit to first.
      coach_note: { type: "string" },
      session_closed: { type: "boolean" },
      reply: { type: "string" },
    },
    required: ["reply"],
  },
} as const;

// The static half of the prompt - byte-identical every call, uploaded once via Gemini's
// explicit-caching API (geminiClient.ts) instead of resent per request. Kept separate from the
// dynamic block below since Gemini rejects setting both `cachedContent` and `systemInstruction`
// on the same request.
export function staticSystemText(soul: string): string {
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
    "</instructions>",
    "\n<examples>\n" + FEW_SHOT_EXAMPLES + "\n</examples>",
  ].join("\n");
}

// The per-turn dynamic half of the prompt: current state/quest_log, mode-specific instructions,
// and (deliberately last, since it changes every minute) today's date/time. `useCache` only
// changes the framing sentence at the top - it ships as a synthetic turn when a cache is active,
// or gets concatenated into systemInstruction directly when it isn't.
export function buildDynamicText(
  stateMd: string,
  questLog: string,
  mode: TurnMode,
  extraContext: string | undefined,
  useCache: boolean,
): string {
  return [
    // Only relevant on the cached path, where this block arrives as a synthetic turn rather than
    // systemInstruction - spelled out explicitly since a plain instructions block dropped mid-
    // conversation otherwise reads with less authority. Omitted on the no-cache path, where this
    // text is concatenated directly into systemInstruction and the claim wouldn't be true.
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
          "a plan for next time). There is no file to edit, no checklist to fill in - report facts,",
          "the server handles saving them. If there's truly nothing concrete from this conversation,",
          "say so honestly in coach_note instead of inventing content.",
          "**Never say something is saved, logged, locked, or committed unless coach_note in this",
          "exact response genuinely reflects it.**",
          "\nSet session_closed to true only if you are genuinely closing out the session in this exact",
          "response (asking a clarifying question instead does NOT count - set it false in that case,",
          "even though this turn was triggered by a close-session phrase). The athlete will simply see",
          "your question and reply normally; you'll get another chance to close once they answer.",
        ].join("\n")
      : [
          "\nThis is an ordinary turn, not a close-out - just talk with the athlete the way SOUL.md",
          "describes. Nothing about this turn gets saved anywhere; that only happens on a genuine",
          "close. Set session_closed to false - this isn't a close-session turn.",
        ].join("\n"),
    // Deliberately last - the one piece of this prompt that changes every minute.
    "\n" + todayContextLine(stateMd),
  ].join("\n");
}

// Filters + windows the raw thread history into the {role, parts} shape Gemini expects.
export function buildHistoryContents(history: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
  return history
    .filter((m): m is Extract<ChatMessage, { role: "user" | "coach" }> => m.role === "user" || m.role === "coach")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.role === "user" ? m.text : m.paragraphs.join("\n\n") }],
    }));
}

// B4: sport(s)/goal from iOS's native onboarding, passed on the first greet() so the First
// Session Protocol can reflect them back instead of asking cold - platform/soul/B_engine.md §10.
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

/**
 * The First Session Protocol, injected only while the athlete's profile is still empty.
 *
 * **This must never move into `staticSystemText()`.** That string is hashed and uploaded as
 * Gemini's cached prefix (soulCache.ts) - one cache entry serves every athlete. Anything
 * per-athlete in there forks the cache per athlete and silently destroys the discount. It rides
 * in `buildDynamicText()`'s `extraContext` for that reason, and for that reason only.
 *
 * SOUL.chat.md does not contain this text at all (compose-soul.mjs's HORCRUXES) - roughly 50
 * lines every athlete would otherwise carry on every turn forever to serve one conversation.
 * The claude build keeps it inline; BYOB has no injection seam and no per-turn cost.
 */
export function firstSessionContext(profileComplete: boolean, protocol: string): string | undefined {
  if (profileComplete) return undefined;
  return [
    "<first_session>",
    "This athlete's user_data/coach/state.md has an empty Athlete Profile - they have never been",
    "onboarded. This is their first session. Run the protocol below instead of coaching normally.",
    "Steps that would need a shell or a git commit have been removed; do the conversational work",
    "and the state.md/challenge_v2.json content, and the backend handles saving.",
    "",
    protocol.trim(),
    "</first_session>",
  ].join("\n");
}

/** Joins the optional per-turn context blocks, dropping the ones that didn't fire. */
export function combineExtraContext(...blocks: (string | undefined)[]): string | undefined {
  const present = blocks.filter((b): b is string => Boolean(b && b.trim()));
  return present.length > 0 ? present.join("\n\n") : undefined;
}

// Part B step 2: renders rolling_state.json's last-N-sessions log (coachIntents.ts's
// applyRollingState) into context text. Reuses coach_note verbatim (no separate Gemini field, no
// new generation-failure surface) - see coach-chat/README.md's rebuild note. Returns undefined on
// missing/empty/unparsable content so the caller can omit this block entirely rather than inject
// an empty one.
export function rollingStateContext(rollingStateJson: string | null | undefined): string | undefined {
  if (!rollingStateJson) return undefined;
  let entries: { date?: string; text?: string }[];
  try {
    const parsed = JSON.parse(rollingStateJson);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    return undefined;
  }
  const lines = entries
    .filter((e): e is { date: string; text: string } => typeof e.date === "string" && typeof e.text === "string")
    .map((e) => `- ${e.date}: ${e.text}`);
  if (lines.length === 0) return undefined;
  return ["Recent sessions (most recent first):", ...lines].join("\n");
}
