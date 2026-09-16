// Shared "find hist file by activity id" logic. Extracted from coach-message's coachMessage.ts
// (#1147) so coach-chat's ordinary-turn context builder can reuse the same id-matching instead
// of duplicating it.

export interface ActivityFileEntry {
  name: string;
  path: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function requestedIdParts(activityId: string): {
  source: string;
  localId: string;
} {
  const separator = activityId.indexOf(":");
  return {
    source: activityId.slice(0, separator),
    localId: activityId.slice(separator + 1),
  };
}

export function candidateFile(entry: ActivityFileEntry, localId: string): boolean {
  return (
    entry.path.startsWith("user_data/activities/hist/") && entry.name.endsWith(`_${localId}.json`)
  );
}

export function activityMatches(
  value: unknown,
  source: string,
  localId: string,
): value is Record<string, unknown> {
  if (!isObject(value) || value.source !== source) return false;
  const storedId = value.id ?? value.id_str;
  return String(storedId) === localId;
}
