import type { FileEntry } from "../../_lib/githubGitData.js";

// Ordinary turns may persist only the already-built FSP action writes, and only while the
// athlete was still incomplete going into this turn - deliberately the pre-turn value, not the
// post-turn one, so the turn that actually completes the profile still gets to commit its own
// writes instead of being suppressed by its own result. The caller deliberately omits
// chat/coach-log/workout writes.
export function fspIncrementalWrites(
  wasProfileComplete: boolean,
  candidates: ReadonlyArray<FileEntry | undefined>,
): FileEntry[] {
  if (wasProfileComplete) return [];
  return candidates.filter(Boolean) as FileEntry[];
}
