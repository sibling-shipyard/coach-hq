/**
 * What Coach may write to an athlete's repo, and how - the write-authority half of coach-chat.
 * coach-chat-reliability-debug: this is intentionally thin right now. The old file_updates/
 * checklist write path (state.md edits, challenge_v2.json/current_week.json/sleep_log.json merge
 * patches) was stripped out to isolate a reliability problem - see
 * docs/eng-docs/coach-chat-design-history.md's 2026-08-14/15 entry and
 * docs/plans/coach-chat-follow-up.md for what's being rebuilt here, incrementally, on top of this
 * module boundary.
 */
import { applyJsonMergePatch } from "../fileEdits.js";
import { getFileRaw } from "./coachChatFiles.js";
import { todayDateString } from "./coachDay.js";

export const COACH_NOTES_PATH = "user_data/coach/coach_notes.md";
export const CHALLENGE_V2_PATH = "user_data/ledger/challenge_v2.json";

// coach-chat-reliability-debug: the whole write path is now one append-only fact, immune to the
// exact-match/patch-parse failure modes a targeted edit has - nothing to reject, nothing to fail
// to match. `currentContent` is null when coach_notes.md doesn't exist yet (first note ever
// written for this athlete) - starts the file with just the new dated entry.
export function appendCoachNote(currentContent: string | null, note: string, dateString: string): string {
  const base = currentContent ?? "";
  return `${base}\n\n## ${dateString}\n${note.trim()}`;
}

// coach-chat-reliability-debug: challenge_v2.json is fetched on a closing turn purely for the
// server-side coach_since stamp (ADR 0018) - never shown to Gemini, since it isn't proposing
// edits to it any more.
export interface ClosingFileContext {
  challengeV2: string | null;
}

// coach-chat-reliability-debug: only fetched for the server-side coach_since stamp (ADR 0018) -
// never shown to Gemini, since it isn't proposing edits to it any more.
export async function loadClosingFileContext(repo: string, token: string): Promise<ClosingFileContext> {
  const challengeV2 = await getFileRaw(repo, CHALLENGE_V2_PATH, token);
  return { challengeV2 };
}

// ADR 0018: coach_since is set automatically, server-side, the moment the false→true
// profileComplete transition happens - i.e. the turn that genuinely finishes the First Session
// Protocol - never at repo-provisioning time (an infra timestamp, not real usage; the same
// failure mode already rejected for repo.created_at). Never relies on Gemini remembering to
// propose this field itself. Write-once - if coach_since is already present (e.g. this repo was
// manually backfilled per issue #199, or a retry of a turn that already stamped it), this is a
// no-op.
export function injectCoachSinceIfNeeded(
  validUpdates: { path: string; content: string }[],
  closingFiles: ClosingFileContext | undefined,
  wasProfileComplete: boolean,
  isProfileCompleteNow: boolean,
  stateMd: string,
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
  const patch = JSON.stringify({ coach_since: todayDateString(stateMd, new Date()) });
  const result = applyJsonMergePatch(baseContent ?? null, patch);
  if (!result.ok) {
    console.warn(`[coach-chat] coach_since stamp failed - ${result.error}`);
    return validUpdates;
  }
  const rest = validUpdates.filter((u) => u.path !== CHALLENGE_V2_PATH);
  return [...rest, { path: CHALLENGE_V2_PATH, content: result.content }];
}
