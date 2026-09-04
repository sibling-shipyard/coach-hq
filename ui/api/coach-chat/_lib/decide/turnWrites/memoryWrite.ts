// memory_update / coaching_style_update / sports_update: all three land in memory.json, so they
// share one FileEntry and one usecase file - see coachIntents.ts for the pure appliers this wraps
// with I/O.
import type { ResolvedFileWrite } from "../../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import { applyMemoryUpdate, applyCoachingStyleUpdate, applySportsUpdate } from "../coachIntents.js";
import { MEMORY_PATH, type MemoryNoteLabel } from "../coachMemoryFiles.js";
import { capText, MEMORY_NOTE_TEXT_CAP } from "../../text-caps.bundle.js";

export interface MemoryUpdateInput {
  label: MemoryNoteLabel;
  text: string;
}

export function buildMemoryFileWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  params: {
    memoryUpdate: MemoryUpdateInput | undefined;
    coachingStyleUpdate: string | undefined;
    sportsUpdate: string[];
  },
): ResolvedFileWrite | undefined {
  const { memoryUpdate, coachingStyleUpdate, sportsUpdate } = params;
  const hasMemoryUpdate = Boolean(memoryUpdate?.label && memoryUpdate.text?.trim());
  const hasSportsUpdate = sportsUpdate.length > 0;
  if (!hasMemoryUpdate && !coachingStyleUpdate && !hasSportsUpdate) return undefined;

  return {
    path: MEMORY_PATH,
    resolve: async () => {
      let working: string | null = await getFileRaw(repo, MEMORY_PATH, token);
      if (hasMemoryUpdate) {
        working = applyMemoryUpdate(
          working,
          memoryUpdate!.label,
          capText(memoryUpdate!.text, MEMORY_NOTE_TEXT_CAP),
          todayDateString(timezone, new Date()),
          traceId,
        );
      }
      if (coachingStyleUpdate) {
        working = applyCoachingStyleUpdate(
          working,
          coachingStyleUpdate,
          todayDateString(timezone, new Date()),
          traceId,
        );
      }
      if (hasSportsUpdate) {
        working = applySportsUpdate(
          working,
          sportsUpdate,
          todayDateString(timezone, new Date()),
          traceId,
        );
      }
      return working as string;
    },
  };
}
