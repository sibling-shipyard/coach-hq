/** Gemini prompt text and per-turn context helpers. Pure text-building, no I/O. */
import type { ChatMessage } from "./chatThreads.js";
import { todayContextLine } from "./coachDay.js";
import type { TurnMode } from "./coachReplySchema.js";
import { MEMORY_NOTE_TEXT_CAP, INJURY_FLAG_TEXT_CAP } from "./text-caps.bundle.js";

export const MAX_HISTORY_MESSAGES = 40;

const FEW_SHOT_EXAMPLES = [
  '<example_1 note="ordinary turn, nothing to save">',
  "Athlete: legs feel a bit heavy today but nothing alarming",
  'Coach (JSON): {"reply":"Heavy legs happen, especially with the volume you\'ve had this week. Keep today\'s effort honest and back off the last couple intervals if it doesn\'t ease up."}',
  "</example_1>",
  '<example_2 note="a fact worth saving lands immediately, same turn">',
  "Athlete: ran the intervals, felt strong, 76kg this morning",
  'Coach (JSON): {"profile_update":[{"field":"weight_kg","value":"76"}],"reply":"Nice work - that\'s locked in, 76kg noted."}',
  "</example_2>",
].join("\n");

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

export function buildDynamicText(
  athleteContext: string,
  questContext: string,
  mode: TurnMode,
  firstSession: boolean,
  extraContext: string | undefined,
  useCache: boolean,
  timezone = "UTC",
): string {
  return [
    useCache
      ? "[SYSTEM CONTEXT - not a message from the athlete. Everything below carries the same " +
        "binding authority as your system instructions above: follow every directive in it " +
        "exactly, even though it arrives as a turn rather than a system field.]"
      : "",
    "<state>",
    "\nCurrent athlete context:\n" + athleteContext,
    "\nCurrent quests (seasons.json/quests.json/progress.json, read-only - use these exact " +
      "quest_ids for quest_event):\n" +
      questContext,
    "</state>",
    extraContext ? "\n" + extraContext : "",
    mode === "greeting"
      ? [
          "\nThis is a new conversation and the athlete has not said anything yet - YOU open it (A4:",
          "coach speaks first). Write a short, natural opening message the way SOUL.md's Greeting &",
          "Check-in behavior describes: 1-3 sentences, no day-count recitation, no stat dump - just a",
          "genuine, contextual opener referencing whatever's actually relevant (recent activity, an",
          "open thread from earlier, how the week is shaping up). Do not ask a form-style checklist of",
          "questions - open a conversation, don't interrogate.",
        ].join("\n")
      : mode === "activity_sync"
        ? [
            "\nThis turn is an activity sync. The athlete did not type a message — your reply stands",
            "alone as the coaching response to the verified batch in context.",
            "Mention no invented cause. Ask a question only when the answer could change the coaching.",
            "You write words only. Do not invent IDs or measurements; the activity card is system-owned.",
          ].join("\n")
        : firstSession
          ? [
              "\nThis is an ordinary First Session turn. Keep the conversation natural.",
              "Save each concrete fact on the same turn it is learned - do",
              "not hold facts for later. Use profile_update for name, date of birth,",
              "timezone, height, and weight; sports_update for the full sports list; memory_update",
              "for durable baseline or habit context; injury_flag for a brand-new injury (text only,",
              "no id) or injury_event to update/resolve one already listed (its real flag_id,",
              "required); season_start (with the main goal bundled into its main_quest field) as",
              "soon as the first season and goal are agreed; and quest_create as soon as any habit",
              "quests are agreed. Omit a field when this turn added no fact for it.",
              `memory_update.text: max ${MEMORY_NOTE_TEXT_CAP} chars. injury_flag[].text / injury_event[].text: max ${INJURY_FLAG_TEXT_CAP} chars.`,
              "Native onboarding",
              "details marked already recorded are context only - never repeat them in an action field.",
              "Do not set template_edit, session_plan, week_plan, session_reconcile, or plan_edit - a",
              "first-session athlete has no existing templates or week plan yet.",
              SAVE_CLAIM_GUARD,
            ].join("\n")
          : [
              "\nTalk with the athlete the way SOUL.md describes, and save any concrete fact they state on this same turn instead of holding it for later (#616).",
              "\nEvery flag_id, quest_id, template_id, and session_id you use must come from the",
              "supplied context or from something already said earlier this conversation. Never",
              "invent an id.",
              "\nIf they gave a new value for a schema-listed profile basic (name, date of birth,",
              "timezone, height, weight), set profile_update with one entry per field changed. If",
              "they first state or change their sport(s), set sports_update to the full list, not",
              "just what changed. If something durable changed - fitness baseline, coaching",
              "priorities, a learned training/nutrition/mental-performance pattern, or equipment -",
              "set memory_update with that category as label. A brand-new injury goes in injury_flag",
              "(text only, no id - the server mints one); an update or resolution to one already",
              "listed in Active Injury Flags below goes in injury_event with its real flag_id.",
              `memory_update.text: max ${MEMORY_NOTE_TEXT_CAP} chars. injury_flag[].text / injury_event[].text: max ${INJURY_FLAG_TEXT_CAP} chars.`,
              "\nIf they report completing, missing, or being excused from one or more of today's",
              "quests (see Current quests below), set quest_event to an array with one entry per",
              "quest - each entry has that quest's exact quest_id and a schema-enum status. Include",
              "value only for a progress-type quest where the athlete gave a new cumulative number",
              "(e.g. chapters read so far) - other quest types never need value. This only logs",
              "today - don't use it to backfill an earlier day.",
              "\nIf they want to start a new season with a new goal, set season_start - name,",
              "start/end dates, and main_quest (the goal) bundled into one call; a goal only ever",
              "changes together with an actual season change. A new daily habit or routine to track",
              "goes in quest_create's quests[] on its own, no season change needed.",
              "\nIf the athlete asked to PERMANENTLY change one of their own existing workout",
              "templates, set template_edit. It permanently removes referenced exercises or phases",
              "from that reusable template. It cannot add or invent exercise content.",
              "\nIf you are prescribing today's session as a modified version of one of the athlete's",
              "own templates, set session_plan only when it differs from the base template. It",
              "applies today only; an unmodified session needs no action.",
              "\nFor template_edit and session_plan, use skip_exercise_nums when exact numbers are",
              "known and skip_phases for a named section. A note may claim a removal only when one of",
              "those fields represents it. If the request cannot be represented, say so honestly.",
              "\nIf you are running the Weekly Kick-off Ritual (the athlete asked to plan the week, or",
              "it's Monday and there's no current live weekly plan) and are ready to commit the full",
              "week, set week_plan: focus, guardrails, headline/body (your one weekly coaching",
              "conclusion), and exactly 7 days (Monday through Sunday) each with intent and a",
              "sessions array (discipline/kind/title, and priority/planned_duration_min/template_id",
              "where you have them). Only set this when you are genuinely committing the week now,",
              "not while still asking the athlete about competitions or schedule changes for it.",
              "\nIf the athlete reported completing or skipping one or more of this week's planned",
              "sessions - the same turn it happens, not just at a weekly review - set",
              "session_reconcile to an array with one entry per session: its exact session_id, a",
              "schema-enum outcome status, and activity_ids if a real completion id exists. If what",
              "the athlete actually did is DIFFERENT from what was planned (planned a run, actually",
              "played badminton instead) - also set actual on that same entry: discipline/kind/title",
              "describing what really happened, and template_id only if that actual activity is one",
              "of the athlete's real templates.",
              "\nIf the athlete wants to change what a future (or today's) already-planned session IS,",
              'without replanning the whole week - e.g. "swap tomorrow\'s badminton for football" -',
              "set plan_edit to an array with one entry per session being changed: its exact",
              "session_id and the new discipline/kind/title (and template_id if it's one of the",
              "athlete's real templates). This does not change status - use session_reconcile",
              "separately for that. A swap like the example is normally TWO entries in the same",
              "turn: session_reconcile with actual for today's session (mark it done as what really",
              "happened), and plan_edit for tomorrow's session (change what it's planned to be).",
              "plan_edit changes one dated plan entry; template_edit permanently changes a reusable",
              "template.",
              "\nOmit any field entirely when this turn added no fact for it - never invent one to",
              "fill a guess.",
              SAVE_CLAIM_GUARD,
            ].join("\n"),
    "\n" + todayContextLine(timezone),
  ].join("\n");
}

