// injury_flag / injury_event: the injuries.json write - see coachIntents.ts's applyInjuryFlag
// (new injury, server mints id) and applyInjuryEvent (update/resolve an existing one, flag_id
// required) for the pure logic this wraps with I/O. Combined into one write function because
// both act on the same file and commitFilesAtomic does not merge duplicate paths (same
// constraint as the profile_update + coach_since merge in coachTurn.ts) - two separate
// ResolvedFileWrite objects for INJURIES_PATH in the same turn would silently drop one.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import {
  applyInjuryFlag,
  applyInjuryEvent,
  type InjuryFlagInput,
  type InjuryEvent,
} from "../coachIntents.js";
import { INJURIES_PATH } from "../coachMemoryFiles.js";
import { capText, INJURY_FLAG_TEXT_CAP } from "../text-caps.bundle.js";

export function buildInjuryWrites(
  repo: string,
  token: string,
  timezone: string,
  newInjuries: InjuryFlagInput[],
  injuryEvents: InjuryEvent[],
): ResolvedFileWrite | undefined {
  if (newInjuries.length === 0 && injuryEvents.length === 0) return undefined;
  const cappedNewInjuries = newInjuries.map((injury) => ({
    text: capText(injury.text, INJURY_FLAG_TEXT_CAP),
  }));
  const cappedEvents = injuryEvents.map((event) =>
    event.text != null ? { ...event, text: capText(event.text, INJURY_FLAG_TEXT_CAP) } : event,
  );
  return {
    path: INJURIES_PATH,
    resolve: async () => {
      const today = todayDateString(timezone, new Date());
      const current = await getFileRaw(repo, INJURIES_PATH, token);
      const afterNew = applyInjuryFlag(current, cappedNewInjuries, today);
      return applyInjuryEvent(afterNew, cappedEvents, today);
    },
  };
}
