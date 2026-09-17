/** Pure server-owned appliers for season and quest actions reported by Gemini. */

import {
  type ProgressRow,
  type Season,
  type SeasonsJson,
  type MainQuest,
  type Quest,
  type QuestType,
  type QuestsJson,
} from "./coachQuestFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
import { slugify } from "../../../_lib/slugify.js";

// quest_event { quest_id, status, value? }[]: Part 2 ledger split. Server owns date/id/ts/
// trace_id/season_id entirely (gemini-flow.md's Action-field design rule #1) - Gemini only ever
// supplies quest_id/status/value. Upserts on (quest_id, date) - reporting the same tick twice for
// today is a no-op by construction, same repeat-safety story as coach-redesign-part2-ledger.md
// describes. `value` only matters for progress-type quests (e.g. "12/20 chapters") - other quest
// types only ever report status.
//
// Issue #410: was a single event, capping a turn to one quest completion even when the athlete
// reported several at once. Now an array - each event applies the same upsert logic in sequence,
// so two events for the same quest_id+date within one call still upsert onto each other in order
// (last one wins), same as two separate calls would.
export interface QuestEvent {
  quest_id: string;
  status: "completed" | "missed" | "excused";
  // string-only - the Gemini responseSchema (coachReplySchema.ts) declares value as
  // `{ type: "string" }`, so `number` here was dead, unreachable type surface. Found in review.
  value?: string;
}

const QUEST_EVENT_STATUSES: readonly QuestEvent["status"][] = ["completed", "missed", "excused"];

export function applyQuestEvent(
  content: string | null,
  events: QuestEvent[],
  today: string,
  currentSeasonId: string,
  traceId: string,
  now: Date,
  validQuestIds: ReadonlySet<string>,
): string {
  const parsed = parseJsonOrNull<{ rows?: ProgressRow[] }>(content);
  let rows: ProgressRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];

  for (const event of events) {
    // Same discipline as applyInjuryEvent's flag_id guard - a hallucinated or stale quest_id
    // (quests.json changed underneath Gemini's context since it was built) must not write a
    // permanent bogus row with no rejection path. Found in review: applyProfileUpdate already
    // guards its field enum, this had no equivalent guard at all.
    if (!validQuestIds.has(event.quest_id)) {
      throw new Error(`quest_event: no quest with id "${event.quest_id}" in quests.json`);
    }
    // Applier-level double-check for the same enum -
    // coachReplySchema.ts's quest_event.status already constrains on the Gemini path - defense
    // in depth, same reasoning as applyProfileUpdate's PROFILE_UPDATE_FIELDS guard in
    // coachProfileIntents.ts.
    if (!QUEST_EVENT_STATUSES.includes(event.status)) {
      throw new Error(`quest_event: "${event.status}" is not a valid status`);
    }
    const existingIndex = rows.findIndex((r) => r.quest_id === event.quest_id && r.date === today);
    const row: ProgressRow = {
      id: existingIndex >= 0 ? rows[existingIndex].id : `pr_${event.quest_id}_${today}`,
      quest_id: event.quest_id,
      season_id: currentSeasonId,
      date: today,
      status: event.status,
      value: event.value ?? null,
      source: "model",
      ts: now.toISOString(),
      trace_id: traceId,
    };
    rows =
      existingIndex >= 0 ? rows.map((r, i) => (i === existingIndex ? row : r)) : [...rows, row];
  }

  return JSON.stringify({ version: 1, rows }, null, 2);
}

// Common id-minting shape reused by applySeasonStart/applyQuestCreate below - a slug of the name
// plus a short random suffix, same "slug + random tail" convention applyInjuryEvent (in
// coachInjuryIntents.ts) already uses for flag ids (there via today's date instead of a slug
// prefix, but the same idea: a short, readable, collision-resistant id minted server-side, never
// left to Gemini).
function mintId(prefix: string, name: string): string {
  const slug = slugify(name, "_", 24);
  return `${prefix}_${slug || "x"}_${Math.random().toString(36).slice(2, 6)}`;
}

// Shared by applyQuestCreate and applySeasonStart's new_habits (#808) - both append habit quests
// with identical server-owned bookkeeping (minted id, active status, today's start_date, no end
// date, source "model"). One mapping so the two entry points can never silently diverge.
function buildNewQuests(
  quests: {
    name: string;
    type: QuestType;
    polarity?: "default_done" | "default_not_done";
    target?: number;
    unit?: string;
  }[],
  today: string,
): Quest[] {
  return quests.map((q) => ({
    id: mintId("q", q.name),
    name: q.name.trim(),
    type: q.type,
    start_date: today,
    end_date: null,
    status: "active",
    ...(q.polarity ? { polarity: q.polarity } : {}),
    ...(q.target != null ? { target: q.target } : {}),
    ...(q.unit ? { unit: q.unit } : {}),
    source: "model",
  }));
}

export interface SeasonStartResult {
  seasonsContent: string;
  questsContent: string;
}

