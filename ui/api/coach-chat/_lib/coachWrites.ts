/**
 * What Coach may write to an athlete's repo, and how - the write-authority half of coach-chat.
 * Intentionally thin right now: the old file_updates/checklist write path (state.md edits,
 * JSON merge patches) was stripped out to isolate a reliability problem. See
 * docs/eng-docs/coach-chat-design-history.md's 2026-08-14/15 entry and BACKLOG.md for what's
 * being rebuilt here incrementally.
 */
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import { getFileRaw } from "./coachChatFiles.js";
import { todayDateString } from "./coachDay.js";
import { PROFILE_PATH } from "./coachMemoryFiles.js";

// Found live testing Part A: this used to target user_data/ledger/challenge_v2.json, the file
// Part 2's ledger split deleted - coach_since was never migrated to profile.json (where
// ProfileJson.coach_since actually lives) when that redesign landed. The false->true transition
// this gates was dead code until Part A made it reachable, so the wrong target never surfaced
// until now. Fixed to write the real field.

// Fetched on a closing turn (or the incremental FSP turn that completes the profile) purely for
// the server-side coach_since stamp (ADR 0018) - never shown to Gemini.
export interface ClosingFileContext {
  profile: string | null;
}

export async function loadClosingFileContext(repo: string, token: string): Promise<ClosingFileContext> {
  const profile = await getFileRaw(repo, PROFILE_PATH, token);
  return { profile };
}

// ADR 0018: coach_since is set automatically, server-side, on the false→true profileComplete
// transition (the turn that finishes the First Session Protocol) - never relies on Gemini to
// propose it. Write-once: a no-op if coach_since is already present.
//
// Both profileUpdateWrite and this can target profile.json on the exact turn that completes the
// profile (the athlete's last few missing fields commonly land in the same message that also
// crosses the completeness bar) - the caller MUST merge this function's PROFILE_PATH entry into
// profileUpdateWrite's own resolve() rather than pushing both as separate FileEntry objects for
// the same path (commitFilesAtomic has no per-path merge, last blob for a path silently wins).
export function injectCoachSinceIfNeeded(
  validUpdates: { path: string; content: string }[],
  closingFiles: ClosingFileContext | undefined,
  wasProfileComplete: boolean,
  isProfileCompleteNow: boolean,
  timezone: string,
): { path: string; content: string }[] {
  if (wasProfileComplete || !isProfileCompleteNow || !closingFiles) return validUpdates;
  const existing = validUpdates.find((u) => u.path === PROFILE_PATH);
  const baseContent = existing?.content ?? closingFiles.profile;
  try {
    const parsed = baseContent ? JSON.parse(baseContent) : {};
    if (parsed.coach_since) return validUpdates; // already stamped - never overwritten
  } catch {
    console.warn("[coach-chat] profile.json unparsable - skipping coach_since stamp");
    return validUpdates;
  }
  const patch = JSON.stringify({ coach_since: todayDateString(timezone, new Date()) });
  const result = applyJsonMergePatch(baseContent ?? null, patch);
  if (!result.ok) {
    console.warn(`[coach-chat] coach_since stamp failed - ${result.error}`);
    return validUpdates;
  }
  const rest = validUpdates.filter((u) => u.path !== PROFILE_PATH);
  return [...rest, { path: PROFILE_PATH, content: result.content }];
}
