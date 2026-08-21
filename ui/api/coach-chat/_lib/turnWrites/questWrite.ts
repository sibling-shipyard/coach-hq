// quest_event / quest_create: progress.json and quests.json writes - see coachIntents.ts for the
// pure appliers this wraps with I/O. Two functions, not one, because they land on different
// files and fire independently (a turn can log progress without creating a quest, or vice versa).
import type { FileEntry } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import { applyQuestEvent, applyQuestCreate, type QuestEvent } from "../coachIntents.js";
import { PROGRESS_PATH, QUESTS_PATH } from "../coachQuestFiles.js";

export function buildQuestEventWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  questEvents: QuestEvent[],
  currentSeasonId: string,
  validQuestIds: ReadonlySet<string>,
): FileEntry | undefined {
  if (questEvents.length === 0) return undefined;
  return {
    path: PROGRESS_PATH,
    resolve: async () =>
      applyQuestEvent(
        await getFileRaw(repo, PROGRESS_PATH, token),
        questEvents,
        todayDateString(timezone, new Date()),
        currentSeasonId,
        traceId,
        new Date(),
        validQuestIds,
      ),
  };
}

export function buildQuestCreateWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  questCreate: Parameters<typeof applyQuestCreate>[1] | undefined,
): FileEntry | undefined {
  if (!questCreate || (!questCreate.main_quest && (questCreate.quests?.length ?? 0) === 0)) {
    return undefined;
  }
  return {
    path: QUESTS_PATH,
    resolve: async () =>
      applyQuestCreate(
        await getFileRaw(repo, QUESTS_PATH, token),
        questCreate,
        todayDateString(timezone, new Date()),
        traceId,
        new Date(),
      ),
  };
}
