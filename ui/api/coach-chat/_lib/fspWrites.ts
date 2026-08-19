import type { FileEntry } from "../../_lib/githubGitData.js";

// Ordinary turns may persist only the already-built FSP action writes, and only while the
// athlete is still incomplete. The caller deliberately omits chat/coach-log/workout writes.
export function fspIncrementalWrites(
  profileComplete: boolean,
  candidates: ReadonlyArray<FileEntry | undefined>,
): FileEntry[] {
  if (profileComplete) return [];
  return candidates.filter(Boolean) as FileEntry[];
}
