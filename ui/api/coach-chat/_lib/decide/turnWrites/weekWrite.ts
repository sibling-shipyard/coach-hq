// week_plan / session_reconcile / plan_edit: the current_week.json write - see coachWeekFiles.ts
// for the appliers this wraps with I/O. One FileEntry because all three target the same file and
// (per the console.warn below) are mutually exclusive within a single turn.
import type { FileEntry } from "../../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import {
  applyWeekPlan,
  applySessionReconcile,
  applyPlanEdit,
  assertCurrentWeekCommitReady,
  CURRENT_WEEK_PATH,
  type WeekPlan,
  type SessionReconcileEvent,
  type PlanEditEvent,
} from "../coachWeekFiles.js";

export function buildCurrentWeekWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  weekPlan: WeekPlan | undefined,
  sessionReconcileEvents: SessionReconcileEvent[],
  planEditEvents: PlanEditEvent[],
  validTemplateIds: ReadonlySet<string>,
): FileEntry | undefined {
  const weekPlanRequested = Boolean(
    weekPlan?.headline?.trim() && weekPlan.body?.trim() && weekPlan.days?.length === 7,
  );

  if (weekPlanRequested) {
    if (sessionReconcileEvents.length > 0 || planEditEvents.length > 0) {
      console.warn(
        "[coach-chat] week_plan and session_reconcile/plan_edit both set - dropping the latter because their ids reference the old week",
        { traceId },
      );
    }
    return {
      path: CURRENT_WEEK_PATH,
      content: assertCurrentWeekCommitReady(
        applyWeekPlan(weekPlan!, validTemplateIds, timezone, traceId, new Date()),
      ),
    };
  }

  if (sessionReconcileEvents.length === 0 && planEditEvents.length === 0) return undefined;

  return {
    path: CURRENT_WEEK_PATH,
    resolve: async () => {
      let working = await getFileRaw(repo, CURRENT_WEEK_PATH, token);
      if (sessionReconcileEvents.length > 0) {
        working = applySessionReconcile(
          working,
          sessionReconcileEvents,
          validTemplateIds,
          traceId,
          new Date(),
        );
      }
      if (planEditEvents.length > 0) {
        working = applyPlanEdit(working, planEditEvents, validTemplateIds, traceId, new Date());
      }
      return assertCurrentWeekCommitReady(working as string);
    },
  };
}