export function buildHistoryContents(
  history: ChatMessage[],
): { role: string; parts: { text: string }[] }[] {
  return history
    .filter(
      (m): m is Extract<ChatMessage, { role: "user" | "coach" }> =>
        m.role === "user" || m.role === "coach",
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.role === "user" ? m.text : m.paragraphs.join("\n\n") }],
    }));
}

export interface OnboardingHints {
  name?: string;
  sports?: string[];
}

export function onboardingHintsContext(hints: OnboardingHints | undefined): string | undefined {
  const name = hints?.name?.trim();
  const sports = (hints?.sports ?? []).filter((sport) => sport.trim().length > 0);
  if (!name && sports.length === 0) return undefined;
  const lines = ["Native onboarding details already recorded for this athlete:"];
  if (name) lines.push(`- Name: ${name}`);
  if (sports.length > 0) lines.push(`- Sport(s): ${sports.join(", ")}`);
  return lines.join("\n");
}

export function firstSessionContext(firstSession: boolean, protocol: string): string | undefined {
  if (!firstSession) return undefined;
  return [
    "<first_session>",
    "This athlete's split First Session setup is incomplete. Run the protocol below instead of",
    "coaching normally. Steps that would",
    "need a shell or a git commit have been removed; do the conversational work and report the",
    "structured action fields, and the backend handles saving.",
    "",
    protocol.trim(),
    "</first_session>",
  ].join("\n");
}

