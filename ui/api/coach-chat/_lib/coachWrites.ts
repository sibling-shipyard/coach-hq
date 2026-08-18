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

export const CHALLENGE_V2_PATH = "user_data/ledger/challenge_v2.json";

// Fetched on a closing turn purely for the server-side coach_since stamp (ADR 0018) - never
// shown to Gemini.
export interface ClosingFileContext {
  challengeV2: string | null;
}

export async function loadClosingFileContext(repo: string, token: string): Promise<ClosingFileContext> {
  const challengeV2 = await getFileRaw(repo, CHALLENGE_V2_PATH, token);
  return { challengeV2 };
}

// ADR 0018: coach_since is set automatically, server-side, on the false→true profileComplete
// transition (the turn that finishes the First Session Protocol) - never relies on Gemini to
// propose it. Write-once: a no-op if coach_since is already present.
export function injectCoachSinceIfNeeded(
  validUpdates: { path: string; content: string }[],
  closingFiles: ClosingFileContext | undefined,
  wasProfileComplete: boolean,
  isProfileCompleteNow: boolean,
  timezone: string,
): { path: string; content: string }[] {
  if (wasProfileComplete || !isProfileCompleteNow || !closingFiles) return validUpdates;
  const existing = validUpdates.find((u) => u.path === CHALLENGE_V2_PATH);
  const baseContent = existing?.content ?? closingFiles.challengeV2;
  try {
    const parsed = baseContent ? JSON.parse(baseContent) : {};
    if (parsed.coach_since) return validUpdates; // already stamped - never overwritten
  } catch {
    console.warn("[coach-chat] challenge_v2.json unparsable - skipping coach_since stamp");
    return validUpdates;
  }
  const patch = JSON.stringify({ coach_since: todayDateString(timezone, new Date()) });
  const result = applyJsonMergePatch(baseContent ?? null, patch);
  if (!result.ok) {
    console.warn(`[coach-chat] coach_since stamp failed - ${result.error}`);
    return validUpdates;
  }
  const rest = validUpdates.filter((u) => u.path !== CHALLENGE_V2_PATH);
  return [...rest, { path: CHALLENGE_V2_PATH, content: result.content }];
}
