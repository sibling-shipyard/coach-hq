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
import { isFullWeekKickoff, type WeekUpdate } from "../coachWeekFiles.js";

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

export interface ExistingSessionForDiff {
  id: string;
  discipline: string;
  kind: string;
}

// Bug 3 (2026-09-10 pro baseline, real diff-confirmed): validatePlanEdit/validateSessionReconcile
// below only ever checked that session_id exists - never whether the proposed new content is
// consistent with what's actually scheduled. A real conversation showed the coach itself ask a
// genuine clarifying question ("dropping football or doing both?"), never get an answer from the
// athlete's next message, then unilaterally overwrite a real scheduled football match with a
// recovery walk anyway - a real session_id, so the existence check above passed clean. This is a
// defense-in-depth layer independent of any cross-turn state (no "was a question asked" tracking
// needed): if a proposed edit changes a session's real *category* (discipline), and the athlete's
// own raw message this turn carries no affirmative confirmation cue, treat it as an unconfirmed
// assumption and drop it, same as a bad id. A same-day title/kind tweak within the same discipline
// is not gated - only a category swap needs confirming.
const CONFIRMATION_CUE_PATTERN =
  /\b(yes|yeah|yep|yup|confirm(?:ed)?|sounds good|go ahead|do it|that works|works for me|sure|drop (?:the|it)|swap (?:it|that|for)|instead of|correct)\b/gi;

// A negation shortly before a matched cue flips it into a refusal, not a confirmation - "I'm not
// sure, don't drop the football" matches "drop the" above but is explicitly saying the opposite.
// Checked against a short window right before the cue (same clause), not the whole message, so an
// unrelated negation earlier in a longer message can't falsely cancel out a real, later "yes".
const NEGATION_PATTERN =
  /\b(not|no|never|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|isn'?t|wasn'?t)\b/i;
const NEGATION_LOOKBACK_CHARS = 20;

// Exported so coachTurn.ts's findUnconfirmedAssumption (Bug 3 Primary - pending-clarification
// tracking) can reuse the exact same "does the athlete's raw message read as an answer" judgment
// this content-diff guard already uses, rather than a second, possibly-drifting keyword list.
export function hasConfirmationCue(athleteMessage: string): boolean {
  for (const match of athleteMessage.matchAll(CONFIRMATION_CUE_PATTERN)) {
    const start = match.index ?? 0;
    const precedingText = athleteMessage.slice(Math.max(0, start - NEGATION_LOOKBACK_CHARS), start);
    if (!NEGATION_PATTERN.test(precedingText)) return true;
  }
  return false;
}

function categoryChangeIsConfirmed(
  sessionId: string,
  proposedDiscipline: string,
  existingSessions: ReadonlyMap<string, ExistingSessionForDiff>,
  athleteMessage: string,
): boolean {
  const existing = existingSessions.get(sessionId);
  // No existing record to compare against (shouldn't happen once the id-existence check above
  // already passed, but fail open here - this guard's whole job is comparing content, not
  // re-deciding existence) or the category is unchanged - nothing to confirm either way. Same
  // null/type guard discipline as findUnrecordedFacts (coachTurn.ts) - the schema declares
  // discipline as a required string, but that's a request to Gemini, not a runtime guarantee.
  if (!existing || typeof proposedDiscipline !== "string") return true;
  if (existing.discipline.trim().toLowerCase() === proposedDiscipline.trim().toLowerCase()) {
    return true;
  }
  return hasConfirmationCue(athleteMessage);
}

