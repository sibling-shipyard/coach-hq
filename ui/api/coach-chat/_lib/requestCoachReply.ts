import { getFileRaw } from "./decide/coachChatFiles.js";
import {
  validTemplateIdsFromManifest,
  TEMPLATES_MANIFEST_PATH,
} from "./decide/coachWorkoutFiles.js";
import { CURRENT_WEEK_PATH, weekSessionsFromCurrentWeek } from "./decide/coachWeekFiles.js";
import { askLlm } from "./llm/coachLlmClient.js";
import { sumUsage, type LlmUsage } from "../../_lib/sentry.js";
import {
  captureLlmFailure,
  captureServerException,
  captureStillUnresolvedGuard,
} from "../../_lib/sentry.js";
import {
  activeTemplatesContext,
  activeWeekSessionsContext,
  combineExtraContext,
  firstSessionContext,
} from "./llm/coachPromptText.js";
import type { LlmReply, TurnMode } from "./llm/coachReplySchema.js";
import { FIRST_SESSION_PROTOCOL } from "../../_generated/soul.js";
import type { DroppedAction } from "./decide/turnWrites/validateActions.js";
import type { TurnState } from "./turnRequest.js";
import {
  findOversizedTextField,
  missingRequiredCoachNote,
  findUnrecordedFacts,
  findMissedInjuryLanguage,
  findMissedHabitLanguage,
  findMissedNewHabitLanguage,
  findMissedSeasonLanguage,
  findMissedProfileLanguage,
  findMissedRemovalLanguage,
  findMissedSportsLanguage,
  findMissedWorkoutCreateLanguage,
  findMissedTemplateEditLanguage,
  findMissedSessionPlanLanguage,
  findMissedInjuryUpdateLanguage,
  findMissedQuestLanguage,
  findUncountedInjuryLanguage,
  findUnconfirmedAssumption,
  findMalformedWorkoutCreateExercises,
  findWorkoutCreateProgressionViolations,
  isProseOnlyWeekPlan,
  findMissingWorkoutCreateInjuryAck,
  findInvalidReferences,
  friendlyLlmErrorMessage,
} from "./turnReplyValidation.js";

export interface RepliedTurn extends TurnState {
  reply: LlmReply;
  // Fetched in requestCoachReply, before askLlm, so the prompt can supply real template/
  // session ids (Finding A, OpenRouter K1 retest - see requestCoachReply's own comment). Carried
  // forward here so buildTurnWrites reuses this same read for validation instead of fetching
  // twice. Undefined on a first-session turn, where it's never fetched at all.
  prefetchedTemplatesManifestContent?: string | null;
  prefetchedCurrentWeekContent?: string | null;
  // Finding E (2026-09-10 pro baseline): facts the model's own self-audit still flags as
  // unrecorded even after the one-shot reprompt already fired - the model confabulated a false
  // refusal instead of complying, confirmed live, twice, on two different repos. buildTurnWrites
  // uses this as a last-resort signal to deterministically synthesize an unambiguous quest_event
  // itself, rather than trusting a third model call that's already shown it won't comply.
  stillUnrecordedFacts?: string[] | null;
  // Bug 3 Primary (2026-09-10 pro baseline): the pending question from last turn, still
  // unresolved after this turn's reprompt fired. buildTurnWrites drops a patch-shaped
  // week_update/template_edit/session_plan entirely this turn when this is set - silence
  // defaults to "don't overwrite," not "assume."
  stillUnconfirmedAssumption?: string | null;
  // #1070: true when isProseOnlyWeekPlan still fires after the one-shot reprompt - the reply
  // narrates a full week's plan but week_update never got set, even on the second try.
  // buildTurnWrites appends an honest correction to the athlete-facing reply when this is set,
  // same same-turn-visibility reasoning as formatDroppedActionsCorrection below. Before this
  // fix, a still-unresolved case only reached console.warn/captureStillUnresolvedGuard - telemetry
  // the athlete never sees - so they'd read a full week plan that was never actually saved with no
  // indication anything went wrong (live-reproduced on coach-akash-suresh, traceId tkxjxkzd).
  stillProseOnlyWeekPlan?: boolean;
  // True when the reply claims a new routine was built but no workout action landed, even after
  // the reprompt. buildTurnWrites appends an honest correction, same reasoning as above.
  stillMissedWorkoutCreate?: boolean;
  // Same shape as stillMissedWorkoutCreate, for a permanent routine edit claimed but never written.
  stillMissedTemplateEdit?: boolean;
  // Same shape again, for a today-only session change claimed but never written.
  stillMissedSessionPlan?: boolean;
  // #1053 gap 2: real token usage summed across every askLlm() call this turn made (the first
  // call plus up to two reprompts - content-violation and bad-reference). Additive-only field, so
  // every caller still typed against a plain RepliedTurn/TurnWrites keeps working; nothing that
  // persists a turn's reply spreads the whole object into committed athlete data, so this never
  // reaches a file write. See usageResponseInit() below for how a test harness reads it back, via
  // a response header - deliberately not part of commitTurn's athlete-facing JSON response body.
  usage?: LlmUsage;
}

