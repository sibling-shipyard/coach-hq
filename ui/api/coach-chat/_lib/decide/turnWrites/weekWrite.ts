// week_update: the current_week.json write - see coachWeekFiles.ts for applyWeekUpdate, the one
// applier this wraps with I/O (ADR 0042 replaced week_plan/session_reconcile/plan_edit with this
// single sparse-patch action).
import type { FileEntry } from "../../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import {
  applyWeekUpdate,
  assertCurrentWeekCommitReady,
  isFullWeekKickoff,
  CURRENT_WEEK_PATH,
  type WeekUpdate,
} from "../coachWeekFiles.js";

export function buildCurrentWeekWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  weekUpdate: WeekUpdate | undefined,
  validTemplateIds: ReadonlySet<string>,
  // coachTurn.ts already fetches current_week.json once to build the session_id set
  // validateWeekUpdate checks patch entries against before we get here - reusing that same read
  // here (instead of fetching it again) means what got validated is exactly what gets patched, no
  // race window between the two reads.
  prefetchedContent?: string | null,
): FileEntry | undefined {
  if (weekUpdate === undefined) return undefined;

  if (isFullWeekKickoff(weekUpdate)) {
    return {
      path: CURRENT_WEEK_PATH,
      content: assertCurrentWeekCommitReady(
        applyWeekUpdate(null, weekUpdate, validTemplateIds, timezone, traceId, new Date()),
      ),
    };
  }

  return {
    path: CURRENT_WEEK_PATH,
    resolve: async () => {
      const working =
        prefetchedContent !== undefined
          ? prefetchedContent
          : await getFileRaw(repo, CURRENT_WEEK_PATH, token);
      return assertCurrentWeekCommitReady(
        applyWeekUpdate(working, weekUpdate, validTemplateIds, timezone, traceId, new Date()),
      );
    },
  };
}
