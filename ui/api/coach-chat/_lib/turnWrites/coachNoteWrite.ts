// coach_note: the continuity log write (coach_log.json). One usecase, one file - see
// coachIntents.ts's applyCoachNote for the pure merge logic this wraps with I/O.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { applyCoachNote } from "../coachIntents.js";
import { COACH_LOG_PATH } from "../coachMemoryFiles.js";
import { capText, COACH_LOG_TEXT_CAP } from "../text-caps.bundle.js";

export function buildCoachNoteWrite(
  repo: string,
  token: string,
  // The turn's own cached "today" (coachTurn.ts's loadTurnState), not recomputed here - the
  // context Gemini was shown ("today's existing note") has to match the day this write actually
  // overwrites. Recomputing independently at resolve() time can land on a different day than
  // what Gemini saw if the turn (or a reprompt's second round trip) straddles local midnight.
  today: string,
  traceId: string,
  coachNote: string | undefined,
): ResolvedFileWrite | undefined {
  const trimmed = coachNote?.trim();
  if (!trimmed) return undefined;
  return {
    path: COACH_LOG_PATH,
    resolve: async () =>
      applyCoachNote(
        await getFileRaw(repo, COACH_LOG_PATH, token),
        capText(trimmed, COACH_LOG_TEXT_CAP),
        today,
        traceId,
        new Date(),
      ),
  };
}
