/**
 * Lowercase, non-alphanumeric-collapsed slug, trimmed of leading/trailing separators. Shared by
 * every id/filename slug this codebase mints (coachIntents.ts's injury flag ids, mintId's
 * season/quest ids, the manual test harness's log filenames) so they stay one pattern, not three
 * independently-typed copies of the same six lines.
 */
export function slugify(text: string, separator = "_", maxLength?: number): string {
  const trimRe = new RegExp(`^${separator}+|${separator}+$`, "g");
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(trimRe, "");
  return maxLength === undefined ? slug : slug.slice(0, maxLength);
}
