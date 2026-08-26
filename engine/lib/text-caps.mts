// Character caps on Coach-written free text (issue #462). One shared source of truth for the
// three numbers, consumed by both the Gemini schema/prompt (layers 0-2) and the write-time
// backstop (layer 3) in ui/api/coach-chat/_lib. See engine/scripts/validate-text-caps.py for the
// CI-side backstop, which mirrors these numbers since it can't import this module directly.
export const COACH_LOG_TEXT_CAP = 2000;
export const MEMORY_NOTE_TEXT_CAP = 1500;
export const INJURY_FLAG_TEXT_CAP = 500;

const TRUNCATION_MARKER = "… [truncated]";

// .slice()/.substring() operate on UTF-16 code units, which can split a surrogate pair (e.g. an
// emoji) in half and leave a corrupted lone-surrogate character dangling at the cut point.
// Array.from splits on codepoints instead, so truncation always lands on a whole character - same
// approach as chatThreads.ts's truncateTitle.
export function capText(value: string, cap: number): string {
  if (value.length <= cap) return value;
  const chars = Array.from(value);
  if (chars.length <= cap) return value;
  const keep = Math.max(0, cap - TRUNCATION_MARKER.length);
  return `${chars.slice(0, keep).join("")}${TRUNCATION_MARKER}`;
}
