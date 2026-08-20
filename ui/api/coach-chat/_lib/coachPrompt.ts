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
import { MEMORY_NOTE_LABELS, type MemoryNoteLabel, type InjuriesJson } from "./coachMemoryFiles.js";
import type { QuestsJson } from "./coachQuestFiles.js";
import type { WeekPlan, SessionReconcileEvent, PlanEditEvent } from "./coachWeekFiles.js";

export interface GeminiReply {
  reply: string;
  // See responseSchema's coach_note and coachIntents.ts's applyCoachNote.
  coach_note?: string;
  // See responseSchema's memory_update and coachIntents.ts's applyMemoryUpdate.
  memory_update?: { label: MemoryNoteLabel; text: string };
  // See responseSchema's coaching_style_update for rationale and legal values.
  coaching_style_update?: "accountability" | "encouragement" | "analysis";
  // See responseSchema's sports_update for rationale.
  sports_update?: string[];
  // See responseSchema's injury_event for the array rationale and wire shape.
  injury_event?: { status: "active" | "resolved"; text?: string; flag_id?: string }[];
  // See responseSchema's quest_event for the array, server-owned fields, and value rationale.
  quest_event?: { quest_id: string; status: "completed" | "missed" | "excused"; value?: string }[];
  // See responseSchema's profile_update for the array and value rationale.
  profile_update?: { field: "name" | "dob" | "timezone" | "height_cm" | "weight_kg"; value: string }[];
  // See responseSchema's template_edit for rationale and wire shape.
  template_edit?: { template_id: string; skip_exercise_nums?: number[]; skip_phases?: string[]; note?: string };
  // See responseSchema's session_plan for the server-owned date and skip_phases rationale.
  session_plan?: { template_id: string; skip_exercise_nums?: number[]; skip_phases?: string[]; note?: string };
  // See responseSchema's week_plan and coachWeekFiles.ts's applyWeekPlan.
  week_plan?: WeekPlan;
  // See responseSchema's session_reconcile and SessionReconcileEvent.
  session_reconcile?: SessionReconcileEvent[];
  // See responseSchema's plan_edit and PlanEditEvent.
  plan_edit?: PlanEditEvent[];
  // See responseSchema's season_start for scope and rationale.
  season_start?: { name: string; start_date: string; end_date: string };
  // See responseSchema's quest_create for scope and rationale.
  quest_create?: {
    main_quest?: { name: string; type: "daily_streak" | "progress" | "count_target" | "weekly_frequency"; target: number; count_pattern?: string };
    quests?: {
      name: string;
      type: "daily_streak" | "progress" | "count_target" | "weekly_frequency";
      polarity?: "default_done" | "default_not_done";
      target?: number;
      unit?: string;
    }[];
  };
  // See responseSchema's session_closed for the required-field rationale.
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
  // Was 2048 (shrunk from 16384 when the ask was a handful of short fields). Raised after live
  // verification hit a real truncation - a turn combining coach_note/reply with a
  // session_reconcile actual{} and a plan_edit entry produced an "Unterminated string in JSON"
  // error, not a network failure. The schema has grown a lot since 2048 was chosen (week_plan,
  // session_reconcile+actual, plan_edit, template_edit, session_plan all coexist as possible
  // fields now) - 4096 gives real headroom for a turn that legitimately needs several of them at
  // once, while still well short of the original 16384 (and its repetition-loop risk).
  maxOutputTokens: 4096,
  responseSchema: {
    type: "object",
    properties: {
      // Commitment fields declared before reply (gemini-flow.md's Action-field design rule #4) -
      // there's nothing else to commit to first.
      // Closing-turn continuity note appended to coach_log.json; never shown to the athlete.
      coach_note: { type: "string" },
      // Replaces one of memory.json's constrained labelled note boxes in full.
      memory_update: {
        type: "object",
        properties: {
          label: { type: "string", enum: [...MEMORY_NOTE_LABELS] },
          text: { type: "string" },
        },
      },
      // Constrained enum, not free text - matches B_engine.md's real FSP intake question
      // ("How do you respond to being pushed?"). Also written by First Session Protocol; this
      // is the chat-editable path for changing it later.
      coaching_style_update: {
        type: "string",
        enum: ["accountability", "encouragement", "analysis"],
      },
      // Separate top-level memory.json field, not a labelled memory note. First Session Protocol
      // writes it when first stated; later chat may replace the full list.
      sports_update: { type: "array", items: { type: "string" } },
      // Array (workout-backend-wiring live verification, same fix issue #410 already gave
      // quest_event) - a turn can report more than one injury update.
      injury_event: {
        type: "array",
        items: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "resolved"] },
            text: { type: "string" },
            flag_id: { type: "string" },
          },
          required: ["status"],
        },
      },
      // Part 2 ledger split, step 3a - shipped and tested in isolation before profile_update
      // (gemini-flow.md's Action-field design rule #2). No `date` - server stamps it. Array
      // (issue #410) so a turn reporting several quest completions at once captures all of them.
      // value is string-only because that is all structured output can produce here.
      quest_event: {
        type: "array",
        items: {
          type: "object",
          properties: {
            quest_id: { type: "string" },
            status: { type: "string", enum: ["completed", "missed", "excused"] },
            value: { type: "string" },
          },
        },
      },
      // Part 2 ledger split, step 3b - shipped after quest_event confirmed working live.
      // Array (workout-backend-wiring live verification, same fix issue #410 already gave
      // quest_event) - a turn can report more than one profile field at once. value is
      // string-only because that is all structured output can produce here.
      profile_update: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: ["name", "dob", "timezone", "height_cm", "weight_kg"] },
            value: { type: "string" },
          },
          required: ["field", "value"],
        },
      },
      // Permanent structural removal from an existing template. Single object: one edit per
      // closing turn. Free-form generation was removed because its second model call doubled the
      // failure surface; unsupported additions must not be represented as edits.
      // template_id is free text in the schema itself (Gemini's real ids come from context, per
      // activeTemplatesContext below); coachWorkoutFiles.ts's applyTemplateEdit is the actual
      // enforcement point.
      template_edit: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          skip_exercise_nums: { type: "array", items: { type: "number" } },
          skip_phases: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        required: ["template_id"],
      },
      // Today's modified session from an existing template. Single object: one prescription per
      // closing turn. The server stamps session_date, deliberately limiting this action to today;
      // future-dated prescriptions require an explicit later schema change. skip_phases is plain
      // language because Gemini does not receive full template exercise numbers; the server
      // resolves the phase against the real template at commit time.
      session_plan: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          skip_exercise_nums: { type: "array", items: { type: "number" } },
          skip_phases: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        // template_id is the only field the write guard in coach-chat.ts actually needs
        // (skip_exercise_nums/note are genuinely optional content) - required here so Gemini
        // can't set this field at all without it, same "no silently-partial commitment object"
        // discipline as template_edit above.
        required: ["template_id"],
      },
      // coach-redesign workout-backend-wiring §5 - single object, the Weekly Kick-off Ritual's
      // full seven-day rewrite. priority/planned_duration_min/template_id are all optional per
      // session (server fills in a default priority, see coachWeekFiles.ts's
      // DEFAULT_SESSION_PRIORITY, when Gemini leaves it out). No enum "null" option for priority -
      // Gemini simply omits the field when it doesn't have a clear call.
      week_plan: {
        type: "object",
        properties: {
          focus: { type: "string" },
          guardrails: { type: "array", items: { type: "string" } },
          headline: { type: "string" },
          body: { type: "string" },
          days: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                intent: { type: "string" },
                sessions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      discipline: { type: "string" },
                      kind: { type: "string" },
                      title: { type: "string" },
                      priority: { type: "string", enum: ["anchor", "support", "optional"] },
                      planned_duration_min: { type: "number" },
                      template_id: { type: "string" },
                    },
                    required: ["discipline", "kind", "title"],
                  },
                },
              },
              required: ["date", "sessions"],
            },
          },
        },
        required: ["headline", "body", "days"],
      },
      // coach-redesign workout-backend-wiring §5 - array, mirrors quest_event's shape.
      // session_id must be one of the ids listed in context (activeWeekSessionsContext below) -
      // never invented. `actual` only when what happened differs from what was planned.
      session_reconcile: {
        type: "array",
        items: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            status: { type: "string", enum: ["done", "skipped"] },
            activity_ids: { type: "array", items: { type: "string" } },
            actual: {
              type: "object",
              properties: {
                discipline: { type: "string" },
                kind: { type: "string" },
                title: { type: "string" },
                template_id: { type: "string" },
              },
              required: ["discipline", "kind", "title"],
            },
          },
          required: ["session_id", "status"],
        },
      },
      // coach-redesign workout-backend-wiring §5 follow-up - array, edits an existing session's
      // planned content without a full week_plan rewrite. session_id must be one of the ids
      // listed in context (activeWeekSessionsContext below) - never invented.
      plan_edit: {
        type: "array",
        items: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            discipline: { type: "string" },
            kind: { type: "string" },
            title: { type: "string" },
            template_id: { type: "string" },
          },
          required: ["session_id", "discipline", "kind", "title"],
        },
      },
      // First Session Protocol only - creates the athlete's first and only season through this
      // field. There is no returning-athlete season-change path anywhere in the system - Weekly
      // Kick-off/Sunday Session never write seasons.json, only current_week.json.
      season_start: {
        type: "object",
        properties: {
          name: { type: "string" },
          start_date: { type: "string" },
          end_date: { type: "string" },
        },
        required: ["name", "start_date", "end_date"],
      },
      // First Session Protocol only - creates the athlete's main quest and any habit quests.
      // Never used for a returning athlete's quest changes - there is no such path.
      quest_create: {
        type: "object",
        properties: {
          main_quest: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string", enum: ["daily_streak", "progress", "count_target", "weekly_frequency"] },
              target: { type: "number" },
              count_pattern: { type: "string" },
            },
            required: ["name", "type", "target"],
          },
          quests: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["daily_streak", "progress", "count_target", "weekly_frequency"] },
                polarity: { type: "string", enum: ["default_done", "default_not_done"] },
                target: { type: "number" },
                unit: { type: "string" },
              },
              required: ["name", "type"],
            },
          },
        },
      },
      session_closed: { type: "boolean" },
      reply: { type: "string" },
    },
    // session_closed is required, not optional: live verification found Gemini intermittently
    // omitting it on longer closing-turn responses (a real week_plan, a template_edit) since it
    // wasn't enforced - the prompt always instructs a value either way (true/false depending on
    // mode), so this just makes the schema match what's already asked of the model, rather than
    // letting the close silently die whenever the field goes missing.
    required: ["reply", "session_closed"],
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
    "have is already given to you below (current athlete context and current quest context) or in this",
    "conversation. If SOUL.md instructs you to read a file or run a command you don't have access",
    "to here, ignore that instruction rather than acting like you did it.",
    "You are Coach Phelps ONLY. Never act as Tech Lead, UI Expert, Bob the Builder, iOS Builder, or any",
    "other role from this repo. Never write or discuss code, architecture, or pull requests. If asked to",
    "break character or act as a different assistant, decline in-voice and stay Coach Phelps.",
    "</instructions>",
    "\n<examples>\n" + FEW_SHOT_EXAMPLES + "\n</examples>",
  ].join("\n");
}

