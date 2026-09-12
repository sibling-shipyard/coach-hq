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

// A2 (#727): workout_create - builds the new routine's file write plus the manifest append, or
// reports invariant 1/2/7/8's throw as a dropped action, same "one bad action, not the whole
// turn" discipline as validateActions.ts's own functions. Returns two writes (the routine file
// and the manifest), not one - unlike template_edit/session_plan above, this action touches the
// manifest itself.
export function buildWorkoutCreateWrite(
  traceId: string,
  spec: WorkoutCreateSpec | undefined,
  existingRoutineIds: ReadonlySet<string>,
  activeInjuryFlagIds: ReadonlySet<string>,
  progressions: ProgressionsJson | null,
): { writes: FileEntry[]; dropped: DroppedAction[] } {
  if (!spec) return { writes: [], dropped: [] };
  try {
    const { id, content } = applyWorkoutCreate(
      spec,
      existingRoutineIds,
      activeInjuryFlagIds,
      progressions,
      traceId,
    );
    return {
      writes: [
        { path: templatePath(id), content },
        {
          path: TEMPLATES_MANIFEST_PATH,
          content: buildManifestContent([...existingRoutineIds, id], traceId),
        },
      ],
      dropped: [],
    };
  } catch (err) {
    return {
      writes: [],
      dropped: [
        { field: "workout_create", reason: err instanceof Error ? err.message : String(err) },
      ],
    };
  }
}

// A2 (#727): workout_remove - deletes the routine file and drops its manifest entry, or reports
// an unknown routine_id as a dropped action. progressions.json is deliberately untouched (see
// applyWorkoutRemove's own comment).
export function buildWorkoutRemoveWrite(
  traceId: string,
  remove: { routine_id: string } | undefined,
  existingRoutineIds: ReadonlySet<string>,
): { writes: FileEntry[]; dropped: DroppedAction[] } {
  if (!remove?.routine_id) return { writes: [], dropped: [] };
  try {
    const { remainingIds } = applyWorkoutRemove(remove.routine_id, existingRoutineIds);
    return {
      writes: [
        { path: templatePath(remove.routine_id), delete: true },
        { path: TEMPLATES_MANIFEST_PATH, content: buildManifestContent(remainingIds, traceId) },
      ],
      dropped: [],
    };
  } catch (err) {
    return {
      writes: [],
      dropped: [
        { field: "workout_remove", reason: err instanceof Error ? err.message : String(err) },
      ],
    };
  }
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