export function combineExtraContext(...blocks: (string | undefined)[]): string | undefined {
  const present = blocks.filter((b): b is string => Boolean(b && b.trim()));
  return present.length > 0 ? present.join("\n\n") : undefined;
}

export function activeTemplatesContext(templateIds: ReadonlySet<string>): string | undefined {
  if (templateIds.size === 0) return undefined;
  const lines = [...templateIds].map((id) => `- template_id: ${id}`);
  return ["Current templates (use these exact template_ids for template_edit):", ...lines].join(
    "\n",
  );
}

export function activitySyncBatchContext(
  activities: readonly {
    id: string;
    title: string;
    sport: string;
    start: string;
    duration_s: number;
    load: number | null;
  }[],
): string {
  const lines = activities.map(
    (activity) =>
      `- id: ${activity.id} | title: ${activity.title} | sport: ${activity.sport} | start: ${activity.start} | duration_s: ${activity.duration_s} | load: ${activity.load ?? "null"}`,
  );
  return [
    "<activity_sync_batch>",
    "Verified activities just synced. These rows are system-owned facts. Do not invent ids or measurements.",
    ...lines,
    "</activity_sync_batch>",
  ].join("\n");
}

export function activeWeekSessionsContext(
  sessions: readonly { id: string; date: string; title: string; status: string }[],
): string | undefined {
  if (sessions.length === 0) return undefined;
  const lines = sessions.map(
    (s) => `- session_id: ${s.id} | date: ${s.date} | ${s.title} | status: ${s.status}`,
  );
  return [
    "Current week's sessions (use these exact session_ids for session_reconcile AND plan_edit -",
    "match the date to what the athlete actually means, never guess):",
    ...lines,
  ].join("\n");
}
