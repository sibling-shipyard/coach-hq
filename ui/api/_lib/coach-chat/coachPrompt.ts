/**
 * Coach-chat's Gemini prompt construction: the response schema, the static (cacheable) persona/
 * instructions text, the per-turn dynamic text (state/mode-specific instructions/today's date),
 * and onboarding-hint context. Pure text-building - no network calls, no caching I/O (that's
 * geminiClient.ts).
 *
 * coach-chat-reliability-debug: stripped to the smallest ask that could possibly be reliable -
 * a plain conversation, and on a genuine close, a short append-only note. No file_updates, no
 * checklist gate, no Part B retry/honesty-guard, no title - testing whether that alone is more
 * reliable. `reasoning` removed too: live testing at this same minimal scope still found
 * coach_note coming back empty while reasoning explicitly described real content worth saving -
 * theory is reasoning may be acting as a release valve (the model "thinks out loud" there and
 * doesn't feel compelled to duplicate it into the actual structured field). Testing whether
 * asking for coach_note directly, first, with no separate scratch-pad field to offload into,
 * changes anything.
 */
import type { ChatMessage } from "./chatThreads.js";
import { todayContextLine } from "./coachDay.js";

export interface GeminiReply {
  reply: string;
  // Only meaningful on a closing=true turn - a short (3-5 line) plain-English note of what
  // actually happened this session, worth remembering long-term. Appended by the server (with
  // today's date) to coach_notes.md at commit time (see coachWrites.ts's appendCoachNote) - never
  // shown to the athlete in any current response.
  coach_note?: string;
  // Only meaningful on a closing=true turn (see geminiClient.ts's askGemini) - the athlete's
  // keyword match is just a trigger to ask Gemini to consider closing, not a guarantee it
  // actually did. Gemini sets this false when it's asking a clarifying question instead of
  // closing (see prompt), and the server must not commit/report closed:true unless this comes
  // back true.
  session_closed?: boolean;
}

export type TurnMode = "greeting" | "ordinary" | "closing";

// Thread count is capped elsewhere (chatThreads.ts's MAX_RETAINED_THREADS), but messages
// *within* a thread weren't - a long conversation before close grew every subsequent request
// linearly, on top of the fixed system-prompt prefix. 40 is generous for a single day's check-
// in/close-out (SOUL's actual usage pattern) while stopping pathological growth; a real
// conversation-compaction pattern (summarize what's trimmed, per Anthropic's context-engineering
// guidance) is future work once usage data exists to size it properly - this is a simple hard
// window, not that.
export const MAX_HISTORY_MESSAGES = 40;

// Two worked examples of the exact JSON shape expected, covering the two turn shapes that
// actually exist now: an ordinary turn with nothing worth saving, and a real close with a real
// coach_note. Sits inside the cached prefix (see systemInstruction below) so it's a one-time
// token cost, not per-turn.
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

// Shared between the primary cached-or-not call and the stale-cache retry in geminiClient.ts's
// askGemini - the response shape Gemini should return doesn't depend on whether cachedContent
// was used.
export const GENERATION_CONFIG = {
  responseMimeType: "application/json",
  // coach-chat-reliability-debug: the ask is now a handful of short fields, not a multi-file
  // edit proposal - shrunk from 16384. Also acts as a cheap bound against the repetition-loop
  // failure mode observed in testing (the model burning its whole budget on runaway repeated
  // text in one field) - a smaller cap means less damage before generation is cut off.
  maxOutputTokens: 2048,
  responseSchema: {
    type: "object",
    properties: {
      // coach-chat-reliability-debug: `reasoning` removed - testing whether it was acting as a
      // release valve for coach_note (the model narrating its own intent there instead of
      // transcribing it into the real field). coach_note is declared first now, before reply,
      // so there's nothing else to commit to first.
      coach_note: { type: "string" },
      session_closed: { type: "boolean" },
      reply: { type: "string" },
    },
    required: ["reply"],
  },
} as const;

// The truly static half of the prompt - byte-identical on every single call, for every athlete.
// This is what gets uploaded once via Gemini's explicit-caching API (see geminiClient.ts's use of
// soulCache.ts) instead of being resent as text on every request. Kept separate from the per-turn
// dynamic block below because Gemini rejects a generateContent request that sets both
// `cachedContent` and `systemInstruction` - when a cache is active, this text isn't sent at all,
// only referenced.
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
// and (deliberately last, since it changes every single minute) today's date/time. `useCache`
// only changes the framing sentence at the top (see geminiClient.ts's buildContents for why -
// this text ships as a synthetic turn when a cache is active, or gets concatenated into
// systemInstruction directly when it isn't, and the framing has to describe whichever is true).
export function buildDynamicText(
  stateMd: string,
  questLog: string,
  mode: TurnMode,
  extraContext: string | undefined,
  useCache: boolean,
): string {
  return [
    // When explicit caching is active, this whole block is injected as a synthetic turn (see
    // geminiClient.ts's buildContents) rather than living in `systemInstruction` - Gemini's API
    // rejects setting both on the same request. A plain instructions block dropped mid-
    // conversation reads with less authority than a system instruction, so it's spelled out
    // explicitly here. Only relevant - and only true - on the cached path: in the no-cache
    // fallback, this text gets concatenated directly into systemInstruction itself, so a claim
    // about "arriving as a turn instead of a system field" would be describing a mechanism
    // that isn't happening. Omit it there rather than confuse the model with a false framing.
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
}

// Gemini's generateContent needs at least one content entry to generate against - a greeting
// turn has no real athlete message yet, so the caller passes a hidden trigger string, never
// shown to the athlete (the mode-specific instructions above tell Gemini exactly what to do with
// it). Filters + windows the raw thread history into the {role, parts} shape Gemini expects.
export function buildHistoryContents(history: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
  return history
    .filter((m): m is Extract<ChatMessage, { role: "user" | "coach" }> => m.role === "user" || m.role === "coach")
    // Only thread *count* was capped before (chatThreads.ts's MAX_RETAINED_THREADS) - nothing
    // stopped a single long conversation from growing every request linearly on top of the fixed
    // system-prompt prefix. Keep just the most recent messages; real compaction/summarization is
    // future work.
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.role === "user" ? m.text : m.paragraphs.join("\n\n") }],
    }));
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
