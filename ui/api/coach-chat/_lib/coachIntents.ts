/**
 * Part B of coach-chat's write-authority rebuild: pure appliers for fields Gemini reports as
 * plain facts, where the server owns the file mechanic entirely. Same principle as
 * coachWrites.ts's appendCoachNote - Gemini never sees or edits the file's current shape, it
 * just states what happened. Grown one function at a time as each fact field gets wired in.
 */

export interface RollingStateEntry {
  date: string; // YYYY-MM-DD
  text: string;
}

// rolling_state.json: a bounded, newest-first log of the last N sessions, read back into every
// turn's prompt (coachPrompt.ts's rollingStateContext) so Gemini has session-to-session
// continuity - something coach_notes.md alone never provided, since it's never re-read.
// Deliberately reuses coach_note verbatim rather than asking Gemini for a second field: a
// dedicated session_note field was tried and pulled after it reproduced the exact repetition-
// loop failure mode that got `title` removed from the schema (see
// docs/eng-docs/coach-chat-design-history.md) - reusing an already-reliable field has zero new
// generation-failure surface. Malformed/missing current content is treated as an empty log
// rather than thrown, same defensive default as coachWrites.ts's appendCoachNote.
const ROLLING_STATE_WINDOW = 3;

export function applyRollingState(content: string | null, entry: RollingStateEntry, window = ROLLING_STATE_WINDOW): string {
  let entries: RollingStateEntry[] = [];
  if (content && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      entries = [];
    }
  }
  const updated = [entry, ...entries].slice(0, window);
  return JSON.stringify(updated, null, 2);
}
