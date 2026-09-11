/**
 * D1 layer 3 (#736): pre-validate referential-id actions before any write is built, instead of
 * relying on the applier's own throw-inside-commitFilesAtomic's-blob-resolve-closure guard
 * (coachIntents.ts's applyQuestEvent/applyInjuryEvent; coachWorkoutFiles.ts's
 * applyTemplateEdit/applySessionPlan; coachWeekFiles.ts's applySessionReconcile/applyPlanEdit) to
 * abort the whole atomic commit on one bad reference. By the time a reply reaches buildTurnWrites
 * it has already passed layer 1's enum-constrained generation and layer 2's one-shot corrective
 * retry (coachTurn.ts) - what's left here is the rare id that still doesn't resolve (a
 * stale/hallucinated one, or the underlying file changed between context load and reply).
 * Filtering here, before the write is ever built, means the applier's own throw guard should
 * never fire in normal operation; it stays in place purely as defense in depth.
 */
import type { QuestEvent, InjuryEvent } from "../coachIntents.js";
import type { applyTemplateEdit, applySessionPlan } from "../coachWorkoutFiles.js";
import type { SessionReconcileEvent, PlanEditEvent } from "../coachWeekFiles.js";

type TemplateEdit = Parameters<typeof applyTemplateEdit>[1];
type SessionPlanEdit = Omit<Parameters<typeof applySessionPlan>[1], "session_date">;

export interface DroppedAction {
  field: string;
  reason: string;
  // "validation" (default when absent): a single bad reference (stale quest_id/flag_id/etc) -
  // that one field dropped, everything else in the turn committed fine. "commit_failure": the
  // whole atomic commit for this turn's facts never landed (infra failure, not a bad reference) -
  // the data is genuinely gone, not "skipped", and unlike a validation drop it can't be folded
  // into this turn's own coach_note (commitTurn discovers it after buildTurnWrites already
  // decided what to write). Client-facing copy needs to say something different for each.
  kind?: "validation" | "commit_failure";
}

export function validateQuestEvents(
  events: QuestEvent[],
  validQuestIds: ReadonlySet<string>,
): { valid: QuestEvent[]; dropped: DroppedAction[] } {
  const valid: QuestEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validQuestIds.has(event.quest_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "quest_event",
        reason: `no quest with id "${event.quest_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}

export function validateInjuryEvents(
  events: InjuryEvent[],
  validFlagIds: ReadonlySet<string>,
): { valid: InjuryEvent[]; dropped: DroppedAction[] } {
  const valid: InjuryEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validFlagIds.has(event.flag_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "injury_event",
        reason: `no injury flag with id "${event.flag_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}

// template_edit is a single object, not an array (Gemini reports at most one per turn) - the
// valid/dropped shape mirrors validateQuestEvents/validateInjuryEvents anyway so the two build
// functions (buildTemplateEditWrite/buildSessionPlanWrite) still just get "the thing, or
// undefined" the same way they already accept an absent field.
export function validateTemplateEdit(
  edit: TemplateEdit | undefined,
  validTemplateIds: ReadonlySet<string>,
): { valid: TemplateEdit | undefined; dropped: DroppedAction[] } {
  if (!edit) return { valid: undefined, dropped: [] };
  if (validTemplateIds.has(edit.template_id)) return { valid: edit, dropped: [] };
  return {
    valid: undefined,
    dropped: [
      {
        field: "template_edit",
        reason: `no template with id "${edit.template_id}" - it may be stale or hallucinated`,
      },
    ],
  };
}

export function validateSessionPlan(
  plan: SessionPlanEdit | undefined,
  validTemplateIds: ReadonlySet<string>,
): { valid: SessionPlanEdit | undefined; dropped: DroppedAction[] } {
  if (!plan) return { valid: undefined, dropped: [] };
  if (validTemplateIds.has(plan.template_id)) return { valid: plan, dropped: [] };
  return {
    valid: undefined,
    dropped: [
      {
        field: "session_plan",
        reason: `no template with id "${plan.template_id}" - it may be stale or hallucinated`,
      },
    ],
  };
}

export function validateSessionReconcile(
  events: SessionReconcileEvent[],
  validSessionIds: ReadonlySet<string>,
): { valid: SessionReconcileEvent[]; dropped: DroppedAction[] } {
  const valid: SessionReconcileEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validSessionIds.has(event.session_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "session_reconcile",
        reason: `no session with id "${event.session_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}

export function validatePlanEdit(
  events: PlanEditEvent[],
  validSessionIds: ReadonlySet<string>,
): { valid: PlanEditEvent[]; dropped: DroppedAction[] } {
  const valid: PlanEditEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validSessionIds.has(event.session_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "plan_edit",
        reason: `no session with id "${event.session_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}