// season_start { name, start_date, end_date, main_quest }: available to every athlete now, not
// just First Session (B3) - resolves the outgoing season (if any) and moves its goal aside in
// the same call, so a returning athlete can never leave a dangling "active" season behind.
// Server mints the new season id and sets it current; the new season is prepended (newest-first,
// per coachQuestFiles.ts's own doc comment on SeasonsJson.seasons) with status "active". No
// `phase` field - Season doesn't have one, not inventing schema here.
//
// A prior current season that's still "active" resolves now: started early (before its own
// end_date) becomes "retired", started after its end_date becomes "completed" - both already-
// declared Season.status values, no new enum added. Its own main_quest (matched by season_id,
// never just "whatever's on file" - an unrelated main_quest is never swept up) moves into
// quests[] too, marked "retired" - same "move it, don't destroy it" discipline habit quests
// already get. The new season's main_quest is set straight from this same call's payload -
// never null-and-wait, since one action creates the season and its goal together. new_habits
// (#808) appends through the same buildNewQuests helper applyQuestCreate uses - a habit stated
// alongside a new goal in the same message lands here, required so Gemini can't skip it the way
// it was skipping the separate quest_create field.
export function applySeasonStart(
  seasonsContent: string | null,
  questsContent: string | null,
  input: {
    name: string;
    start_date: string;
    end_date: string;
    main_quest: { name: string; type: QuestType; target: number; count_pattern?: string };
    new_habits: {
      name: string;
      type: QuestType;
      polarity?: "default_done" | "default_not_done";
      target?: number;
      unit?: string;
    }[];
  },
  today: string,
  traceId: string,
  now: Date,
): SeasonStartResult {
  const parsedSeasons = parseJsonOrNull<Partial<SeasonsJson>>(seasonsContent) ?? {};
  const seasons: Season[] = Array.isArray(parsedSeasons.seasons) ? parsedSeasons.seasons : [];

  const prevSeason = seasons.find((s) => s.id === parsedSeasons.current_season_id);
  let outgoingSeason: Season | null = null;
  if (prevSeason && prevSeason.status === "active") {
    prevSeason.status = today < prevSeason.end_date ? "retired" : "completed";
    outgoingSeason = prevSeason;
  }

  const newSeasonId = mintId("season", input.name);
  const season: Season = {
    id: newSeasonId,
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    status: "active",
  };

  const seasonsResult: SeasonsJson = {
    version: 1,
    _meta: { updated_at: now.toISOString(), updated_by: "model", trace_id: traceId },
    current_season_id: newSeasonId,
    seasons: [season, ...seasons],
  };

  const parsedQuests = parseJsonOrNull<Partial<QuestsJson>>(questsContent) ?? {};
  let quests: Quest[] = Array.isArray(parsedQuests.quests) ? parsedQuests.quests : [];

  const outgoingMainQuest = parsedQuests.main_quest;
  if (outgoingSeason && outgoingMainQuest && outgoingMainQuest.season_id === outgoingSeason.id) {
    quests = [
      ...quests,
      {
        id: outgoingMainQuest.id,
        name: outgoingMainQuest.name,
        type: outgoingMainQuest.type,
        start_date: outgoingSeason.start_date,
        end_date: today,
        status: "retired",
        target: outgoingMainQuest.target,
        ...(outgoingMainQuest.count_pattern
          ? { count_pattern: outgoingMainQuest.count_pattern }
          : {}),
        source: "model",
      },
    ];
  }

  const mainQuest: MainQuest = {
    id: mintId("mq", input.main_quest.name),
    name: input.main_quest.name.trim(),
    type: input.main_quest.type,
    target: input.main_quest.target,
    season_id: newSeasonId,
    ...(input.main_quest.count_pattern ? { count_pattern: input.main_quest.count_pattern } : {}),
  };

  // new_habits is required in the schema, but Gemini demonstrably drops fields it's told are
  // required (the whole reason #808 exists) - trust the type, not the runtime value.
  const newHabits = buildNewQuests(input.new_habits ?? [], today);

  const questsResult: QuestsJson = {
    version: 1,
    _meta: { updated_at: now.toISOString(), updated_by: "model", trace_id: traceId },
    weekly_targets: parsedQuests.weekly_targets ?? {},
    main_quest: mainQuest,
    quests: [...quests, ...newHabits],
  };

  return {
    seasonsContent: JSON.stringify(seasonsResult, null, 2),
    questsContent: JSON.stringify(questsResult, null, 2),
  };
}

// quest_create { quests? }: habit quests only - a goal can only ever change together with a
// season change (via applySeasonStart), so this function never touches main_quest; whatever is
// already on file passes through untouched. Server mints every id; FSP-created quests are source
// "model" (Coach is structuring them from the conversation, not the athlete typing them directly
// into quests.json themselves) - the design doc's own resolved question on this. New quests are
// appended to quests[], status "active", start_date today, end_date null - same "server owns
// bookkeeping" discipline as every other applier in this file.
export function applyQuestCreate(
  content: string | null,
  input: {
    quests?: {
      name: string;
      type: QuestType;
      polarity?: "default_done" | "default_not_done";
      target?: number;
      unit?: string;
    }[];
  },
  today: string,
  traceId: string,
  now: Date,
): string {
  const parsed = parseJsonOrNull<Partial<QuestsJson>>(content) ?? {};
  const existingQuests: Quest[] = Array.isArray(parsed.quests) ? parsed.quests : [];
  const mainQuest: MainQuest | null = parsed.main_quest ?? null;

  const newQuests: Quest[] = buildNewQuests(input.quests ?? [], today);

  const result: QuestsJson = {
    version: 1,
    _meta: { updated_at: now.toISOString(), updated_by: "model", trace_id: traceId },
    weekly_targets: parsed.weekly_targets ?? {},
    main_quest: mainQuest,
    quests: [...existingQuests, ...newQuests],
  };

  return JSON.stringify(result, null, 2);
}