// sumUsage now lives in sentry.ts (next to LlmUsage itself, imported above) so
// coachLlmClient.ts's own JSON-parse retry can reuse the exact same merge instead of hand-rolling a
// second copy - re-exported here so sumUsage.test.ts's existing import keeps working unchanged.
export { sumUsage };

/**
 * #1053 gap 2 (revised after review): a turn's real summed usage, surfaced as a response header
 * instead of module-level state - a plain module variable is unsafe if a warm serverless instance
 * ever processes two requests concurrently (nothing reads it in production today, but a later
 * feature easily could, and the bug would be silent - one athlete's cost attributed to another's
 * turn). A header carried on the real per-request Response object has no such risk: it's scoped
 * to that one response, same as any other response data.
 *
 * Gated behind two independent checks, both required: COACH_CHAT_EXPOSE_USAGE=1 (set only by the
 * local test harness, run-manual-coach-chat-test.ts) AND VERCEL_ENV !== "production" (Vercel
 * stamps this itself - nobody sets it by hand, so it can't be copy-pasted into place the way an
 * env var can). A real athlete's response only ever skips the header if both checks pass, so one
 * misconfigured var alone - a stray .env.local value, a stale preview override - can't leak
 * internal cost/token data into production traffic. Internal token/cost telemetry still doesn't
 * belong in the response BODY (athlete-facing JSON) either way, which is why this is a header,
 * not a field alongside `reply`/`threadId`.
 */
export const TURN_USAGE_HEADER = "x-coach-chat-turn-usage";

export function usageResponseInit(
  usage: LlmUsage | undefined,
  init: ResponseInit = {},
): ResponseInit {
  const exposeRequested = process.env.COACH_CHAT_EXPOSE_USAGE === "1";
  const isProduction = process.env.VERCEL_ENV === "production";
  if (!exposeRequested || isProduction || !usage) return init;
  const headers = new Headers(init.headers);
  headers.set(TURN_USAGE_HEADER, JSON.stringify(usage));
  return { ...init, headers };
}

