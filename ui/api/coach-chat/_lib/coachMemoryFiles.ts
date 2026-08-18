/**
 * Shapes and paths for the four files coach-redesign-part1-memory.md introduces:
 * profile.json (settings), memory.json (Coach's free-text notes), injuries.json (open/resolved
 * flags), sessions.json (the merged continuity log). Types only here - the read/write mechanics
 * live in coachChatFiles.ts (reads) and coachIntents.ts/coachWrites.ts (server-owned writes),
 * same split as today's state.md/coach_notes.md/rolling_state.json.
 */

export const PROFILE_PATH = "user_data/coach/profile.json";
export const MEMORY_PATH = "user_data/coach/memory.json";
export const INJURIES_PATH = "user_data/coach/injuries.json";
export const SESSIONS_PATH = "user_data/coach/sessions.json";

export interface ProfileJson {
  version: 1;
  coach_since: string | null;
  name: string;
  dob: string | null;
  timezone: string;
  height_cm: number | null;
  weight_kg: number | null;
}

// The six memory_update labels - fixed set, per gemini-flow.md's "constrained values over free
// text" rule. `equipment` moved here from profile.json (coach-redesign-part1-memory.md).
export const MEMORY_NOTE_LABELS = [
  "fitness_baseline",
  "coaching_priorities",
  "learned_patterns.training",
  "learned_patterns.nutrition",
  "learned_patterns.mental",
  "equipment",
] as const;

export type MemoryNoteLabel = (typeof MEMORY_NOTE_LABELS)[number];

export interface MemoryNote {
  text: string;
  updated_at: string;
  trace_id: string;
}

export interface MemoryJson {
  version: 1;
  _meta: { updated_at: string; updated_by: string; trace_id: string };
  sports: string[];
  goal: string;
  timeline: string;
  coaching_style: string;
  notes: Record<MemoryNoteLabel, MemoryNote>;
}

export interface InjuryFlag {
  id: string;
  text: string;
  status: "active" | "resolved";
  opened_at: string;
  resolved_at: string | null;
}

export interface InjuriesJson {
  flags: InjuryFlag[];
}

export interface SessionRow {
  id: string;
  date: string;
  ts: string;
  type: "chat";
  text: string;
  trace_id: string;
}

export interface SessionsJson {
  version: 1;
  rows: SessionRow[];
}
