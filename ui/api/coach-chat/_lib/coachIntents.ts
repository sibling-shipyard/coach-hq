/**
 * Part B of coach-chat's write-authority rebuild: pure appliers for fields Gemini reports as
 * plain facts, where the server owns the file mechanic entirely - Gemini never sees or edits the
 * file's current shape, it just states what happened. Grown one function at a time as each fact
 * field gets wired in.
 */

import { MEMORY_NOTE_LABELS, type MemoryJson, type MemoryNoteLabel, type InjuryFlag, type CoachLogRow } from "./coachMemoryFiles.js";

// coach_note: appends one row to coach_log.json - the single merged continuity log
// (coach-redesign-part1-memory.md) that absorbed what used to be split across coach_notes.md
// (write-only, append) and rolling_state.json (a separate bounded last-N-sessions array read back
// into every turn's prompt). This is now the only write either of those did: an unbounded,
// append-only row log. Windowing to "last N" happens at render time (coachContext.ts), not by
// truncating storage here - the full history is worth keeping. Malformed/missing current content
// is treated as an empty log rather than thrown, same defensive default the other appliers below
// use for their own files.
export function applyCoachNote(content: string | null, note: string, dateString: string, traceId: string, now: Date): string {
  let rows: CoachLogRow[] = [];
  if (content && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.rows)) rows = parsed.rows;
    } catch {
      rows = [];
    }
  }
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
// defensive default as applyRollingState's malformed-JSON handling - rather than throwing and
// losing a real close over a corrupt file.
export function applyMemoryUpdate(
  content: string | null,
  label: MemoryNoteLabel,
  text: string,
  updatedAt: string,
  traceId: string,
): string {
  let parsed: Partial<MemoryJson> = {};
  if (content && content.trim()) {
    try {
      const candidate = JSON.parse(content);
      if (candidate && typeof candidate === "object") parsed = candidate as Partial<MemoryJson>;
    } catch {
      parsed = {};
    }
  }

  const emptyNotes = () =>
    Object.fromEntries(
      MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
    ) as MemoryJson["notes"];

  const result: MemoryJson = {
    version: 1,
    _meta: parsed._meta ?? { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    sports: parsed.sports ?? [],
    goal: parsed.goal ?? "",
    timeline: parsed.timeline ?? "",
    coaching_style: parsed.coaching_style ?? "",
    notes: { ...emptyNotes(), ...(parsed.notes ?? {}) },
  };

  result.notes[label] = { text: text.trim(), updated_at: updatedAt, trace_id: traceId };
  result._meta = { updated_at: updatedAt, updated_by: "model", trace_id: traceId };

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
  let flags: InjuryFlag[] = [];
  if (content && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.flags)) flags = parsed.flags;
    } catch {
      flags = [];
    }
  }

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
