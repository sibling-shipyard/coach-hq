// template_edit / session_plan / workout_create / workout_remove: template, session-snapshot, and
// routine writes - see coachWorkoutFiles.ts for the appliers this wraps with I/O.
import type { FileEntry, ResolvedFileWrite } from "../../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import type { ProgressionsJson } from "../coachQuestFiles.js";
import type { DroppedAction } from "./validateActions.js";
import {
  applyTemplateEdit,
  applySessionPlan,
  applyWorkoutCreate,
  applyWorkoutRemove,
  buildManifestContent,
  templatePath,
  sessionPath,
  TEMPLATES_MANIFEST_PATH,
  type WorkoutCreateSpec,
} from "../coachWorkoutFiles.js";

export function buildTemplateEditWrite(
  repo: string,
  token: string,
  traceId: string,
  templateEdit: Parameters<typeof applyTemplateEdit>[1] | undefined,
  validTemplateIds: ReadonlySet<string>,
): ResolvedFileWrite | undefined {
  if (!templateEdit?.template_id) return undefined;
  return {
    path: templatePath(templateEdit.template_id),
    resolve: async () =>
      applyTemplateEdit(
        await getFileRaw(repo, templatePath(templateEdit.template_id), token),
        templateEdit,
        validTemplateIds,
        traceId,
      ),
  };
}

// A2 (#727): workout_create and workout_remove, combined into one write function because both
// can touch TEMPLATES_MANIFEST_PATH in the same turn and commitFilesAtomic does not merge
// duplicate paths (same constraint injuryWrite.ts's buildInjuryWrites already documents for
// INJURIES_PATH) - two independent manifest writes here would let whichever lands last silently
// drop the other's change. Each action's own failure (invariant 1/2/7/8's throw, or an unknown
// routine_id) is still reported as its own dropped action, same "one bad action, not the whole
// turn" discipline as validateActions.ts's own functions - only the manifest write itself is
// shared.
export function buildWorkoutCreateAndRemoveWrites(
  traceId: string,
  create: WorkoutCreateSpec | undefined,
  remove: { routine_id: string } | undefined,
  existingRoutineIds: ReadonlySet<string>,
  activeInjuryFlagIds: ReadonlySet<string>,
  progressions: ProgressionsJson | null,
): { writes: FileEntry[]; dropped: DroppedAction[] } {
  const writes: FileEntry[] = [];
  const dropped: DroppedAction[] = [];
  const finalIds = new Set(existingRoutineIds);
  let manifestNeeded = false;

  if (create) {
    try {
      const { id, content } = applyWorkoutCreate(
        create,
        existingRoutineIds,
        activeInjuryFlagIds,
        progressions,
        traceId,
      );
      writes.push({ path: templatePath(id), content });
      finalIds.add(id);
      manifestNeeded = true;
    } catch (err) {
      dropped.push({
        field: "workout_create",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (remove?.routine_id) {
    try {
      // Validates routine_id existed before this turn (the same hallucinated-id guard as
      // everything else in this file). finalIds is built here rather than from the applier's own
      // returned remainingIds, since it needs to reflect create's effect too when both actions
      // land in the same turn.
      applyWorkoutRemove(remove.routine_id, existingRoutineIds);
      writes.push({ path: templatePath(remove.routine_id), delete: true });
      finalIds.delete(remove.routine_id);
      manifestNeeded = true;
    } catch (err) {
      dropped.push({
        field: "workout_remove",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (manifestNeeded) {
    writes.push({
      path: TEMPLATES_MANIFEST_PATH,
      content: buildManifestContent([...finalIds], traceId),
    });
  }

  return { writes, dropped };
}

export function buildSessionPlanWrite(
  repo: string,
  token: string,
  timezone: string,
  traceId: string,
  sessionPlan: Omit<Parameters<typeof applySessionPlan>[1], "session_date"> | undefined,
  validTemplateIds: ReadonlySet<string>,
): ResolvedFileWrite | undefined {
  if (!sessionPlan?.template_id) return undefined;
  const sessionPlanDate = todayDateString(timezone, new Date());
  return {
    path: sessionPath(sessionPlanDate, sessionPlan.template_id),
    resolve: async () => {
      const fresh = await getFileRaw(repo, templatePath(sessionPlan.template_id), token);
      return applySessionPlan(
        fresh,
        { ...sessionPlan, session_date: sessionPlanDate },
        validTemplateIds,
        traceId,
      ).content;
    },
  };
}
