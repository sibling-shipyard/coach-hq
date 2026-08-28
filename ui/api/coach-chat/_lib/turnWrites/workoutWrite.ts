// template_edit / session_plan: template and session-snapshot writes - see coachWorkoutFiles.ts
// for the appliers this wraps with I/O.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw } from "../coachChatFiles.js";
import { todayDateString } from "../coachDay.js";
import {
  applyTemplateEdit,
  applySessionPlan,
  templatePath,
  sessionPath,
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
