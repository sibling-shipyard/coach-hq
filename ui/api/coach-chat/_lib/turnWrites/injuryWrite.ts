// injury_event: the injuries.json write - see coachIntents.ts's applyInjuryEvent for the pure
// flag-upsert logic this wraps with I/O.
import type { FileEntry } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import { applyInjuryEvent, type InjuryEvent } from "../coachIntents.js";
import { INJURIES_PATH } from "../coachMemoryFiles.js";

export function buildInjuryEventWrite(
  repo: string,
  token: string,
  timezone: string,
  injuryEvents: InjuryEvent[],
): FileEntry | undefined {
  if (injuryEvents.length === 0) return undefined;
  return {
    path: INJURIES_PATH,
    resolve: async () =>
      applyInjuryEvent(
        await getFileRaw(repo, INJURIES_PATH, token),
        injuryEvents,
        todayDateString(timezone, new Date()),
      ),
  };
}
