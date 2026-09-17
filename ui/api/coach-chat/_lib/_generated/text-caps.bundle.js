// ../engine/lib/text-caps.mts
var COACH_LOG_TEXT_CAP = 2e3;
var MEMORY_NOTE_TEXT_CAP = 1500;
var INJURY_FLAG_TEXT_CAP = 500;
var TRUNCATION_MARKER = "\u2026 [truncated]";
function capText(value, cap) {
  if (value.length <= cap) return value;
  const chars = Array.from(value);
  if (chars.length <= cap) return value;
  const keep = Math.max(0, cap - TRUNCATION_MARKER.length);
  return `${chars.slice(0, keep).join("")}${TRUNCATION_MARKER}`;
}
export {
  COACH_LOG_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  capText
};
