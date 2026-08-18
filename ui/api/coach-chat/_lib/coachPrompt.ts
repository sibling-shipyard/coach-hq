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
import type { WeekPlan, SessionReconcileEvent } from "./coachWeekFiles.js";

export interface GeminiReply {
  reply: string;
  // Closing turns only - a short plain-English note appended (with today's date) as a new row in
  // coach_log.json at commit time (coachIntents.ts's applyCoachNote). Never shown to the athlete.
  // coach_log.json is the single merged continuity log - it absorbs what used to be split across
  // coach_notes.md and rolling_state.json.
  coach_note?: string;
  // Part 1 redesign, Step 4a: Coach states which one of memory.json's six labelled notes boxes
  // changed and its new text - the server owns replacing that box entirely (coachIntents.ts's
  // applyMemoryUpdate). `label` is a constrained enum, never free text - gemini-flow.md's
  // Action-field design rule. Closing turns only, same as coach_note.
  memory_update?: { label: MemoryNoteLabel; text: string };
  // Step 4b: an injury flag opened, updated, or resolved this conversation. Server generates
  // `id`/`opened_at`/`resolved_at` - Gemini only ever supplies status/text/flag_id (see
  // coachIntents.ts's applyInjuryEvent for the exact new/update/resolve rules). Closing turns
  // only, same as coach_note/memory_update.
  injury_event?: { status: "active" | "resolved"; text?: string; flag_id?: string };
  // Part 2 ledger split: the athlete logged a completion/miss/excuse on one or more existing
  // quests this conversation. Server stamps date/id/ts/trace_id/season_id and upserts the row for
  // each quest+date in progress.json (coachIntents.ts's applyQuestEvent) - Gemini only ever
  // supplies quest_id/status/value per event. No `date` field - same rule as coach_note/
  // injury_event, the server already knows today's date. `value` is optional and only meaningful
  // for progress-type quests. Closing turns only, same as the fields above.
  //
  // Issue #410: was a single object - a turn reporting two separate quest completions could only
  // capture one. Now an array so every reported completion lands as its own row.
  // value is string-only, not string | number - the responseSchema below declares it as
  // `{ type: "string" }`, so Gemini's structured output can never actually produce a number here
  // regardless of what a wider TS type might promise. Found in review.
  quest_event?: { quest_id: string; status: "completed" | "missed" | "excused"; value?: string }[];
  // Part 2 ledger split: one field in profile.json changed this conversation (e.g. weight_kg
  // after the athlete reports a new number). Server sets that one field, nothing else - Gemini
  // only ever supplies field/value. Closing turns only, same as the fields above.
  // value is string-only, same reasoning as quest_event above - the responseSchema below
  // declares it as `{ type: "string" }`. Found in review as the same bug class left uncorrected.
  profile_update?: { field: "name" | "dob" | "timezone" | "height_cm" | "weight_kg"; value: string };
  // coach-redesign workout-backend-wiring §3: the athlete asked to change one of their own
  // existing workout templates (e.g. "add more exercises to strength B"). Gemini only captures
  // the athlete's own words/intent here - it does not invent or perform the edit itself. A
  // second, separate, small Gemini call (coachWorkoutFiles.ts's applyTemplateEdit) does the
  // actual editing at commit time, scoped to just that template's JSON + this instruction.
  // template_id must be one of the ids listed in context (activeTemplatesContext) - never
  // invented. Single object, not an array - one edit request per closing turn is enough for a
  // first pass, matching profile_update's shape rather than quest_event's. Closing turns only,
  // same as the fields above.
  template_edit?: { template_id: string; instruction: string };
  // coach-redesign workout-backend-wiring §4: Coach is prescribing a modified version of one of
  // the athlete's templates for a specific day (injury/periodization adjustment), per
  // B_engine.md's Persisting Session Files ritual. No `session_date` field here - per
  // gemini-flow.md's Action-field design rule #1 ("server computes all bookkeeping - dates, ids,
  // timestamps"), the server stamps session_date itself (coach-chat.ts, todayDateString), same as
  // coach_note/quest_event/injury_event never carry a Gemini-supplied date. Judgment call: this
  // means session_plan can only ever apply to *today's* session, not a future date. B_engine.md's
  // trigger text ("whenever you prescribe a workout modified for injury or periodization") reads
  // as an in-the-moment same-day prescription in every example in that section, not "plan
  // Thursday's session now" - and the existing hand-written ritual only ever runs at the point the
  // athlete is about to do the session, not ahead of time. If a genuine need for future-dated
  // session planning shows up, that's a deliberate schema change later (add an explicit
  // Gemini-supplied session_date with its own validation), not a workaround here.
  // template_id must be one of the ids listed in context (activeTemplatesContext, same set
  // template_edit uses) - never invented. skip_exercise_nums is the only supported modification
  // this pass (free-form new-exercise insertion is a known gap, not built yet). Single object, not
  // an array - one session prescription per closing turn, matching template_edit/profile_update's
  // shape. Closing turns only, same as the fields above.
  session_plan?: { template_id: string; skip_exercise_nums?: number[]; note?: string };
  // coach-redesign workout-backend-wiring §5: the Weekly Kick-off Ritual (B_engine.md) - Coach is
  // writing the full Monday-to-Sunday plan. Single object, full rewrite of current_week.json's
  // days/sessions/week, not an incremental patch - matches how the ritual actually works (the
  // whole week is authored in one pass). headline/body are the coach_read content, kept in this
  // same small schema rather than a second Gemini call (coachWeekFiles.ts's applyWeekPlan owns
  // that reasoning). Server computes every id/date/status field - see applyWeekPlan's own
  // judgment-call comments for data_status/template_id handling. Closing turns only.
  week_plan?: WeekPlan;
  // coach-redesign workout-backend-wiring §5: B_engine.md's s10_logging_reconcile - reconciling a
  // completed/skipped/cancelled session against current_week.json "now, not at the Sunday
  // review". Array, mirrors quest_event's upsert-by-id shape - a turn can report more than one
  // session's outcome. session_id must be one of the ids already in current_week.json (server
  // re-validates at commit time, coachWeekFiles.ts's applySessionReconcile) - never invented.
  // Closing turns only, same as the fields above.
  session_reconcile?: SessionReconcileEvent[];
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
      // Commitment fields declared before reply (gemini-flow.md's Action-field design rule #4) -
      // there's nothing else to commit to first.
      coach_note: { type: "string" },
      memory_update: {
        type: "object",
        properties: {
          label: { type: "string", enum: [...MEMORY_NOTE_LABELS] },
          text: { type: "string" },
        },
      },
      injury_event: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "resolved"] },
          text: { type: "string" },
          flag_id: { type: "string" },
        },
      },
      // Part 2 ledger split, step 3a - shipped and tested in isolation before profile_update
      // (gemini-flow.md's Action-field design rule #2). No `date` - server stamps it. Array
      // (issue #410) so a turn reporting several quest completions at once captures all of them.
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
      profile_update: {
        type: "object",
        properties: {
          field: { type: "string", enum: ["name", "dob", "timezone", "height_cm", "weight_kg"] },
          value: { type: "string" },
        },
      },
      // coach-redesign workout-backend-wiring §3 - single object (not array), matching
      // profile_update's shape. template_id is free text in the schema itself (Gemini's real ids
      // come from context, per activeTemplatesContext below); coachWorkoutFiles.ts's
      // applyTemplateEdit is the actual enforcement point.
      template_edit: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          instruction: { type: "string" },
        },
      },
      // coach-redesign workout-backend-wiring §4 - single object, matching template_edit's shape.
      // No session_date property here - server-stamped, see GeminiReply's own comment above for
      // why. skip_exercise_nums is the only supported modification this pass.
      session_plan: {
        type: "object",
        properties: {
          template_id: { type: "string" },
          skip_exercise_nums: { type: "array", items: { type: "number" } },
          note: { type: "string" },
        },
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
      // never invented.
      session_reconcile: {
        type: "array",
        items: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            status: { type: "string", enum: ["done", "skipped", "cancelled"] },
            activity_ids: { type: "array", items: { type: "string" } },
          },
          required: ["session_id", "status"],
        },
      },
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
    "have is already given to you below (current athlete context and quest_log.md) or in this",
    "conversation. If SOUL.md instructs you to read a file or run a command you don't have access",
    "to here, ignore that instruction rather than acting like you did it.",
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
// questContext is now built server-side from seasons.json/quests.json/progress.json
// (coachContext.ts's renderQuestContext) rather than being gen/quest_log.md's raw markdown -
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
          "\nIf this conversation changed something in one of these six categories - fitness",
          "baseline, coaching priorities, a learned training pattern, a learned nutrition pattern,",
          "a learned mental/performance pattern, or equipment - set memory_update with that",
          "category as label and the new full text as text. Only set it when something genuinely",
          "changed; most closes won't need it. Never invent a change to justify setting it.",
          "\nIf the athlete mentioned a new injury or pain, or gave an update on an existing one",
          "listed in Active Injury Flags below, set injury_event. A brand-new injury: status",
          "\"active\", text describing it, no flag_id (the server mints one). An update to an",
          "existing flag still ongoing: status \"active\", the matching flag_id from the list below,",
          "and text only if there's new detail worth recording (omit text to leave it unchanged).",
          "A flag that's cleared up: status \"resolved\" and that flag_id. Only ever use a flag_id",
          "that's actually listed below - never invent one. Most closes won't need this either.",
          "\nIf the athlete reported completing, missing, or being excused from one or more of",
          "today's quests (see Current quests below), set quest_event to an array with one entry",
          "per quest - each entry has that quest's exact quest_id and status \"completed\",",
          "\"missed\", or \"excused\". Only use a quest_id that's actually listed below - never",
          "invent one. Include value only for a progress-type quest where the athlete gave a new",
          "cumulative number (e.g. chapters read so far) - other quest types never need value.",
          "This only logs today - don't use it to backfill an earlier day.",
          "\nIf the athlete gave a new value for one of their profile basics (name, date of birth,",
          "timezone, height, or weight), set profile_update with that field and the new value.",
          "Only set it when the athlete actually stated a new value, never to fill in a guess.",
          "\nIf the athlete clearly asked to change one of their own existing workout templates",
          "(see Current templates below) - e.g. \"add more exercises to strength B\" or \"swap out",
          "the burpees in foundation\" - set template_edit with that template's exact template_id",
          "and an instruction capturing the athlete's own words/intent. Do not invent or perform",
          "the edit yourself - instruction should describe what the athlete asked for, not the",
          "result. Only use a template_id that's actually listed below - never invent one, and",
          "never set this if the athlete has no templates listed. Setting template_edit does not",
          "mean the session stays open - the edit is applied by the server the moment this turn",
          "commits, so it's fine to close normally in the same response if the athlete is done.",
          "\nIf you are prescribing today's session as a modified version of one of the athlete's",
          "own templates (see Current templates below) - dropping exercises for an injury or a",
          "time constraint - set session_plan with that template's exact template_id, an array",
          "skip_exercise_nums of the exercise numbers to drop, and a short note explaining why.",
          "Only set this when the session is genuinely modified from the template as written - if",
          "today's session is the standard, unmodified template, do NOT set session_plan; the",
          "athlete's timer app already falls back to the base template on its own. Only use a",
          "template_id that's actually listed below - never invent one. This always applies to",
          "today's session only, never a future date.",
          "\nIf you are running the Weekly Kick-off Ritual (the athlete asked to plan the week, or",
          "it's Monday and there's no current live weekly plan) and are ready to commit the full",
          "week, set week_plan: focus, guardrails, headline/body (your one weekly coaching",
          "conclusion), and exactly 7 days (Monday through Sunday) each with intent and a sessions",
          "array (discipline/kind/title, and priority/planned_duration_min/template_id where you",
          "have them). Only use a template_id that's actually listed below - never invent one.",
          "Only set this when you are genuinely committing the week now, not while still asking",
          "the athlete about competitions or schedule changes for it.",
          "\nIf the athlete reported completing, skipping, or cancelling one or more of this week's",
          "planned sessions (see Current week's sessions below) - do this the same session it",
          "happens, not just at a weekly review - set session_reconcile to an array with one entry",
          "per session: its exact session_id, the outcome status, and activity_ids if a real",
          "completion id exists. Only use a session_id that's actually listed below - never invent",
          "one.",
          "**Never say something is saved, logged, locked, or committed unless coach_note (or",
          "memory_update / injury_event / quest_event / profile_update / template_edit /",
          "session_plan / week_plan / session_reconcile) in this exact response genuinely reflects",
          "it.**",
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
  return ["Current week's sessions (use these exact session_ids for session_reconcile):", ...lines].join("\n");
}
