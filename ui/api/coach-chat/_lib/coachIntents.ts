/** Pure server-owned appliers for semantic actions reported by Gemini. */

import {
  MEMORY_NOTE_LABELS,
  type MemoryJson,
  type MemoryNoteLabel,
  type InjuryFlag,
  type CoachLogRow,
  type ProfileJson,
} from "./coachMemoryFiles.js";
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

// coach_note: appends one row to coach_log.json - the single merged continuity log
// (coach-redesign-part1-memory.md) that absorbed what used to be split across coach_notes.md
// (write-only, append) and rolling_state.json (a separate bounded last-N-sessions array read back
// into every turn's prompt). This is now the only write either of those did: an unbounded,
// append-only row log. Windowing to "last N" happens at render time (coachContext.ts), not by
// truncating storage here - the full history is worth keeping. Malformed/missing current content
// is treated as an empty log rather than thrown, same defensive default the other appliers below
// use for their own files.
export function applyCoachNote(
  content: string | null,
  note: string,
  dateString: string,
  traceId: string,
  now: Date,
): string {
  const parsed = parseJsonOrNull<{ rows?: CoachLogRow[] }>(content);
  const rows: CoachLogRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const id = `sess_${dateString}_${Math.random().toString(36).slice(2, 6)}`;
  const row: CoachLogRow = {
    id,
    date: dateString,
    ts: now.toISOString(),
    type: "chat",
    text: note.trim(),
    trace_id: traceId,
  };
  return JSON.stringify({ version: 1, rows: [...rows, row] }, null, 2);
}

