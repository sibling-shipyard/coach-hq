// season_start: the seasons.json + quests.json write pair - see coachIntents.ts's
// applySeasonStart for the pure season-and-goal logic this wraps with I/O. Two files because a
// new season and its main_quest are one atomic action (B3): the new season id has to reach both
// files, and the outgoing season's own main_quest (if any) needs to be read from quests.json to
// retire it correctly.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import { applySeasonStart, type SeasonStartResult } from "../coachIntents.js";
import { SEASONS_PATH, QUESTS_PATH } from "../coachQuestFiles.js";

export interface SeasonStartWrites {
  seasonWrite: ResolvedFileWrite;
  questWrite: ResolvedFileWrite;
}

// Both files share one computation - the new season and its main_quest share one minted
// season_id, so two independent resolvers would mint two different ids and desync the link.
// seasonWrite always resolves first (this pair's own array order at every call site below);
// its resolve() computes the pair fresh (re-reading both files' current HEAD content) and caches
// it, questWrite's resolve() reuses that cached result. The whole computation reruns on every
// commit retry because it's re-triggered each time seasonWrite.resolve() fires again - the same
// "recompute per attempt" freshness resolve()'s own doc comment promises for every other write.
export function buildSeasonStartWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  seasonStart: Parameters<typeof applySeasonStart>[2] | undefined,
): SeasonStartWrites | undefined {
  if (!seasonStart?.name?.trim() || !seasonStart.main_quest) return undefined;

  let cached: SeasonStartResult | null = null;
  const compute = async (): Promise<SeasonStartResult> => {
    const today = todayDateString(timezone, new Date());
    const [seasonsRaw, questsRaw] = await Promise.all([
      getFileRaw(repo, SEASONS_PATH, token),
      getFileRaw(repo, QUESTS_PATH, token),
    ]);
    cached = applySeasonStart(seasonsRaw, questsRaw, seasonStart, today, traceId, new Date());
    return cached;
  };

  return {
    seasonWrite: { path: SEASONS_PATH, resolve: async () => (await compute()).seasonsContent },
    questWrite: {
      path: QUESTS_PATH,
      resolve: () => {
        if (!cached) throw new Error("seasonWrite questWrite resolved out of order");
        return Promise.resolve(cached.questsContent);
      },
    },
  };
}