export async function requestCoachReply(turn: TurnState): Promise<Response | RepliedTurn> {
  const mode: TurnMode = "ordinary";
  // Finding A (OpenRouter K1 retest): a patch-shaped week_update/template_edit were silently
  // no-op-ing while the reply still claimed success, because this prompt never told the model any
  // real template_id/session_id to reference - activeTemplatesContext/activeWeekSessionsContext
  // existed but were only ever called from activitySyncTurn.ts, a different turn path entirely.
  // Caught between "you may use this field" and "never invent an id" (coachPromptText.ts's own
  // instruction), the model either hallucinated one or self-censored the action field outright.
  //
  // Fetched on every non-first-session ordinary turn, not just when the message looks like it
  // might need it - detecting "might reference a session" from free text is exactly the kind of
  // guess this bug already showed the model getting wrong, and both reads are small, single-file
  // GitHub gets that buildTurnWrites already pays later on any turn that actually uses them.
  // Skipped on a first-session turn: the prompt already tells a first-session athlete these fields
  // never apply (no templates/week plan exist yet), so fetching would just be two reads nothing
  // downstream ever looks at.
  let templatesManifestContent: string | null | undefined;
  let currentWeekContent: string | null | undefined;
  if (!turn.firstSession) {
    // Soft reads: same contract as getHeadShaOrNull (404 quiet; else capture once → null).
    // Inlined at each site — do not add getFileRawOrNull.
    [templatesManifestContent, currentWeekContent] = await Promise.all([
      (async () => {
        try {
          return await getFileRaw(
            turn.repo,
            TEMPLATES_MANIFEST_PATH,
            turn.token,
            undefined,
            turn.currentSha ?? undefined,
          );
        } catch (err: unknown) {
          const status = (err as { status?: number }).status;
          if (status === 404) return null;
          await captureServerException(err);
          return null;
        }
      })(),
      (async () => {
        try {
          return await getFileRaw(
            turn.repo,
            CURRENT_WEEK_PATH,
            turn.token,
            undefined,
            turn.currentSha ?? undefined,
          );
        } catch (err: unknown) {
          const status = (err as { status?: number }).status;
          if (status === 404) return null;
          await captureServerException(err);
          return null;
        }
      })(),
    ]);
  }
  const extraContext = combineExtraContext(
    firstSessionContext(turn.firstSession, FIRST_SESSION_PROTOCOL),
    activeTemplatesContext(validTemplateIdsFromManifest(templatesManifestContent ?? null)),
    activeWeekSessionsContext(weekSessionsFromCurrentWeek(currentWeekContent ?? null)),
  );
  const referenceIds = {
    questIds: [...(turn.validQuestIds ?? [])],
    injuryFlagIds: [...(turn.validInjuryFlagIds ?? [])],
    activeInjuryFlagIds: [...(turn.activeInjuryFlagIds ?? [])],
  };
  try {
    let reply = await askLlm(
      turn.apiKey,
      turn.context.soul!,
      turn.athleteContext,
      turn.questContext,
      turn.priorMessages,
      turn.athleteMessage,
      mode,
      turn.firstSession,
      extraContext,
      turn.traceId,
      turn.timezone,
      referenceIds,
    );
    let usageAccum: LlmUsage | undefined = reply.usage;
    // Content-triggered retry, not a transport one (that's coachLlmClient.ts's own retry on
    // timeout/rate-limit) - kept as its own explicit step here. Exactly one reprompt attempt,
    // covering both content violations findOversizedTextField and missingRequiredCoachNote can
    // find - a turn could in principle trip both at once, and one combined reprompt naming both
    // problems costs the same one extra call as fixing either alone, instead of two sequential
    // reprompts doubling latency. If the reprompt doesn't fully fix it, layer 3's capText
    // backstop in turnWrites/* handles the size side and the missing-note side is simply
    // accepted as-is (no note ever silently invented from nothing).
    const violation = findOversizedTextField(reply);
    const missingNote = missingRequiredCoachNote(reply);
    const unrecordedFacts = findUnrecordedFacts(reply);
    const missedInjuryLanguage = findMissedInjuryLanguage(turn, reply);
    const missedHabitLanguage = findMissedHabitLanguage(turn, reply);
    const missedNewHabitLanguage = findMissedNewHabitLanguage(turn, reply);
    const missedSeasonLanguage = findMissedSeasonLanguage(turn, reply);
    const missedProfileLanguage = findMissedProfileLanguage(turn, reply);
    const missedRemovalLanguage = findMissedRemovalLanguage(turn, reply);
    const missedSportsLanguage = findMissedSportsLanguage(turn, reply);
    const missedWorkoutCreateLanguage = findMissedWorkoutCreateLanguage(turn, reply);
    const missedTemplateEditLanguage = findMissedTemplateEditLanguage(turn, reply);
    const missedSessionPlanLanguage = findMissedSessionPlanLanguage(turn, reply);
    const missedInjuryUpdateLanguage = findMissedInjuryUpdateLanguage(turn, reply);
    const missedQuestLanguage = findMissedQuestLanguage(turn, reply);
    const uncountedInjuryLanguage = findUncountedInjuryLanguage(turn, reply);
    const unconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
    const malformedExercises = findMalformedWorkoutCreateExercises(reply);
    const workoutCreateProgressionViolations = findWorkoutCreateProgressionViolations(turn, reply);
    const proseOnlyWeekPlan = isProseOnlyWeekPlan(reply, turn.firstSession);
    const missingWorkoutCreateInjuryAck = findMissingWorkoutCreateInjuryAck(turn, reply);
    // Finding E: set only when the reprompt below actually fires and unrecordedFacts is still
    // present afterward - the last-resort synthesis signal buildTurnWrites uses (see
    // RepliedTurn.stillUnrecordedFacts).
    let stillUnrecordedFactsForSynthesis: string[] | null = null;
    // Bug 3 Primary: set when the reprompt fires and the assumption is still unresolved after it -
    // buildTurnWrites drops any schedule-changing action this turn when this is set (see
    // RepliedTurn.stillUnconfirmedAssumption).
    let stillUnconfirmedAssumptionForDrop: string | null = null;
    // #1070: set when the reprompt fires and isProseOnlyWeekPlan is still true afterward -
    // buildTurnWrites appends an athlete-facing correction when this is set (see
    // RepliedTurn.stillProseOnlyWeekPlan).
    let stillProseOnlyWeekPlanForCorrection = false;
    let stillMissedWorkoutCreateForCorrection = false;
    let stillMissedTemplateEditForCorrection = false;
    let stillMissedSessionPlanForCorrection = false;
    if (
      violation ||
      missingNote ||
      unrecordedFacts ||
      missedInjuryLanguage ||
      missedHabitLanguage ||
      missedNewHabitLanguage ||
      missedSeasonLanguage ||
      missedProfileLanguage ||
      missedRemovalLanguage ||
      missedSportsLanguage ||
      missedWorkoutCreateLanguage ||
      missedTemplateEditLanguage ||
      missedSessionPlanLanguage ||
      missedInjuryUpdateLanguage ||
      missedQuestLanguage ||
      uncountedInjuryLanguage ||
      unconfirmedAssumption ||
      malformedExercises ||
      workoutCreateProgressionViolations ||
      proseOnlyWeekPlan ||
      missingWorkoutCreateInjuryAck
    ) {
      console.warn("[coach-chat] reply content violation, reprompting once:", {
        violation,
        missingNote,
        unrecordedFacts,
        missedInjuryLanguage,
        missedHabitLanguage,
        missedNewHabitLanguage,
        missedSeasonLanguage,
        missedProfileLanguage,
        missedRemovalLanguage,
        missedSportsLanguage,
        missedWorkoutCreateLanguage,
        missedTemplateEditLanguage,
        missedSessionPlanLanguage,
        missedInjuryUpdateLanguage,
        missedQuestLanguage,
        uncountedInjuryLanguage,
        unconfirmedAssumption,
        malformedExercises,
        workoutCreateProgressionViolations,
        proseOnlyWeekPlan,
        missingWorkoutCreateInjuryAck,
        traceId: turn.traceId,
      });
      const notes: string[] = [];
      if (violation) {
        notes.push(
          `your ${violation.field} was ${violation.length} characters, over the ${violation.cap}` +
            " character limit - redo just that field within budget",
        );
      }
      if (missingNote) {
        notes.push(
          "you produced a structured update this turn but no coach_note - a coach_note is" +
            " required whenever anything else changed, so add one summarizing it",
        );
      }
      if (unrecordedFacts) {
        notes.push(
          "your own unrecorded_facts flagged these as mentioned in reply/coach_note but not" +
            ` captured in an action field this turn: ${unrecordedFacts.join("; ")} - add each as` +
            " a real action field now, or if one genuinely doesn't apply, say so plainly instead" +
            " of implying it was saved",
        );
      }
      if (missedInjuryLanguage) {
        notes.push(
          `the athlete's message contains "${missedInjuryLanguage}" but no injury_flag was set` +
            " this turn - if a real injury was stated, add it now as injury_flag; if it genuinely" +
            " doesn't describe a real injury, disregard this note",
        );
      }
      if (missedHabitLanguage) {
        notes.push(
          `the athlete's message contains "${missedHabitLanguage}" but no habit was captured` +
            " this turn (via season_start.new_habits or quest_create) - if a real habit was" +
            " stated, add it now; if it genuinely doesn't describe a new habit, disregard this note",
        );
      }
      if (missedNewHabitLanguage) {
        notes.push(
          `the athlete's message contains "${missedNewHabitLanguage}" but no new habit quest was` +
            " captured this turn (via quest_create) - if the athlete is genuinely starting a new" +
            " habit, add it now as quest_create; if it genuinely just describes their existing" +
            " routine, disregard this note",
        );
      }
      if (missedSeasonLanguage) {
        notes.push(
          `the athlete's message contains "${missedSeasonLanguage}" but no season_start was set` +
            " this turn - if a real goal/season was stated, add it now as season_start; if it" +
            " genuinely doesn't describe a new goal or season, disregard this note",
        );
      }
      if (missedProfileLanguage) {
        notes.push(
          `the athlete's message contains "${missedProfileLanguage}" but no matching` +
            " profile_update was set this turn - if a real age, height, weight, or timezone was" +
            " stated, add it now as profile_update; if it genuinely doesn't describe a new" +
            " profile fact, disregard this note",
        );
      }
      if (missedRemovalLanguage) {
        notes.push(
          `the athlete's message contains "${missedRemovalLanguage}" but no workout_remove was` +
            " set this turn - if they genuinely asked to remove one of their real routines, add" +
            " it now with that routine's real id from context; if it genuinely doesn't describe a" +
            " removal request, disregard this note",
        );
      }
      if (missedSportsLanguage) {
        notes.push(
          `the athlete's message contains "${missedSportsLanguage}" but no sports_update was set` +
            " this turn - if a new or changed sport was genuinely stated, add it now as" +
            " sports_update with the full list; if it genuinely doesn't describe a new or changed" +
            " sport, disregard this note",
        );
      }
      if (missedWorkoutCreateLanguage) {
        notes.push(
          `the athlete's message contains "${missedWorkoutCreateLanguage}" and your reply says a` +
            " routine was built or saved, but no workout_create was set this turn - if a routine was" +
            " genuinely requested, add it now as workout_create with every phase and exercise; if" +
            " you are only proposing one, reword the reply so it doesn't claim it was saved",
        );
      }
      if (missedTemplateEditLanguage) {
        notes.push(
          `the athlete's message contains "${missedTemplateEditLanguage}" asking to permanently change` +
            " a routine, and your reply says the change was made, but no template_edit was set this" +
            " turn - if a permanent edit was genuinely requested, add it now as template_edit with" +
            " the routine's real id and the phase or exercise to remove; if you can't tell which" +
            " routine, ask instead and reword the reply so it doesn't claim the change was made",
        );
      }
      if (missedSessionPlanLanguage) {
        notes.push(
          `the athlete's message contains "${missedSessionPlanLanguage}" asking to change today's` +
            " session, and your reply says the change was made, but no session_plan was set this" +
            " turn - if a today-only change was genuinely requested, add it now as session_plan with" +
            " the routine's real id and the phase or exercise to skip; if you can't tell which" +
            " routine, ask instead and reword the reply so it doesn't claim the change was made",
        );
      }
      if (missedInjuryUpdateLanguage) {
        notes.push(
          `the athlete's message contains "${missedInjuryUpdateLanguage}" but no injury_event or` +
            " injury_flag was set this turn, and exactly one active injury flag is on file - if" +
            " this describes an update to that flag, add it now as injury_event with its real" +
            " flag_id; if it genuinely doesn't describe an injury update, disregard this note",
        );
      }
      if (missedQuestLanguage) {
        notes.push(
          `the athlete's message names these active quests with completion/miss/excusal` +
            ` language, but they have no quest_event this turn: ${missedQuestLanguage} - add a` +
            " quest_event now for each one that genuinely was completed, missed, or excused this" +
            " turn, using its real quest_id",
        );
      }
      if (uncountedInjuryLanguage) {
        notes.push(
          `the athlete's message contains "${uncountedInjuryLanguage}" but fewer injury_flag/` +
            "injury_event entries were set this turn than the message appears to describe - if a" +
            " real injury update or new injury was left out, add it now with the right field and" +
            " real flag_id; if this is the same injury already captured, disregard this note",
        );
      }
      if (unconfirmedAssumption) {
        notes.push(
          `you left this open last turn and never got a real answer to it: "${unconfirmedAssumption}"` +
            " - the athlete's message this turn doesn't clearly resolve it, so do not commit a" +
            " week_update/template_edit/session_plan based on an assumed answer;" +
            " ask again instead, or proceed only if the athlete's message genuinely does answer it",
        );
      }
      if (malformedExercises) {
        notes.push(
          `your workout_create has ${malformedExercises.length} structural problem(s): ` +
            `${malformedExercises.join("; ")} - a "reps" exercise needs a real reps number, a` +
            ' "timed" exercise needs a real duration_secs number; fix every one of those fields,' +
            " keep everything else the same",
        );
      }
      if (workoutCreateProgressionViolations) {
        notes.push(
          `your workout_create breaks ${workoutCreateProgressionViolations.length} dose rule(s)` +
            ` the server enforces: ${workoutCreateProgressionViolations.join("; ")} - fix each one` +
            " by lowering that exercise's reps or duration_secs (or sets) so its total dose is at or" +
            " below the progression's current value, or, if it is genuinely a new movement, give it a" +
            " new progression_id and set scaled_from; keep everything else the same",
        );
      }
      if (proseOnlyWeekPlan) {
        notes.push(
          "your reply describes a full week's plan (multiple named weekdays) but week_update" +
            " was never set - if you are genuinely committing this week now, set week_update with" +
            " the same days/sessions you just described; the athlete cannot see anything you only" +
            " wrote in the reply text",
        );
      }
      if (missingWorkoutCreateInjuryAck) {
        notes.push(
          `you set workout_create but left injury_ack missing or incomplete for these active` +
            ` injury flag(s): ${missingWorkoutCreateInjuryAck} - add an injury_ack entry (flag` +
            " and accommodation) for each one now, or the routine cannot be saved",
        );
      }
      const repromptMessage = [
        turn.athleteMessage,
        `\n[System note: ${notes.join("; also, ")}. Keep everything else the same.]`,
      ].join(" ");
      reply = await askLlm(
        turn.apiKey,
        turn.context.soul!,
        turn.athleteContext,
        turn.questContext,
        turn.priorMessages,
        repromptMessage,
        mode,
        turn.firstSession,
        extraContext,
        turn.traceId,
        turn.timezone,
        referenceIds,
      );
      usageAccum = sumUsage(usageAccum, reply.usage);
      // The reprompt is a request, not a guarantee either - if Gemini still overshoots, capText
      // in turnWrites/* will truncate silently downstream. Log it here so a persistent
      // oversize-then-truncate or still-missing-note pattern shows up somewhere instead of
      // vanishing silently.
      const stillOversized = findOversizedTextField(reply);
      const stillMissingNote = missingRequiredCoachNote(reply);
      const stillUnrecordedFacts = findUnrecordedFacts(reply);
      const stillMissedInjuryLanguage = findMissedInjuryLanguage(turn, reply);
      const stillMissedHabitLanguage = findMissedHabitLanguage(turn, reply);
      const stillMissedNewHabitLanguage = findMissedNewHabitLanguage(turn, reply);
      const stillMissedSeasonLanguage = findMissedSeasonLanguage(turn, reply);
      const stillMissedProfileLanguage = findMissedProfileLanguage(turn, reply);
      const stillMissedRemovalLanguage = findMissedRemovalLanguage(turn, reply);
      const stillMissedSportsLanguage = findMissedSportsLanguage(turn, reply);
      const stillMissedWorkoutCreateLanguage = findMissedWorkoutCreateLanguage(turn, reply);
      const stillMissedTemplateEditLanguage = findMissedTemplateEditLanguage(turn, reply);
      const stillMissedSessionPlanLanguage = findMissedSessionPlanLanguage(turn, reply);
      const stillMissedInjuryUpdateLanguage = findMissedInjuryUpdateLanguage(turn, reply);
      const stillMissedQuestLanguage = findMissedQuestLanguage(turn, reply);
      const stillUncountedInjuryLanguage = findUncountedInjuryLanguage(turn, reply);
      const stillUnconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
      const stillMalformedExercises = findMalformedWorkoutCreateExercises(reply);
      const stillWorkoutCreateProgressionViolations = findWorkoutCreateProgressionViolations(
        turn,
        reply,
      );
      const stillProseOnlyWeekPlan = isProseOnlyWeekPlan(reply, turn.firstSession);
      const stillMissingWorkoutCreateInjuryAck = findMissingWorkoutCreateInjuryAck(turn, reply);
      // Bug found live (2026-09-10): using the SECOND pass's own unrecorded_facts here was wrong
      // - the model stops self-flagging the miss on retry (it now believes its confabulated
      // excuse resolved it), even though the field still isn't captured. Carry forward the
      // FIRST pass's unrecordedFacts instead, unconditionally - it was the reliable detection,
      // and buildTurnWrites' own alreadyHandledQuestIds check already no-ops the synthesis safely
      // if the reprompt's second pass did, in fact, add a real quest_event.
      stillUnrecordedFactsForSynthesis = unrecordedFacts;
      stillUnconfirmedAssumptionForDrop = stillUnconfirmedAssumption;
      stillProseOnlyWeekPlanForCorrection = stillProseOnlyWeekPlan;
      stillMissedWorkoutCreateForCorrection = stillMissedWorkoutCreateLanguage !== null;
      stillMissedTemplateEditForCorrection = stillMissedTemplateEditLanguage !== null;
      stillMissedSessionPlanForCorrection = stillMissedSessionPlanLanguage !== null;
      if (
        stillOversized ||
        stillMissingNote ||
        stillUnrecordedFacts ||
        stillMissedInjuryLanguage ||
        stillMissedHabitLanguage ||
        stillMissedNewHabitLanguage ||
        stillMissedSeasonLanguage ||
        stillMissedProfileLanguage ||
        stillMissedRemovalLanguage ||
        stillMissedSportsLanguage ||
        stillMissedWorkoutCreateLanguage ||
        stillMissedTemplateEditLanguage ||
        stillMissedSessionPlanLanguage ||
        stillMissedInjuryUpdateLanguage ||
        stillMissedQuestLanguage ||
        stillUncountedInjuryLanguage ||
        stillUnconfirmedAssumption ||
        stillMalformedExercises ||
        stillWorkoutCreateProgressionViolations ||
        stillProseOnlyWeekPlan ||
        stillMissingWorkoutCreateInjuryAck
      ) {
        console.warn(
          "[coach-chat] reply still has a content violation after reprompt:",
          {
            stillOversized,
            stillMissingNote,
            stillUnrecordedFacts,
            stillMissedInjuryLanguage,
            stillMissedHabitLanguage,
            stillMissedNewHabitLanguage,
            stillMissedSeasonLanguage,
            stillMissedProfileLanguage,
            stillMissedRemovalLanguage,
            stillMissedSportsLanguage,
            stillMissedWorkoutCreateLanguage,
            stillMissedTemplateEditLanguage,
            stillMissedSessionPlanLanguage,
            stillMissedInjuryUpdateLanguage,
            stillMissedQuestLanguage,
            stillUncountedInjuryLanguage,
            stillUnconfirmedAssumption,
            stillMalformedExercises,
            stillWorkoutCreateProgressionViolations,
            stillProseOnlyWeekPlan,
            stillMissingWorkoutCreateInjuryAck,
          },
          { traceId: turn.traceId },
        );
        // #1009 Sentry gap: the block above was log-only for every detector, old and new - this
        // is the first thing to actually reach Sentry when a reprompt's fix doesn't hold.
        await captureStillUnresolvedGuard({
          traceId: turn.traceId,
          turnMode: mode,
          detectors: [
            stillOversized ? "oversizedField" : null,
            stillMissingNote ? "missingCoachNote" : null,
            stillUnrecordedFacts ? "unrecordedFacts" : null,
            stillMissedInjuryLanguage ? "missedInjuryLanguage" : null,
            stillMissedHabitLanguage ? "missedHabitLanguage" : null,
            stillMissedNewHabitLanguage ? "missedNewHabitLanguage" : null,
            stillMissedSeasonLanguage ? "missedSeasonLanguage" : null,
            stillMissedProfileLanguage ? "missedProfileLanguage" : null,
            stillMissedRemovalLanguage ? "missedRemovalLanguage" : null,
            stillMissedSportsLanguage ? "missedSportsLanguage" : null,
            stillMissedWorkoutCreateLanguage ? "missedWorkoutCreateLanguage" : null,
            stillMissedTemplateEditLanguage ? "missedTemplateEditLanguage" : null,
            stillMissedSessionPlanLanguage ? "missedSessionPlanLanguage" : null,
            stillMissedInjuryUpdateLanguage ? "missedInjuryUpdateLanguage" : null,
            stillMissedQuestLanguage ? "missedQuestLanguage" : null,
            stillUncountedInjuryLanguage ? "uncountedInjuryLanguage" : null,
            stillUnconfirmedAssumption ? "unconfirmedAssumption" : null,
            stillMalformedExercises ? "malformedExercises" : null,
            stillWorkoutCreateProgressionViolations ? "workoutCreateProgression" : null,
            stillProseOnlyWeekPlan ? "proseOnlyWeekPlan" : null,
            stillMissingWorkoutCreateInjuryAck ? "missingWorkoutCreateInjuryAck" : null,
          ].filter((detector): detector is string => detector !== null),
        });
      }
    }
    // unconfirmedAssumption truthy always triggers the reprompt block above (it's one of the OR
    // conditions), so stillUnconfirmedAssumptionForDrop is only ever left at its null default when
    // there was nothing to flag in the first place - no separate "reprompt never fired" case to
    // handle here.
    // D1 layer 2 (#736): same one-retry-cap discipline as the oversized-field reprompt above -
    // exactly one corrective call, named to this specific bad reference. Runs after the text-cap
    // reprompt (independent concerns, each capped at one retry, both stay inside the shared
    // 45s-per-call / 300s-function budget). Layer 3 drops it if this also comes back bad.
    const badReferences = findInvalidReferences(
      reply,
      turn.validQuestIds ?? new Set(),
      turn.validInjuryFlagIds ?? new Set(),
    );
    if (badReferences) {
      console.warn(
        "[coach-chat] reply referenced invalid id(s), reprompting once:",
        badReferences,
        { traceId: turn.traceId },
      );
      const badReferenceNotes = badReferences
        .map(
          (bad) =>
            `your ${bad.field} referenced id "${bad.badId}", which does not exist - the only` +
            ` valid ids are: ${bad.validIds.join(", ") || "(none)"}`,
        )
        .join("; also, ");
      const repromptMessage = [
        turn.athleteMessage,
        `\n[System note: ${badReferenceNotes}. Redo each field using only a valid id, or omit it`,
        "if none apply; keep everything else the same.]",
      ].join(" ");
      reply = await askLlm(
        turn.apiKey,
        turn.context.soul!,
        turn.athleteContext,
        turn.questContext,
        turn.priorMessages,
        repromptMessage,
        mode,
        turn.firstSession,
        extraContext,
        turn.traceId,
        turn.timezone,
        referenceIds,
      );
      usageAccum = sumUsage(usageAccum, reply.usage);
      const stillBad = findInvalidReferences(
        reply,
        turn.validQuestIds ?? new Set(),
        turn.validInjuryFlagIds ?? new Set(),
      );
      if (stillBad) {
        console.warn(
          "[coach-chat] reply still referenced invalid id(s) after reprompt, layer 3 will drop it:",
          stillBad,
          { traceId: turn.traceId },
        );
      }
    }
    return {
      ...turn,
      reply,
      prefetchedTemplatesManifestContent: templatesManifestContent,
      prefetchedCurrentWeekContent: currentWeekContent,
      stillUnrecordedFacts: stillUnrecordedFactsForSynthesis,
      stillUnconfirmedAssumption: stillUnconfirmedAssumptionForDrop,
      stillProseOnlyWeekPlan: stillProseOnlyWeekPlanForCorrection,
      stillMissedWorkoutCreate: stillMissedWorkoutCreateForCorrection,
      stillMissedTemplateEdit: stillMissedTemplateEditForCorrection,
      stillMissedSessionPlan: stillMissedSessionPlanForCorrection,
      usage: usageAccum,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[coach-chat] askLlm failed:", err);
    await captureLlmFailure(err, {
      traceId: turn.traceId,
      // coachLlmClient.ts tags the resolved adapter's real model onto the error before it
      // propagates here - falls back to "unknown" only if that never ran.
      model: (err as { model?: string }).model ?? "unknown",
      upstreamStatus: status,
      turnMode: mode,
      athleteMessage: turn.athleteMessage,
    });
    return Response.json(
      { error: friendlyLlmErrorMessage(status), traceId: turn.traceId },
      { status },
    );
  }
}

// D1: a short, plain-English coach_log.json row naming what got dropped this turn - not the raw
// `DroppedAction.reason` string (written for a Sentry/console reader), phrased instead as
// something Coach itself can read back next turn and act on naturally. Undefined when nothing
// was dropped, so it never adds an empty line to the combined coach_note.
export function formatDroppedActionsNote(droppedActions: DroppedAction[]): string | undefined {
  if (droppedActions.length === 0) return undefined;
  const fields = droppedActions.map((dropped) => dropped.field).join(", ");
  return `[System note: couldn't save an update this turn (${fields}) - the reference didn't match anything on file. If it's still relevant, check back in with the athlete and redo it.]`;
}

// akash retest finding: formatDroppedActionsNote above only reaches the athlete on the *next*
// turn (folded into coach_log.json context), by design - so a reply generated before validation
// ran could tell the athlete something was saved when it wasn't, for one whole turn. This is the
// same-turn fix: a short, plainly-system-authored correction appended to the reply actually sent
// back this turn, not a rewrite of the model's own prose (that's fragile string surgery on
// generated text) - just an honest addendum naming what didn't stick. Undefined when nothing was
// dropped, same as formatDroppedActionsNote.
// Live-verified (#727): this was hardcoded to claim every drop was "didn't match anything on
// file" - true for a stale quest_id/flag_id/template_id reference, false for a workout_create
// dropped over a structural validation failure (e.g. a model-omitted field), which read as an
// athlete-facing lie about why nothing saved. Never surfaces the raw internal reason text either
// (schema/field names an athlete has no reason to see) - just an honest, generic "something about
// that request didn't go through."
export function formatDroppedActionsCorrection(
  droppedActions: DroppedAction[],
): string | undefined {
  if (droppedActions.length === 0) return undefined;
  const fields = droppedActions.map((dropped) => dropped.field).join(", ");
  return `(Note: couldn't save ${fields} this turn - something about that request didn't go through. If it's still relevant, ask again.)`;
}

// #1070: same same-turn-visibility fix as formatDroppedActionsCorrection above, for a different
// failure shape - isProseOnlyWeekPlan caught the reply narrating a full week without ever setting
// week_update, and the one-shot reprompt in requestCoachReply still didn't fix it. Before this,
// a still-unresolved case only reached console.warn/captureStillUnresolvedGuard - telemetry, not
// the athlete - so they'd read a full week plan that was never actually saved with no indication
// anything went wrong. This appends an honest correction to the reply they actually see.
export function formatProseOnlyWeekPlanCorrection(
  stillProseOnlyWeekPlan: boolean,
): string | undefined {
  if (!stillProseOnlyWeekPlan) return undefined;
  return "(Note: the week plan above wasn't saved - ask again and I'll lock it in.)";
}

export function formatMissedWorkoutCreateCorrection(
  stillMissedWorkoutCreate: boolean,
): string | undefined {
  if (!stillMissedWorkoutCreate) return undefined;
  return "(Note: that routine wasn't saved - ask again and I'll build it properly.)";
}

export function formatMissedTemplateEditCorrection(
  stillMissedTemplateEdit: boolean,
): string | undefined {
  if (!stillMissedTemplateEdit) return undefined;
  return "(Note: that change to your routine wasn't saved - ask again and I'll make it.)";
}

export function formatMissedSessionPlanCorrection(
  stillMissedSessionPlan: boolean,
): string | undefined {
  if (!stillMissedSessionPlan) return undefined;
  return "(Note: that change to today's session wasn't saved - ask again and I'll set it up.)";
}

// Finding E: the athlete-facing counterpart to synthesizeQuestEventFromUnrecordedFacts - same
// same-turn-visibility reasoning as formatDroppedActionsCorrection above, but for the opposite
// case (something got auto-recorded on the athlete's behalf, not dropped). Surfaced so the
// athlete can immediately correct it if the synthesis guessed wrong, rather than a silent write
// they'd have no way to notice.
export function formatSynthesizedQuestEventNote(questName: string | undefined): string {
  return questName
    ? `(Logged "${questName}" as completed - let me know if that's not right.)`
    : "(Logged that as completed - let me know if that's not right.)";
}
