import type { FileEntry } from "../../_lib/githubGitData.js";

// Ordinary turns persist whatever action writes were actually built, for every athlete
// regardless of profile completeness (#616 - a completed profile used to discard every
// ordinary-turn write here). The caller deliberately omits coach-log/workout writes; chatWrite
// is folded in separately by commitOrdinaryTurn.
export function fspIncrementalWrites(
  candidates: ReadonlyArray<FileEntry | undefined>,
): FileEntry[] {
  return candidates.filter(Boolean) as FileEntry[];
}

export function ordinaryTurnResponse(
  reply: string,
  repoSha: string | null,
  stale: boolean,
  profileComplete: boolean,
) {
  return { reply, closed: false as const, repoSha, stale, profileComplete };
}
