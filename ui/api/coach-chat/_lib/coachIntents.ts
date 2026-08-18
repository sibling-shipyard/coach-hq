/**
 * Part B of coach-chat's write-authority rebuild: pure appliers for fields Gemini reports as
 * plain facts, where the server owns the file mechanic entirely - Gemini never sees or edits the
 * file's current shape, it just states what happened. Grown one function at a time as each fact
 * field gets wired in.
 */

import { MEMORY_NOTE_LABELS, type MemoryJson, type MemoryNoteLabel, type InjuryFlag, type CoachLogRow, type ProfileJson } from "./coachMemoryFiles.js";
import { type ProgressRow } from "./coachQuestFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";

// coach_note: appends one row to coach_log.json - the single merged continuity log
// (coach-redesign-part1-memory.md) that absorbed what used to be split across coach_notes.md
// (write-only, append) and rolling_state.json (a separate bounded last-N-sessions array read back
// into every turn's prompt). This is now the only write either of those did: an unbounded,
// append-only row log. Windowing to "last N" happens at render time (coachContext.ts), not by
// truncating storage here - the full history is worth keeping. Malformed/missing current content
// is treated as an empty log rather than thrown, same defensive default the other appliers below
// use for their own files.
export function applyCoachNote(content: string | null, note: string, dateString: string, traceId: string, now: Date): string {
  const parsed = parseJsonOrNull<{ rows?: CoachLogRow[] }>(content);
  const rows: CoachLogRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];
  const id = `sess_${dateString}_${Math.random().toString(36).slice(2, 6)}`;
  const row: CoachLogRow = { id, date: dateString, ts: now.toISOString(), type: "chat", text: note.trim(), trace_id: traceId };
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
    goal: parsed.goal ?? "",
    timeline: parsed.timeline ?? "",
    coaching_style: parsed.coaching_style ?? "",
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  result.notes[label] = { text: text.trim(), updated_at: updatedAt, trace_id: traceId };

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

export function applyInjuryEvent(content: string | null, event: InjuryEvent, today: string): string {
  const parsed = parseJsonOrNull<{ flags?: InjuryFlag[] }>(content);
  const flags: InjuryFlag[] = Array.isArray(parsed?.flags) ? parsed.flags : [];

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
    return JSON.stringify({ flags: [...flags, newFlag] }, null, 2);
  }

  if (!flags.some((flag) => flag.id === event.flag_id)) {
    // Gemini reported a flag_id that doesn't exist in the current file - either it hallucinated
    // one or the flags list changed underneath it since its context was built. Throwing here
    // (instead of silently returning the array unchanged) is deliberate: a caller that commits
    // this write should know the update didn't actually happen, not get a false "success".
    throw new Error(`injury_event: no flag with id "${event.flag_id}" in injuries.json`);
  }

  const updated = flags.map((flag) => {
    if (flag.id !== event.flag_id) return flag;
    if (event.status === "resolved") {
      return {
        ...flag,
        text: event.text?.trim() ? event.text.trim() : flag.text,
        status: "resolved" as const,
        resolved_at: today,
      };
    }
    // status: "active" - either a text update on an already-active flag, or a reactivation of a
    // previously resolved one (resolved_at cleared back to null).
    return {
      ...flag,
      text: event.text?.trim() ? event.text.trim() : flag.text,
      status: "active" as const,
      resolved_at: null,
    };
  });

  return JSON.stringify({ flags: updated }, null, 2);
}

// quest_event { quest_id, status, value? }: Part 2 ledger split. Server owns date/id/ts/trace_id/
// season_id entirely (gemini-flow.md's Action-field design rule #1) - Gemini only ever supplies
// quest_id/status/value. Upserts on (quest_id, date) - reporting the same tick twice for today is
// a no-op by construction, same repeat-safety story as coach-redesign-part2-ledger.md describes.
// `value` only matters for progress-type quests (e.g. "12/20 chapters") - other quest types only
// ever report status.
export interface QuestEvent {
  quest_id: string;
  status: "completed" | "missed" | "excused";
  value?: number | string;
}

export function applyQuestEvent(
  content: string | null,
  event: QuestEvent,
  today: string,
  currentSeasonId: string,
  traceId: string,
  now: Date,
): string {
  const parsed = parseJsonOrNull<{ rows?: ProgressRow[] }>(content);
  const rows: ProgressRow[] = Array.isArray(parsed?.rows) ? parsed.rows : [];

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

  const updated = existingIndex >= 0 ? rows.map((r, i) => (i === existingIndex ? row : r)) : [...rows, row];

  return JSON.stringify({ version: 1, rows: updated }, null, 2);
}

// profile_update { field, value }: Part 2 ledger split, step 3b - sets exactly one field in
// profile.json. `coach_since` is deliberately not one of the allowed fields (server-only, per
// ADR 0018 - it's stamped once at First Session, never something Gemini reports). Falls back to
// a fresh, mostly-null profile.json on missing/unparsable content - same defensive default as
// the other appliers in this file.
export type ProfileUpdateField = "name" | "dob" | "timezone" | "height_cm" | "weight_kg";

export interface ProfileUpdate {
  field: ProfileUpdateField;
  value: string | number;
}

export function applyProfileUpdate(content: string | null, update: ProfileUpdate): string {
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

  if (update.field === "name" || update.field === "dob" || update.field === "timezone") {
    result[update.field] = String(update.value);
  } else {
    // height_cm / weight_kg - numeric fields.
    result[update.field] = Number(update.value);
  }

  return JSON.stringify(result, null, 2);
}