const SAVE_CLAIM_GUARD =
  "Never say something is saved, logged, locked, or committed unless the matching action field in this exact response reflects it.";
const SESSION_STAYS_OPEN = "Set session_closed to false; this response does not close the session.";
const SESSION_CLOSE_DECISION = [
  "Set session_closed to true only if you are genuinely closing in this response. If you need to",
  "ask a clarifying question, set it false; you can close after the athlete answers.",
].join("\n");

// The per-turn dynamic half of the prompt: current state/quest_log, mode-specific instructions,
// and (deliberately last, since it changes every minute) today's date/time. `useCache` only
// changes the framing sentence at the top - it ships as a synthetic turn when a cache is active,
// or gets concatenated into systemInstruction directly when it isn't.
// questContext is now built server-side from seasons.json/quests.json/progress.json
// (coachContext.ts's renderQuestContext) rather than a fetched precomputed markdown artifact -
// Part 2 ledger split retired challenge_v2.json, which is what generated that file. Kept as its
// own parameter (not merged into athleteContext) since it's a genuinely separate concern with
// its own real ids Gemini needs to reference for quest_event.
export function buildDynamicText(
  athleteContext: string,
  questContext: string,
  mode: TurnMode,
  extraContext: string | undefined,
  useCache: boolean,
  timezone: string,
): string {
  const firstSessionTurn = extraContext?.includes("<first_session>") === true;
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
    "\nCurrent athlete context:\n" + athleteContext,
    "\nCurrent quests (seasons.json/quests.json/progress.json, read-only - use these exact " +
      "quest_ids for quest_event):\n" + questContext,
    "</state>",
    extraContext ? "\n" + extraContext : "",
    mode === "greeting"
      ? [
          "\nThis is a new conversation and the athlete has not said anything yet - YOU open it (A4:",
          "coach speaks first). Write a short, natural opening message the way SOUL.md's Greeting &",
          "Check-in behavior describes: 1-3 sentences, no day-count recitation, no stat dump - just a",
          "genuine, contextual opener referencing whatever's actually relevant (recent activity, an",
          "open thread from earlier, how the week is shaping up). Do not ask a form-style checklist of",
          "questions - open a conversation, don't interrogate. A greeting never closes a session",
          "by itself.",
          SESSION_STAYS_OPEN,
        ].join("\n")
      : mode === "closing" && firstSessionTurn
      ? [
          "\nThe athlete's latest message is a session-close signal, and this is also a First",
          "Session close - the turn that wraps up intake. This is your LAST CHANCE to capture",
          "anything discussed this conversation that hasn't been saved yet - do not let a fact",
          "slip through just because the athlete's closing message was short or casual.",
          "\nWrite coach_note: 3 to 5 lines, plain English, what actually happened this",
          "conversation that's worth remembering long-term. There is no file to edit, no checklist",
          "to fill in - report facts, the server handles saving them.",
          "\nGo through this checklist explicitly before you respond - for each one, ask yourself",
          "\"did the athlete tell me this anywhere in this conversation, and is it already saved?\"",
          "If discussed and not yet saved, set it now:",
          "- Name, date of birth, timezone, height, weight → profile_update (one entry per field",
          "  discussed, not just this message)",
          "- Sport(s) → sports_update, the full list, not just what's newly mentioned",
          "- How they respond to being pushed → coaching_style_update",
          "- Training frequency/fitness level, or any other durable baseline/habit context →",
          "  memory_update",
          "- Injuries or physical limitations → injury_event",
          "- Their season (name, start/end dates) → season_start, if not already set earlier this",
          "  conversation",
          "- **Their main goal AND any daily habits or routines they want to track → quest_create.**",
          "  This is the one most likely to get missed: if the athlete mentioned wanting to track",
          "  something - stretching, sleep, a morning routine, anything habit-shaped - even in a",
          "  single brief sentence, that is a real quest and belongs in quest_create's quests[]",
          "  array right now, alongside their main_quest. Do not just narrate it in your reply or",
          "  coach_note and skip the actual field - narrating it without setting quest_create is",
          "  exactly the mistake this checklist exists to prevent.",
          "\nNative onboarding details marked already recorded are context only - never repeat them",
          "in an action field. Do not set template_edit, session_plan, week_plan,",
          "session_reconcile, or plan_edit - a first-session athlete has no existing templates or",
          "week plan yet.",
          SAVE_CLAIM_GUARD,
          "\n" + SESSION_CLOSE_DECISION,
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
          "\nIf this conversation changed something in one of these six categories - fitness",
          "baseline, coaching priorities, a learned training pattern, a learned nutrition pattern,",
          "a learned mental/performance pattern, or equipment - set memory_update with that",
          "category as label and the new full text as text. Only set it when something genuinely",
          "changed; most closes won't need it. Never invent a change to justify setting it.",
          "\nIf the athlete explicitly asks to change how you coach them - more direct, easier on",
          "them, or more explanation of the why - set coaching_style_update to the closest enum",
          "value. Only set it on an explicit request to change",
          "this - never infer it from mood or a single tough session.",
          "\nIf the athlete mentioned a new injury or pain, or gave an update on an existing one",
          "listed in Active Injury Flags below, set injury_event to an array with one entry per",
          "injury being reported - if the athlete mentions TWO separate injuries changing in the",
          "same message (e.g. one resolving and a different one flaring up), that's two entries,",
          "not one. Use the schema's status enum. A brand-new injury needs text and no flag_id (the",
          "server mints one). An update to an existing flag still ongoing uses the",
          "matching flag_id from the list below, and text only if there's new detail worth",
          "recording (omit text to leave it unchanged). A cleared flag needs that flag_id. Only",
          "ever use a flag_id that's actually listed below -",
          "never invent one. Most closes won't need this either.",
          "\nIf the athlete reported completing, missing, or being excused from one or more of",
          "today's quests (see Current quests below), set quest_event to an array with one entry",
          "per quest - each entry has that quest's exact quest_id and a schema-enum status. Only",
          "use a quest_id that's actually listed below - never",
          "invent one. Include value only for a progress-type quest where the athlete gave a new",
          "cumulative number (e.g. chapters read so far) - other quest types never need value.",
          "This only logs today - don't use it to backfill an earlier day.",
          "\nIf the athlete gave a new value for one or more schema-listed profile basics, set",
          "profile_update to an array with one entry per",
          "field changed - the athlete stating both a new weight and a new timezone in the same",
          "message is two entries, not one.",
          "Only set it when the athlete actually stated a new value, never to fill in a guess.",
          "\nIf the athlete first states their sport(s), or changes them later, set sports_update",
          "to the full list of sports they do now (not just the newly mentioned one) - this is",
          "what unlocks First Session completion, so never skip it once the athlete has actually",
          "named a sport.",
          "\nFirst-session / new-athlete onboarding ONLY - a season is set once, during First",
          "Session, and never changed again through chat: if this is the athlete's very first",
          "session and you are setting up their season as part of the First Session Protocol, set",
          "season_start with a name and start_date/end_date for the season you agreed on with the",
          "athlete.",
          "\nFirst-session / new-athlete onboarding ONLY, same restriction as season_start above -",
          "a returning athlete's quests never change through this field: if this is the athlete's very",
          "first session and you are setting up their main goal and any habit quests as part of",
          "the First Session Protocol, set quest_create with main_quest from what the athlete told",
          "you and, if they described habits to track, quests. Use polarity for daily_streak",
          "habits; use target/unit for other quest types where applicable. Use the schema enums.",
          "\nIf the athlete asked to PERMANENTLY change one of their own existing workout",
          "templates (see Current templates below) going forward, not just for today - set",
          "template_edit with that template's exact template_id and a short note explaining why.",
          "template_edit is NOT for changing what a single day's already-planned session is (\"swap",
          "Friday's session for something else\") - that's plan_edit, see below. template_edit only",
          "when the athlete means the template itself, permanently, for every future session built",
          "from it.",
          "You don't know the template's exact exercise numbers, so name what to drop the way the",
          "athlete actually said it: skip_exercise_nums if you happen to know specific numbers,",
          "skip_phases with the phase's plain-language name (e.g. \"Shoulder & Elbow\") when the",
          "athlete means a whole section - either or both. You can only remove exercises this way,",
          "never invent new ones or write new exercise content - if the athlete asks to add a new",
          "exercise or swap in something that doesn't already exist in the template, tell them",
          "that's not something you can do yourself right now, don't set template_edit for it. The",
          "note must never claim a removal happened unless you actually set skip_exercise_nums or",
          "skip_phases for it - if the athlete names one specific exercise you have no way to",
          "reference (not a whole phase, not a number you know), say so honestly in your reply",
          "instead of writing a note that claims it was removed when it wasn't.",
          "Only use a template_id that's actually listed below - never invent one, and never set",
          "this if the athlete has no templates listed. Setting template_edit does not mean the",
          "session stays open - the edit is applied by the server the moment this turn commits, so",
          "it's fine to close normally in the same response if the athlete is done.",
          "\nIf you are prescribing today's session as a modified version of one of the athlete's",
          "own templates (see Current templates below) - dropping exercises for an injury or a",
          "time constraint - set session_plan with that template's exact template_id and a short",
          "note explaining why. You don't know the template's exact exercise numbers, so name what",
          "to drop the way the athlete actually said it: skip_exercise_nums if you happen to know",
          "specific numbers, skip_phases with the phase's plain-language name (e.g. \"Shoulder &",
          "Elbow\") when the athlete means a whole section - either or both, whatever matches what",
          "was actually asked. Only set this when the session is genuinely modified from the",
          "template as written - if today's session is the standard, unmodified template, do NOT",
          "set session_plan; the athlete's timer app already falls back to the base template on",
          "its own. The note must never claim a removal happened unless you actually set",
          "skip_exercise_nums or skip_phases for it - if the athlete names one specific exercise",
          "you have no way to reference, say so honestly in your reply instead of writing a note",
          "that claims it was dropped when it wasn't. Only use a template_id that's actually listed",
          "below - never invent one. This always applies to today's session only, never a future",
          "date.",
          "\nIf you are running the Weekly Kick-off Ritual (the athlete asked to plan the week, or",
          "it's Monday and there's no current live weekly plan) and are ready to commit the full",
          "week, set week_plan: focus, guardrails, headline/body (your one weekly coaching",
          "conclusion), and exactly 7 days (Monday through Sunday) each with intent and a sessions",
          "array (discipline/kind/title, and priority/planned_duration_min/template_id where you",
          "have them). Only use a template_id that's actually listed below - never invent one.",
          "Only set this when you are genuinely committing the week now, not while still asking",
          "the athlete about competitions or schedule changes for it.",
          "\nIf the athlete reported completing or skipping one or more of this week's planned",
          "sessions (see Current week's sessions below) - do this the same session it happens, not",
          "just at a weekly review - set session_reconcile to an array with one entry per session:",
          "its exact session_id, a schema-enum outcome status, and activity_ids if a",
          "real completion id exists. If what the athlete actually did is DIFFERENT from what was",
          "planned (planned a run, actually played badminton instead) - also set actual on that",
          "same entry: discipline/kind/title describing what really happened, and template_id only",
          "if that actual activity is one of the athlete's real templates. Only use a session_id",
          "that's actually listed below - never invent one.",
          "\nIf the athlete wants to change what a future (or today's) already-planned session IS,",
          "without replanning the whole week - e.g. \"swap tomorrow's badminton for football\" - set",
          "plan_edit to an array with one entry per session being changed: its exact session_id and",
          "the new discipline/kind/title (and template_id if it's one of the athlete's real",
          "templates). This does not change status - use session_reconcile separately for that. A",
          "swap like the example is normally TWO entries in the same turn: session_reconcile with",
          "actual for today's session (mark it done as what really happened), and plan_edit for",
          "tomorrow's session (change what it's planned to be). Only use a session_id that's",
          "actually listed below - never invent one. plan_edit and template_edit are NOT",
          "interchangeable: plan_edit changes what ONE day's session in this week's plan is (by",
          "session_id, from Current week's sessions below) and never touches the reusable template",
          "file itself. template_edit permanently changes the base template FILE (by template_id,",
          "from Current templates below), affecting every future session built from it, not just",
          "one day. \"Swap Friday's session\" or \"change what's planned for tomorrow\" is always",
          "plan_edit, never template_edit - template_edit is only for the athlete asking to",
          "permanently change the template going forward.",
          SAVE_CLAIM_GUARD,
          "\n" + SESSION_CLOSE_DECISION,
        ].join("\n")
      : firstSessionTurn
      ? [
          "\nThis is an ordinary First Session turn. Keep the conversation natural.",
          "Save each concrete fact on the same turn it is learned - do",
          "not hold facts for the final close. Use profile_update for name, date of birth,",
          "timezone, height, and weight; sports_update for the full sports list;",
          "coaching_style_update for accountability, encouragement, or analysis; memory_update",
          "for durable baseline or habit context; injury_event for injury facts; season_start as",
          "soon as the first season is agreed; and quest_create as soon as the main goal or habit",
          "quests are agreed. Omit a field when this turn added no fact for it. Native onboarding",
          "details marked already recorded are context only - never repeat them in an action field.",
          "Do not set template_edit, session_plan, week_plan, session_reconcile, or plan_edit on",
          "an ordinary turn; those remain close-only.",
          SESSION_STAYS_OPEN,
        ].join("\n")
      : [
          "\nThis is an ordinary turn, not a close-out - just talk with the athlete the way SOUL.md",
          "describes. Nothing about this turn gets saved anywhere; that only happens on a genuine",
          "close.",
          SESSION_STAYS_OPEN,
        ].join("\n"),
    // Deliberately last - the one piece of this prompt that changes every minute.
    "\n" + todayContextLine(timezone),
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

// Native onboarding fields passed on the first greet(). These are committed directly before
// Gemini runs; this context lets the same-request greeting use the athlete's name even though
// loadCoachContext necessarily reflects the pre-commit snapshot.
export interface OnboardingHints {
  name?: string;
  sports?: string[];
  coaching_style?: "accountability" | "encouragement" | "analysis";
}

export function onboardingHintsContext(hints: OnboardingHints | undefined): string | undefined {
  const name = hints?.name?.trim();
  const sports = (hints?.sports ?? []).filter((sport) => sport.trim().length > 0);
  const coachingStyle = hints?.coaching_style;
  if (!name && sports.length === 0 && !coachingStyle) return undefined;
  const lines = ["Native onboarding details already recorded for this athlete:"];
  if (name) lines.push(`- Name: ${name}`);
  if (sports.length > 0) lines.push(`- Sport(s): ${sports.join(", ")}`);
  if (coachingStyle) lines.push(`- Coaching style: ${coachingStyle}`);
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
    "This athlete's Athlete Profile section is empty - they have never been onboarded. This is",
    "their first session. Run the protocol below instead of coaching normally. Steps that would",
    "need a shell or a git commit have been removed; do the conversational work and report the",
    "profile/challenge_v2.json content, and the backend handles saving.",
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

// Step 4b: lists the athlete's current injuries.json flags (id + status + text) so Gemini has
// real flag_ids to reference for injury_event's update/resolve cases - it must never invent one.
// Per-athlete, so this rides in buildDynamicText's extraContext, never staticSystemText - same
// reasoning as firstSessionContext/rollingStateContext above.
export function injuryFlagsContext(injuries: InjuriesJson | null | undefined): string | undefined {
  if (!injuries || !Array.isArray(injuries.flags) || injuries.flags.length === 0) return undefined;
  const lines = injuries.flags.map((f) => `- flag_id: ${f.id} | status: ${f.status} | ${f.text}`);
  return ["Active Injury Flags (use these exact flag_ids for injury_event updates/resolves):", ...lines].join("\n");
}

// Part 2 ledger split, step 3a: lists the athlete's current active quests (id + type + status) so
// Gemini has real quest_ids to reference for quest_event - it must never invent one. Same
// reasoning/placement as injuryFlagsContext above - per-athlete, so extraContext not
// staticSystemText.
export function activeQuestsContext(quests: QuestsJson | null | undefined): string | undefined {
  const active = (quests?.quests ?? []).filter((q) => q.status === "active");
  const main = quests?.main_quest;
  if (!main && active.length === 0) return undefined;
  const lines: string[] = [];
  if (main) lines.push(`- quest_id: ${main.id} | type: ${main.type} | main quest`);
  for (const q of active) lines.push(`- quest_id: ${q.id} | type: ${q.type} | status: ${q.status}`);
  return ["Current quests (use these exact quest_ids for quest_event):", ...lines].join("\n");
}

// coach-redesign workout-backend-wiring §3: lists the athlete's real, already-committed template
// ids (from the manifest coachWorkoutFiles.ts writes alongside generated templates) so Gemini has
// real template_ids to reference for template_edit - it must never invent one. Same
// reasoning/placement as activeQuestsContext/injuryFlagsContext above - per-athlete, so
// extraContext not staticSystemText. Omitted entirely (undefined) when there are no valid ids -
// e.g. the manifest doesn't exist yet for this athlete - so the prompt doesn't dangle an empty
// section, matching injuryFlagsContext's own empty-case handling.
export function activeTemplatesContext(templateIds: ReadonlySet<string>): string | undefined {
  if (templateIds.size === 0) return undefined;
  const lines = [...templateIds].map((id) => `- template_id: ${id}`);
  return ["Current templates (use these exact template_ids for template_edit):", ...lines].join("\n");
}

// coach-redesign workout-backend-wiring §5: lists the current week's real, already-committed
// session ids (from the current_week.json read at the top of the turn) so Gemini has real
// session_ids to reference for session_reconcile - it must never invent one. Same
// reasoning/placement as activeTemplatesContext above. Omitted entirely when there's no current
// live week yet, matching the other context helpers' empty-case handling.
export function activeWeekSessionsContext(
  sessions: readonly { id: string; date: string; title: string; status: string }[],
): string | undefined {
  if (sessions.length === 0) return undefined;
  const lines = sessions.map((s) => `- session_id: ${s.id} | date: ${s.date} | ${s.title} | status: ${s.status}`);
  return [
    "Current week's sessions (use these exact session_ids for session_reconcile AND plan_edit -",
    "match the date to what the athlete actually means, never guess):",
    ...lines,
  ].join("\n");
}
