// season_start: the seasons.json write - see coachIntents.ts's applySeasonStart for the pure
// season-mint logic this wraps with I/O.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { applySeasonStart } from "../coachIntents.js";
import { SEASONS_PATH } from "../coachQuestFiles.js";

export function buildSeasonStartWrite(
  repo: string,
  token: string,
  traceId: string,
  seasonStart: Parameters<typeof applySeasonStart>[1] | undefined,
): ResolvedFileWrite | undefined {
  if (!seasonStart?.name?.trim()) return undefined;
  return {
    path: SEASONS_PATH,
    resolve: async () =>
      applySeasonStart(
        await getFileRaw(repo, SEASONS_PATH, token),
        seasonStart,
        traceId,
        new Date(),
      ),
  };
}