// memory_update {label, text}: Gemini states which labelled box changed and its new text; the
// server owns the file mechanic entirely - stamping updated_at/trace_id, replacing exactly one
// notes[label] box, never touching the other five. Same principle as applyRollingState above.
// gemini-flow.md's Action-field design rule: label is a constrained enum (MEMORY_NOTE_LABELS),
// not free text, and every timestamp/id here is server-computed - Gemini only supplies text.
//
// Falls back to a fresh, empty-notes memory.json when content is null/unparsable - same
// defensive default as applyCoachNote's malformed-JSON handling - rather than throwing and
// losing a real close over a corrupt file. _meta is always freshly stamped below (this update is,
// by definition, the file's newest write), not conditionally preserved from the parsed content.
export function applyMemoryUpdate(
  content: string | null,
  label: MemoryNoteLabel,
  text: string,
  updatedAt: string,
  traceId: string,
): string {
  const parsed = parseJsonOrNull<Partial<MemoryJson>>(content) ?? {};

  const emptyNotes = () =>
    Object.fromEntries(
      MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
    ) as MemoryJson["notes"];

  const result: MemoryJson = {
    version: 1,
    _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    sports: parsed.sports ?? [],
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  result.notes[label] = { text: text.trim(), updated_at: updatedAt, trace_id: traceId };

  return JSON.stringify(result, null, 2);
}

// sports_update: First Session Protocol bug fix - memory.json.sports had no write path at all
// (isAthleteProfileComplete requires it non-empty, so a first session could never complete via
// chat until this existed). A separate top-level field, not folded into memory_update's six
// notes boxes - it's a plain array on MemoryJson, not a {text, updated_at, trace_id} box.
export function applySportsUpdate(
  content: string | null,
  sports: string[],
  updatedAt: string,
  traceId: string,
): string {
  const cleaned = sports.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    throw new Error(`sports_update: no non-blank sport in "${sports.join(", ")}"`);
  }

  const parsed = parseJsonOrNull<Partial<MemoryJson>>(content) ?? {};

  const emptyNotes = () =>
    Object.fromEntries(
      MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
    ) as MemoryJson["notes"];

  const result: MemoryJson = {
    version: 1,
    _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    sports: cleaned,
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  return JSON.stringify(result, null, 2);
}

// injury_event { status, text?, flag_id? }: Step 4b. Server owns id/opened_at/resolved_at
// entirely (gemini-flow.md's Action-field design rule #1) - Gemini only ever supplies the
// status/text/flag_id semantic facts. Three cases, per coach-redesign-part1-memory.md:
//   - no flag_id, status "active", text required -> new flag (server mints id, stamps
//     opened_at = today, resolved_at: null)
//   - flag_id present, status "active", text given -> update that flag's text in place; if it
//     was previously resolved, reactivate it (clear resolved_at back to null)
//   - flag_id present, status "resolved" -> stamp resolved_at = today, leave text as-is unless a
//     new one is given
export interface InjuryEvent {
  status: "active" | "resolved";
  text?: string;
  flag_id?: string;
}

// Array (workout-backend-wiring live verification, same bug class issue #410 fixed for
// quest_event): a single object silently dropped every injury update past the first when an
// athlete reported more than one in the same message (e.g. two separate flags resolving) -
// found live, the reply claimed both were handled but only the first actually committed. Events
// are applied in order against an accumulating flags array, so a turn reporting several updates
// captures all of them, and a later event in the same batch sees an earlier one's new flag (e.g.
// resolving a flag opened earlier in the same turn is possible, however unlikely in practice).
export function applyInjuryEvent(
  content: string | null,
  events: InjuryEvent[],
  today: string,
): string {
  const parsed = parseJsonOrNull<{ flags?: InjuryFlag[] }>(content);
  let flags: InjuryFlag[] = Array.isArray(parsed?.flags) ? parsed.flags : [];

  for (const event of events) {
    if (!event.flag_id) {
      // New flag - text is required (enforced by the caller before this is invoked), id minted
      // server-side.
      const slug = (event.text ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24);
      const id = `inj_${today.replace(/-/g, "")}_${slug || Math.random().toString(36).slice(2, 6)}`;
      const newFlag: InjuryFlag = {
        id,
        text: (event.text ?? "").trim(),
        status: "active",
        opened_at: today,
        resolved_at: null,
      };
      flags = [...flags, newFlag];
      continue;
    }

    if (!flags.some((flag) => flag.id === event.flag_id)) {
      // Gemini reported a flag_id that doesn't exist in the current file - either it
      // hallucinated one or the flags list changed underneath it since its context was built.
      // Throwing here (instead of silently returning the array unchanged) is deliberate: a
      // caller that commits this write should know the update didn't actually happen, not get a
      // false "success". Throws for the WHOLE batch, same all-or-nothing discipline as
      // applyWeekPlan's day-date validation - a batch with one bad id fails the whole call
      // rather than silently applying a partial patch.
      throw new Error(`injury_event: no flag with id "${event.flag_id}" in injuries.json`);
    }

    flags = flags.map((flag) => {
      if (flag.id !== event.flag_id) return flag;
      if (event.status === "resolved") {
        return {
          ...flag,
          text: event.text?.trim() ? event.text.trim() : flag.text,
          status: "resolved" as const,
          resolved_at: today,
        };
      }
      // status: "active" - either a text update on an already-active flag, or a reactivation of
      // a previously resolved one (resolved_at cleared back to null).
      return {
        ...flag,
        text: event.text?.trim() ? event.text.trim() : flag.text,
        status: "active" as const,
        resolved_at: null,
      };
    });
  }

  return JSON.stringify({ flags }, null, 2);
}

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

// profile_update { field, value }: Part 2 ledger split, step 3b - sets exactly one field in
// profile.json. `coach_since` is deliberately not one of the allowed fields (server-only, per
// ADR 0018 - it's stamped once at First Session, never something Gemini reports). Falls back to
// a fresh, mostly-null profile.json on missing/unparsable content - same defensive default as
// the other appliers in this file.
export type ProfileUpdateField = "name" | "dob" | "timezone" | "height_cm" | "weight_kg";

export interface ProfileUpdate {
  field: ProfileUpdateField;
  // string-only, same reasoning as QuestEvent.value above - the Gemini responseSchema
  // (coachReplySchema.ts) declares this as `{ type: "string" }` too, so `number` was equally dead
  // type surface here. Found in review as the same bug class left uncorrected on this field.
  value: string;
}

const PROFILE_UPDATE_FIELDS: readonly ProfileUpdateField[] = [
  "name",
  "dob",
  "timezone",
  "height_cm",
  "weight_kg",
];

// Array (workout-backend-wiring live verification, same fix issue #410 already gave
// quest_event / this PR already gave injury_event): a single object silently dropped every field
// change past the first when an athlete reported two profile fields in one message (weight AND
// timezone) - the reply falsely claimed both were updated, but only the last-reported field
// actually committed. Events applied in order against an accumulating result, all-or-nothing on
// a bad field (same discipline as applyInjuryEvent).
export function applyProfileUpdate(content: string | null, updates: ProfileUpdate[]): string {
  const parsed = parseJsonOrNull<Partial<ProfileJson>>(content) ?? {};

  const result: ProfileJson = {
    version: 1,
    coach_since: parsed.coach_since ?? null,
    name: parsed.name ?? "",
    dob: parsed.dob ?? null,
    timezone: parsed.timezone ?? "UTC",
    height_cm: parsed.height_cm ?? null,
    weight_kg: parsed.weight_kg ?? null,
  };

  for (const update of updates) {
    // Runtime guard, not just the TS type - `coach_since` must never be settable through this
    // action (ADR 0018), and this file's whole pattern is not trusting an upstream constraint
    // alone (see the malformed-JSON handling every applier here already does). Without this, an
    // unexpected `field` value would fall through to the numeric-coercion branch below, produce
    // NaN, and silently null out whatever was passed in.
    if (!PROFILE_UPDATE_FIELDS.includes(update.field)) {
      throw new Error(`profile_update: "${update.field}" is not a settable field`);
    }

    if (update.field === "name" || update.field === "dob" || update.field === "timezone") {
      // Found in review: the numeric branch below got a blank-value guard, but this branch
      // didn't get the same treatment - a blank value silently overwrote real name/dob/timezone
      // data with "" instead of being rejected like every other invalid input this action guards
      // against.
      if (update.value.trim() === "") {
        throw new Error(`profile_update: empty value is not valid for ${update.field}`);
      }
      result[update.field] = String(update.value);
    } else {
      // height_cm / weight_kg - numeric fields. Found in review: Number(update.value) was never
      // checked for NaN, so a non-numeric value (e.g. Gemini passing along "about 180" verbatim)
      // silently wrote NaN into profile.json - same silent-corruption shape the coach_since guard
      // above exists to prevent, just for a value instead of a field. Second finding: Number("")
      // (and whitespace-only strings) is 0, not NaN - JS's own quirk, not caught by isNaN alone -
      // so an empty value slipped past the guard and silently wrote 0 instead of being rejected.
      // Reject blank input explicitly before the numeric check.
      if (update.value.trim() === "") {
        throw new Error(`profile_update: empty value is not a valid number for ${update.field}`);
      }
      const parsedValue = Number(update.value);
      if (Number.isNaN(parsedValue)) {
        throw new Error(
          `profile_update: "${update.value}" is not a valid number for ${update.field}`,
        );
      }
      result[update.field] = parsedValue;
    }
  }

  return JSON.stringify(result, null, 2);
}

// Common id-minting shape reused by applySeasonStart/applyQuestCreate below - a slug of the name
// plus a short random suffix, same "slug + random tail" convention applyInjuryEvent already uses
// for flag ids above (there via today's date instead of a slug prefix, but the same idea: a
// short, readable, collision-resistant id minted server-side, never left to Gemini).
function mintId(prefix: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return `${prefix}_${slug || "x"}_${Math.random().toString(36).slice(2, 6)}`;
}

// season_start { name, start_date, end_date }: First Session Protocol bug fix - there was no
// write path to create a season at all, only applyQuestEvent logging progress against one that
// already existed. FSP's quest-setup step needs to create the very first season. Server mints
// the season id and sets it as current_season_id; the new season is prepended (newest-first, per
// coachQuestFiles.ts's own doc comment on SeasonsJson.seasons) with status "active". No `phase`
// field - Season doesn't have one, not inventing schema here.
export function applySeasonStart(
  content: string | null,
  input: { name: string; start_date: string; end_date: string },
  traceId: string,
  now: Date,
): string {
  const parsed = parseJsonOrNull<Partial<SeasonsJson>>(content) ?? {};
  const seasons: Season[] = Array.isArray(parsed.seasons) ? parsed.seasons : [];

  const id = mintId("season", input.name);
  const season: Season = {
    id,
    name: input.name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    status: "active",
  };

  const result: SeasonsJson = {
    version: 1,
    _meta: { updated_at: now.toISOString(), updated_by: "model", trace_id: traceId },
    current_season_id: id,
    seasons: [season, ...seasons],
  };

  return JSON.stringify(result, null, 2);
}

// quest_create { main_quest?, quests? }: First Session Protocol bug fix - applyQuestEvent only
// ever logs progress against an existing quest_id and throws if it doesn't exist yet, so FSP's
// quest-setup step (main goal, habit quests, season dates) had nothing to write to. Server mints
// every id; FSP-created quests are source "model" (Coach is structuring them from the
// conversation, not the athlete typing them directly into quests.json themselves) - the design
// doc's own resolved question on this. main_quest, when given, replaces the file's current
// main_quest entirely (there's only ever one). New quests are appended to quests[], status
// "active", start_date today, end_date null - same "server owns bookkeeping" discipline as every
// other applier in this file.
export function applyQuestCreate(
  content: string | null,
  input: {
    main_quest?: { name: string; type: QuestType; target: number; count_pattern?: string };
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

  let mainQuest: MainQuest | undefined = parsed.main_quest;
  if (input.main_quest) {
    mainQuest = {
      id: mintId("mq", input.main_quest.name),
      name: input.main_quest.name.trim(),
      type: input.main_quest.type,
      target: input.main_quest.target,
      ...(input.main_quest.count_pattern ? { count_pattern: input.main_quest.count_pattern } : {}),
    };
  }

  if (!mainQuest) {
    // main_quest is required on QuestsJson (not optional) - a fresh file with no prior main_quest
    // and no main_quest given in this call has nothing valid to write. Same "throw rather than
    // silently write a broken shape" discipline as the guards elsewhere in this file.
    throw new Error("quest_create: no main_quest given and quests.json has none to fall back to");
  }

  const newQuests: Quest[] = (input.quests ?? []).map((q) => ({
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

  const result: QuestsJson = {
    version: 1,
    _meta: { updated_at: now.toISOString(), updated_by: "model", trace_id: traceId },
    weekly_targets: parsed.weekly_targets ?? {},
    main_quest: mainQuest,
    quests: [...existingQuests, ...newQuests],
  };

  return JSON.stringify(result, null, 2);
}