// existingSessions/athleteMessage take no default value on purpose - an empty map and empty
// string both make categoryChangeIsConfirmed fail open (nothing to compare against, or no message
// text to find a cue in), so a caller must pass `new Map()`/`""` explicitly to opt out of the
// whole Bug 3 content-diff guard rather than disabling it by omission. Every real caller
// (buildTurnWrites) always has both.
//
// ADR 0039 replaces session_reconcile/plan_edit with one week_update field, sent as a sparse
// per-day/per-session patch. A full-week-kickoff-shaped update (isFullWeekKickoff) is the old
// week_plan case - it never references an existing session_id, so it passes through untouched; a
// patch-shaped update gets every session_id checked against validSessionIds and every category
// change checked against categoryChangeIsConfirmed, same guards session_reconcile/plan_edit used
// separately, now applied to whichever fields a single patch entry actually sets (a status change
// and a content change can land on the same entry - that's the point of the collapse).
export function validateWeekUpdate(
  update: WeekUpdate | undefined,
  validSessionIds: ReadonlySet<string>,
  existingSessions: ReadonlyMap<string, ExistingSessionForDiff>,
  athleteMessage: string,
): { valid: WeekUpdate | undefined; dropped: DroppedAction[] } {
  if (!update) return { valid: undefined, dropped: [] };
  if (isFullWeekKickoff(update)) return { valid: update, dropped: [] };

  const dropped: DroppedAction[] = [];
  const days = update.days
    .map((day) => ({
      ...day,
      sessions: (day.sessions ?? []).filter((session) => {
        if (!session.session_id) return true;
        if (!validSessionIds.has(session.session_id)) {
          dropped.push({
            field: "week_update",
            reason: `no session with id "${session.session_id}" - it may be stale or hallucinated`,
          });
          return false;
        }
        if (
          session.discipline !== undefined &&
          !categoryChangeIsConfirmed(
            session.session_id,
            session.discipline,
            existingSessions,
            athleteMessage,
          )
        ) {
          dropped.push({
            field: "week_update",
            reason:
              `session "${session.session_id}" would change category to "${session.discipline}"` +
              " with no confirmation in the athlete's message this turn - treating as an unconfirmed" +
              " assumption, not committing",
          });
          return false;
        }
        return true;
      }),
    }))
    .filter((day) => day.sessions.length > 0 || day.intent !== undefined);

  if (days.length === 0) return { valid: undefined, dropped };
  return { valid: { ...update, days }, dropped };
}

export interface QuestForSynthesis {
  id: string;
  name: string;
  status: "active" | "graduated" | "retired";
}

// Finding E (2026-09-10 pro baseline, reproduced live on two separate repos/quests/phrasings):
// coachTurn.ts's self-audit (unrecorded_facts) and its one-shot reprompt both correctly detect a
// quest completion the model narrated in reply/coach_note but never captured as a real
// quest_event - detection works every time. The model then confabulates a false refusal
// ("quest_event isn't in the schema," which is untrue - it's declared in RETURNING_ACTIONS) instead
// of complying, even after the reprompt names exactly what's missing. A maximally explicit manual
// follow-up was already tried live and still failed the same way - this is a compliance failure,
// not a detection one, so a third model call is not a promising next step. Deterministically
// synthesize the completion instead, but only when the match is genuinely unambiguous: the
// unrecorded fact reads as a completion claim, AND exactly one active quest's name is actually
// referenced in the fact text. A single remaining active quest with no name match at all is not
// treated as unambiguous by elimination - the fact could be about something else entirely (a
// completed chore, an unrelated task) that happens to use completion language, and writing that
// quest complete anyway would be a wrong completion in a real file, not a safe guess. Real
// ambiguity (several plausible quests, no name match) is left alone deliberately - the athlete's
// next turn can clarify - rather than guessing.
const QUEST_COMPLETION_LANGUAGE_PATTERN =
  /\b(complet(?:ed|ing)|done|finish(?:ed)?|hit|nailed|crushed|logged|achiev(?:ed|ing)|knocked out|wrapped up)\b/i;

// Escapes every regex metacharacter, not just the ones today's callers happen to strip first -
// this function must stay regex-safe against any string on its own, not only because a caller
// upstream currently sanitizes what it passes in.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function questNameReferencedIn(questName: string, factText: string): boolean {
  const words = questName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (words.length === 0) return false;
  const lowerFact = factText.toLowerCase();
  return words.every((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`).test(lowerFact));
}

export function synthesizeQuestEventFromUnrecordedFacts(
  unrecordedFacts: readonly string[] | null | undefined,
  activeQuests: readonly QuestForSynthesis[],
  alreadyHandledQuestIds: ReadonlySet<string>,
): QuestEvent | null {
  if (!unrecordedFacts || unrecordedFacts.length === 0) return null;
  const completionFacts = unrecordedFacts.filter((fact) =>
    QUEST_COMPLETION_LANGUAGE_PATTERN.test(fact),
  );
  if (completionFacts.length === 0) return null;

  const candidates = activeQuests.filter(
    (quest) => quest.status === "active" && !alreadyHandledQuestIds.has(quest.id),
  );
  if (candidates.length === 0) return null;

  const nameMatches = candidates.filter((quest) =>
    completionFacts.some((fact) => questNameReferencedIn(quest.name, fact)),
  );

  // A real name match is required unconditionally - see this function's header comment. A single
  // remaining active quest with no name match is not treated as the winner by elimination: the
  // fact could be about something else entirely ("finished packing my bags") that happens to use
  // completion language, and that quest is not the only thing it could plausibly be about.
  if (nameMatches.length !== 1) return null;

  return { quest_id: nameMatches[0].id, status: "completed" };
}
