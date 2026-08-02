/**
 * A7: apply Gemini's proposed file changes without asking it to reproduce whole files.
 *
 * Two strategies, chosen per file by coach-chat.ts based on file type:
 * - Markdown (state.md, coach_notes.md): exact-match string replace, one or more edits per
 *   file. Mirrors the same old_string/new_string pattern this session's own Edit tool uses -
 *   an edit only applies if old_string appears in the current content, otherwise it's rejected
 *   (not fatal - other edits in the same file, and other files, still proceed).
 * - JSON (challenge_v2.json, current_week.json, sleep_log.json): RFC 7396 JSON Merge Patch.
 *   Structurally safer than a string replace inside JSON - a merge patch can't produce
 *   unbalanced brackets or a trailing comma, and it can't silently corrupt a field it wasn't
 *   asked to touch.
 */

export interface StringEdit {
  old_string: string;
  new_string: string;
}

export interface ApplyEditsResult {
  content: string;
  /** old_string values that didn't match (0 or >1 occurrences) and were skipped. */
  failed: StringEdit[];
}

// Applied in order, each against the result of the previous edit - so a later edit in the same
// file_updates entry can target text introduced by an earlier one. Requires an EXACT, UNIQUE
// match (same discipline as this session's own Edit tool) rather than a first-match replace:
// old_string appearing 0 or 2+ times in the current content is ambiguous or wrong, and applying
// it anyway risks editing the wrong occurrence or silently no-op'ing. Skipped edits are reported
// back, not thrown - one bad edit shouldn't sink every other genuinely-correct change Gemini
// proposed in the same turn.
export function applyStringEdits(content: string, edits: StringEdit[]): ApplyEditsResult {
  let current = content;
  const failed: StringEdit[] = [];
  for (const edit of edits) {
    if (!edit.old_string) {
      failed.push(edit);
      continue;
    }
    const firstIndex = current.indexOf(edit.old_string);
    if (firstIndex === -1 || current.indexOf(edit.old_string, firstIndex + 1) !== -1) {
      failed.push(edit);
      continue;
    }
    current = current.slice(0, firstIndex) + edit.new_string + current.slice(firstIndex + edit.old_string.length);
  }
  return { content: current, failed };
}

// RFC 7396 JSON Merge Patch: objects merge key-by-key (recursively for nested objects), a null
// value deletes the key, any other value (including arrays) replaces the key wholesale - arrays
// are never merged element-by-element, only replaced whole, per spec.
function mergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }
  const result: Record<string, unknown> =
    target !== null && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = mergePatch(result[key], value);
    }
  }
  return result;
}

export type ApplyMergePatchResult = { ok: true; content: string } | { ok: false; error: string };

// currentContent may be null (file doesn't exist yet) - merge patch against an empty object is
// valid and just becomes "create this file with these fields." patchJson is Gemini's proposed
// patch as a JSON-encoded STRING (not a raw object) - Gemini's structured-output schema uses a
// string field here rather than a freeform nested object, since Google's schema format doesn't
// reliably support open-ended objects the same way a JSON string field does.
export function applyJsonMergePatch(currentContent: string | null, patchJson: string): ApplyMergePatchResult {
  let patch: unknown;
  try {
    patch = JSON.parse(patchJson);
  } catch (err) {
    return { ok: false, error: `merge_patch is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  let current: unknown = {};
  if (currentContent) {
    try {
      current = JSON.parse(currentContent);
    } catch (err) {
      return { ok: false, error: `current file content is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  const merged = mergePatch(current, patch);
  return { ok: true, content: JSON.stringify(merged, null, 2) };
}
