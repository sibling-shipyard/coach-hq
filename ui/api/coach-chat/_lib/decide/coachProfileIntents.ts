/** Pure server-owned appliers for profile, memory, coaching-style, availability, and sports actions reported by Gemini. */

import {
  MEMORY_NOTE_LABELS,
  COACHING_STYLES,
  type MemoryJson,
  type MemoryNoteLabel,
  type CoachingStyle,
  type CoachLogRow,
  type ProfileJson,
  type TrainingAvailability,
} from "./coachMemoryFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";

// coach_note: writes one row per calendar day to coach_log.json, the single merged continuity
// log. Day-keyed, mirroring applyQuestEvent's (quest_id, date) pattern below: a turn on a day
// with an existing row overwrites that row's text/ts/trace_id in place - the note is a running
// revision of today, not an append log, since a turn on any ordinary conversation can update it,
// not just a dedicated closing step. A turn on a new day creates a fresh row. Malformed/missing
// current content is treated as an empty log rather than thrown, same defensive default the
// other appliers below use for their own files.
export function applyCoachNote(
  content: string | null,
  note: string,
  dateString: string,
  traceId: string,
  now: Date,
): string {
  const parsed = parseJsonOrNull<{ rows?: CoachLogRow[] }>(content);
  const rows: CoachLogRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const existingIndex = rows.findIndex((r) => r.date === dateString);
  const row: CoachLogRow = {
    id:
      existingIndex >= 0
        ? rows[existingIndex].id
        : `sess_${dateString}_${Math.random().toString(36).slice(2, 6)}`,
    date: dateString,
    ts: now.toISOString(),
    type: "chat",
    text: note.trim(),
    trace_id: traceId,
  };
  const nextRows =
    existingIndex >= 0 ? rows.map((r, i) => (i === existingIndex ? row : r)) : [...rows, row];
  return JSON.stringify({ version: 1, rows: nextRows }, null, 2);
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
    coaching_style: parsed.coaching_style ?? null,
    training_availability: parsed.training_availability ?? null,
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  result.notes[label] = { text: text.trim(), updated_at: updatedAt, trace_id: traceId };

  return JSON.stringify(result, null, 2);
}

// coaching_style_update: a separate field from memory_update, not a seventh label - it's a plain
// top-level enum on MemoryJson, not a {text, updated_at, trace_id} notes box.
export function applyCoachingStyleUpdate(
  content: string | null,
  style: string,
  updatedAt: string,
  traceId: string,
): string {
  if (!COACHING_STYLES.includes(style as CoachingStyle)) {
    throw new Error(`coaching_style_update: "${style}" is not a valid coaching style`);
  }

  const parsed = parseJsonOrNull<Partial<MemoryJson>>(content) ?? {};

  const emptyNotes = () =>
    Object.fromEntries(
      MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
    ) as MemoryJson["notes"];

  const result: MemoryJson = {
    version: 1,
    _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    sports: parsed.sports ?? [],
    coaching_style: style as CoachingStyle,
    training_availability: parsed.training_availability ?? null,
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  return JSON.stringify(result, null, 2);
}

// training_availability: written from the training_availability_update action field, or from
// inferTrainingAvailability's parse of the memory notes when the model never set it. Same
// reconstruct-with-emptyNotes shape as every other applier in this file, so a first-session
// athlete with no memory.json yet still gets a well-formed one.
export function applyTrainingAvailabilityUpdate(
  content: string | null,
  availability: TrainingAvailability | null,
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
    coaching_style: parsed.coaching_style ?? null,
    training_availability: availability,
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  return JSON.stringify(result, null, 2);
}

// sports_update: First Session Protocol bug fix - memory.json.sports had no write path at all
// (isAthleteProfileComplete requires it non-empty, so a first session could never complete via
// chat until this existed). A separate top-level field, not folded into memory_update's six
// notes boxes - it's a plain array on MemoryJson, not a {text, updated_at, trace_id} box.
//
// #1037 PR E: this used to fully replace memory.sports with whatever Gemini sent, never
// consulting the existing list. The prompt tells Gemini to send the full list every time, not
// just what changed, but a model that forgets to restate an existing sport when adding a new one
// silently and permanently deleted it - no detector could catch this either, since the only
// guard here checks "did sports_update fire at all," never "does the list look complete." Now it
// merges: union the new list with whatever's already on file instead of trusting the new list is
// complete.
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
  const existing = parsed.sports ?? [];
  // Case-insensitive union, preserving the NEW list's casing/order for anything it names, then
  // appending any existing sport the new list didn't mention - the prompt already tells Gemini
  // to send "the full list, not just what changed," so this only protects against the model
  // failing that instruction, it doesn't change intended behavior when the model gets it right.
  const seen = new Set(cleaned.map((s) => s.toLowerCase()));
  const merged = [...cleaned, ...existing.filter((s) => !seen.has(s.toLowerCase()))];

  const emptyNotes = () =>
    Object.fromEntries(
      MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
    ) as MemoryJson["notes"];

  const result: MemoryJson = {
    version: 1,
    _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    sports: merged,
    coaching_style: parsed.coaching_style ?? null,
    training_availability: parsed.training_availability ?? null,
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  return JSON.stringify(result, null, 2);
}

// profile_update { field, value }: Part 2 ledger split, step 3b - sets exactly one field in
// profile.json. `coach_since` is deliberately not one of the allowed fields (server-only, per
// ADR 0018 - it's stamped once at First Session, never something Gemini reports). Falls back to
// a fresh, mostly-null profile.json on missing/unparsable content - same defensive default as
// the other appliers in this file.
export type ProfileUpdateField = "name" | "dob" | "timezone" | "height_cm" | "weight_kg";

export interface ProfileUpdate {
  field: ProfileUpdateField;
  // string-only, same reasoning as QuestEvent.value in coachSeasonQuestIntents.ts - the Gemini
  // responseSchema (coachReplySchema.ts) declares this as `{ type: "string" }` too, so `number`
  // was equally dead type surface here. Found in review as the same bug class left uncorrected
  // on this field.
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
