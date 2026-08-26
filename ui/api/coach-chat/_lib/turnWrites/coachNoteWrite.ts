// coach_note: the continuity log write (coach_log.json). One usecase, one file - see
// coachIntents.ts's applyCoachNote for the pure merge logic this wraps with I/O.
import type { FileEntry } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import { applyCoachNote } from "../coachIntents.js";
import { COACH_LOG_PATH } from "../coachMemoryFiles.js";
import { capText, COACH_LOG_TEXT_CAP } from "../text-caps.bundle.js";

export function buildCoachNoteWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  coachNote: string | undefined,
): FileEntry | undefined {
  const trimmed = coachNote?.trim();
  if (!trimmed) return undefined;
  return {
    path: COACH_LOG_PATH,
    resolve: async () =>
      applyCoachNote(
        await getFileRaw(repo, COACH_LOG_PATH, token),
        capText(trimmed, COACH_LOG_TEXT_CAP),
        todayDateString(timezone, new Date()),
        traceId,
        new Date(),
      ),
  };
}
