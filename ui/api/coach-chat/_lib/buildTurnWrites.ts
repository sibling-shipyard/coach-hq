import { type FileEntry, type ResolvedFileWrite } from "../../_lib/githubGitData.js";
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import { getFileRaw } from "./decide/coachChatFiles.js";
import { todayDividerLabel, todayDateString } from "./decide/coachDay.js";
import { appendConversationTurn, type ChatMessage, type ChatThread } from "./chatThreads.js";
import { loadClosingFileContext, injectCoachSinceIfNeeded } from "./decide/coachSinceStamp.js";
import {
  validTemplateIdsFromManifest,
  TEMPLATES_MANIFEST_PATH,
} from "./decide/coachWorkoutFiles.js";
import { PROFILE_PATH, type ProfileJson, type MemoryJson } from "./decide/coachMemoryFiles.js";
import { captureServerException, captureValidationFailure } from "../../_lib/sentry.js";
import {
  validateQuestEvents,
  validateInjuryEvents,
  validateTemplateEdit,
  validateSessionPlan,
  validateWeekUpdate,
  synthesizeQuestEventFromUnrecordedFacts,
  hasConfirmationCue,
  type DroppedAction,
  type ExistingSessionForDiff,
} from "./decide/turnWrites/validateActions.js";
import {
  CURRENT_WEEK_PATH,
  weekSessionsFromCurrentWeek,
  weekDayDatesFromCurrentWeek,
  isFullWeekKickoff,
  applyWeekUpdate,
  assertCurrentWeekCommitReady,
  currentWeekNeedsRollover,
  buildRolloverPlaceholder,
} from "./decide/coachWeekFiles.js";
import { buildChatWrite } from "./decide/turnWrites/chatWrite.js";
import { buildCoachNoteWrite } from "./decide/turnWrites/coachNoteWrite.js";
import { buildMemoryFileWrite } from "./decide/turnWrites/memoryWrite.js";
import { buildInjuryWrites } from "./decide/turnWrites/injuryWrite.js";
import { buildQuestEventWrite, buildQuestCreateWrite } from "./decide/turnWrites/questWrite.js";
import { buildSeasonStartWrite } from "./decide/turnWrites/seasonWrite.js";
import { applyQuestCreate } from "./decide/coachSeasonQuestIntents.js";
import {
  buildProfileUpdateWrite,
  projectProfileCompletion,
} from "./decide/turnWrites/profileWrite.js";
import {
  buildTemplateEditWrite,
  buildSessionPlanWrite,
  buildWorkoutCreateAndRemoveWrites,
} from "./decide/turnWrites/workoutWrite.js";
import { buildCurrentWeekWrite } from "./decide/turnWrites/weekWrite.js";
import type { RepliedTurn } from "./requestCoachReply.js";
import {
  formatDroppedActionsNote,
  formatDroppedActionsCorrection,
  formatMissedSessionPlanCorrection,
  formatMissedWeekUpdateCorrection,
  formatMissedTemplateEditCorrection,
  formatMissedWorkoutCreateCorrection,
  formatProseOnlyWeekPlanCorrection,
  formatSynthesizedQuestEventNote,
} from "./requestCoachReply.js";
import { scheduleChangingFieldNames, synthesizeRequiredCoachNote } from "./turnReplyValidation.js";
import { formatPendingClarificationMarker } from "./turnRequest.js";
import { recordSilentFixup } from "./decide/silentFixups.js";

export interface TurnWrites extends RepliedTurn {
  chatWrite: ResolvedFileWrite;
  latestThreads: ChatThread[];
  finalThreadId: string;
  computedTitle: string;
  trimmedCoachNote?: string;
  /** akash retest finding: reply.reply is the model's raw, pre-validation text - this is what
   * actually gets committed to chat history and returned to the athlete, with a dropped-action
   * correction appended when one applies (formatDroppedActionsCorrection). commitTurn must use
   * this, not turn.reply.reply, or the athlete sees the stale claim for a whole turn. */
  finalReplyText: string;
  optionalWrites: FileEntry[];
  validUpdates: FileEntry[];
  wasProfileComplete: boolean;
  profileComplete: boolean;
  projectedProfile: ProfileJson;
  projectedMemory: MemoryJson;
  /** D1 (#736): actions layer 3 dropped rather than committing a bad reference. Firm requirement
   * per the LLD - surfaced in the response independent of whether Coach's own reply happens to
   * mention it, not left to "hope the model remembers." Empty when nothing was dropped. */
  droppedActions: DroppedAction[];
}

export async function buildTurnWrites(turn: RepliedTurn): Promise<TurnWrites> {
  const { repo, token, timezone, traceId, reply } = turn;
  const { profile, memory, seasons, quests } = turn.context;
  const modelCoachNote = reply.coach_note?.trim();

  // D1 layer 3 (#736): validate referential-id actions before any write is built - drop only the
  // specific bad action, never abort the whole batch. By this point the reply already survived
  // layer 1 (enum-constrained generation) and layer 2 (one corrective retry in
  // requestCoachReply), so a rejection here should be rare; it's still not skipped, per the
  // athlete's stated goal that a validation failure never silently costs other real data.
  const droppedActions: DroppedAction[] = [];

  const rawInjuryEvents = (reply.injury_event ?? []).filter(
    (event) => event.status != null && (event.flag_id?.trim().length ?? 0) > 0,
  );
  const { valid: injuryEvents, dropped: droppedInjuryEvents } = validateInjuryEvents(
    rawInjuryEvents,
    turn.validInjuryFlagIds,
  );
  droppedActions.push(...droppedInjuryEvents);

  const newInjuries = (reply.injury_flag ?? []).filter(
    (injury) => (injury.text?.trim().length ?? 0) > 0,
  );
  const injuryWrite = buildInjuryWrites(repo, token, timezone, newInjuries, injuryEvents, traceId);

  const { valid: validatedQuestEvents, dropped: droppedQuestEvents } = validateQuestEvents(
    reply.quest_event ?? [],
    turn.validQuestIds,
  );
  droppedActions.push(...droppedQuestEvents);

  // Finding E (2026-09-10 pro baseline): last-resort deterministic synthesis when the model's
  // own self-audit flagged a completion it never captured and the reprompt still didn't fix it -
  // see synthesizeQuestEventFromUnrecordedFacts's own comment for the full root-cause story.
  // Unambiguous only; genuine ambiguity is left alone.
  const alreadyHandledQuestIds = new Set(validatedQuestEvents.map((event) => event.quest_id));
  const synthesizedQuestEvent = synthesizeQuestEventFromUnrecordedFacts(
    turn.stillUnrecordedFacts,
    quests?.quests ?? [],
    alreadyHandledQuestIds,
  );
  const questEvents = synthesizedQuestEvent
    ? [...validatedQuestEvents, synthesizedQuestEvent]
    : validatedQuestEvents;
  const synthesizedQuest = synthesizedQuestEvent
    ? (quests?.quests ?? []).find((quest) => quest.id === synthesizedQuestEvent.quest_id)
    : undefined;
  if (synthesizedQuestEvent) {
    console.warn("[coach-chat] synthesized a quest_event the model itself failed to comply on:", {
      questId: synthesizedQuestEvent.quest_id,
      traceId,
    });
    recordSilentFixup(traceId, {
      kind: "quest_event_synthesized",
      action: "quest_event",
      detail: synthesizedQuestEvent.quest_id,
    });
  }

  const questEventWrite = buildQuestEventWrite(
    repo,
    token,
    timezone,
    traceId,
    questEvents,
    seasons?.current_season_id ?? "",
    turn.validQuestIds,
  );

  // C1: session artifacts (template_edit/session_plan/week_update) are available on every
  // returning-athlete turn, so their template_id references need validating here regardless of
  // which one fired. requestCoachReply already fetched the templates manifest before askLlm on
  // any non-first-session turn (Finding A fix, so the prompt itself can supply real ids) - reuse
  // that same read via turn.prefetchedTemplatesManifestContent instead of fetching it twice; only
  // a first-session turn (where that prefetch never ran) falls back to fetching here, and only
  // when actually needed.
  //
  // This block sits before the droppedActions loop below (not after, where it used to live) so a
  // hallucinated template_id/session_id gets folded into this turn's own dropped-actions loop and
  // coach_note, exactly like a bad quest_id/flag_id already does - same D1 layer 3 discipline:
  // validate every referential id before any write is built, not just quest/injury.
  // Bug 3 Primary (2026-09-10 pro baseline): a real conversation showed the coach ask a genuine
  // clarifying question, never get an answer, then unilaterally overwrite a real scheduled session
  // anyway. requestCoachReply's reprompt already tried to get this resolved; if it's still
  // unresolved by the time the reply reaches here, hold back every schedule-changing field this
  // turn rather than commit an assumption - silence defaults to "don't overwrite." A full-week-
  // kickoff-shaped week_update (a full rewrite, not tied to one disputed session) is deliberately
  // not gated here, same as week_plan never was.
  const blockScheduleChangesThisTurn = Boolean(turn.stillUnconfirmedAssumption);
  if (blockScheduleChangesThisTurn) {
    const blockedFields = scheduleChangingFieldNames(reply);
    if (blockedFields.length > 0) {
      droppedActions.push({
        field: blockedFields.join(", "),
        reason:
          `left "${turn.stillUnconfirmedAssumption}" unresolved from last turn and the athlete's` +
          " message this turn didn't clearly answer it - holding back the schedule change rather" +
          " than committing an assumption",
      });
    }
  }
  const effectiveTemplateEdit = blockScheduleChangesThisTurn ? undefined : reply.template_edit;
  const effectiveSessionPlan = blockScheduleChangesThisTurn ? undefined : reply.session_plan;
  const effectiveWeekUpdate =
    blockScheduleChangesThisTurn &&
    reply.week_update != null &&
    !isFullWeekKickoff(reply.week_update)
      ? undefined
      : reply.week_update;

  // A2 (#727): workout_create/workout_remove read/write the same manifest template_edit/
  // session_plan already validate against - routine storage reuses TEMPLATES_PATH_PREFIX/
  // TEMPLATES_MANIFEST_PATH in this stack (no rename yet, per the plan). Not gated behind
  // blockScheduleChangesThisTurn - creating or removing a routine isn't the Bug 3 "unconfirmed
  // schedule change" case that guard exists for.
  const needsTemplateContext =
    effectiveTemplateEdit != null ||
    effectiveSessionPlan != null ||
    effectiveWeekUpdate != null ||
    reply.workout_create != null ||
    reply.workout_remove != null;
  const validTemplateIds: ReadonlySet<string> = needsTemplateContext
    ? validTemplateIdsFromManifest(
        turn.prefetchedTemplatesManifestContent !== undefined
          ? turn.prefetchedTemplatesManifestContent
          : await (async () => {
              // Soft read: same contract as getHeadShaOrNull (404 quiet; else capture once → null).
              try {
                return await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token);
              } catch (err: unknown) {
                const status = (err as { status?: number }).status;
                if (status === 404) return null;
                await captureServerException(err);
                return null;
              }
            })(),
      )
    : new Set<string>();

  const { valid: validatedTemplateEdit, dropped: droppedTemplateEdit } = validateTemplateEdit(
    effectiveTemplateEdit,
    validTemplateIds,
  );
  droppedActions.push(...droppedTemplateEdit);
  const templateEditWrite = buildTemplateEditWrite(
    repo,
    token,
    traceId,
    validatedTemplateEdit,
    validTemplateIds,
  );

  const { valid: validatedSessionPlan, dropped: droppedSessionPlan } = validateSessionPlan(
    effectiveSessionPlan,
    validTemplateIds,
  );
  droppedActions.push(...droppedSessionPlan);
  const sessionPlanWrite = buildSessionPlanWrite(
    repo,
    token,
    timezone,
    traceId,
    validatedSessionPlan,
    validTemplateIds,
  );

  // A2 (#727): workout_create/workout_remove's own invariants (1/2/7/8) are business-logic
  // checks, not stale-reference lookups like quest_id/template_id above -
  // buildWorkoutCreateAndRemoveWrites catches applyWorkoutCreate/applyWorkoutRemove's throw
  // itself and reports it as a dropped action, same "one bad action never costs the rest of the
  // turn" discipline as every other entry in droppedActions here. Combined into one call because
  // both actions can touch TEMPLATES_MANIFEST_PATH in the same turn - see that function's own
  // comment for why two separate manifest writes would silently drop one.
  const { writes: workoutCreateAndRemoveWrites, dropped: droppedWorkoutCreateAndRemove } =
    buildWorkoutCreateAndRemoveWrites(
      traceId,
      reply.workout_create,
      reply.workout_remove,
      validTemplateIds,
      turn.activeInjuryFlagIds,
      turn.context.progressions,
    );
  droppedActions.push(...droppedWorkoutCreateAndRemove);

  // Same pre-validate-before-build discipline as template_id above, applied to a patch-shaped
  // week_update's session_id references. Reuses requestCoachReply's own prefetch (Finding A fix)
  // when one ran, same as validTemplateIds above; only a first-session turn falls back to fetching
  // here. A full-week-kickoff week_update needs no existing file at all - it builds fresh, same as
  // week_plan always did. Either way this same read is handed to buildCurrentWeekWrite so its
  // resolve() reuses it instead of fetching it again - what got validated is exactly what gets
  // patched, no race window between two separate reads.
  const needsCurrentWeekContext =
    effectiveWeekUpdate != null && !isFullWeekKickoff(effectiveWeekUpdate);
  const currentWeekContent = needsCurrentWeekContext
    ? turn.prefetchedCurrentWeekContent !== undefined
      ? turn.prefetchedCurrentWeekContent
      : await (async () => {
          // Soft read: same contract as getHeadShaOrNull (404 quiet; else capture once → null).
          try {
            return await getFileRaw(repo, CURRENT_WEEK_PATH, token);
          } catch (err: unknown) {
            const status = (err as { status?: number }).status;
            if (status === 404) return null;
            await captureServerException(err);
            return null;
          }
        })()
    : undefined;
  // Single parse of currentWeekContent, with both the id set and the discipline/kind map derived
  // from it - two independent parseJsonOrNull calls over the same raw string would be redundant
  // work on every turn that touches a patch-shaped week_update.
  const weekSessions = needsCurrentWeekContext
    ? weekSessionsFromCurrentWeek(currentWeekContent ?? null)
    : [];
  const validSessionIds = new Set(weekSessions.map((session) => session.id));
  // A patch's day.date and move_to_date need checking against the week's real day dates too, not
  // just session ids - every day is a legal patch target, including one with zero sessions, so
  // this can't be derived from weekSessions alone.
  const validDayDates = needsCurrentWeekContext
    ? new Set(weekDayDatesFromCurrentWeek(currentWeekContent ?? null))
    : new Set<string>();
  // Bug 3 content-diff guard: existing session content, keyed by id, so validateWeekUpdate can
  // tell a category-changing patch entry from a same-turn confirmation.
  const existingSessionsForDiff: ReadonlyMap<string, ExistingSessionForDiff> = new Map(
    weekSessions.map((session) => [
      session.id,
      { id: session.id, discipline: session.discipline, kind: session.kind },
    ]),
  );
  // #727 live-test finding: a brand-new session (no session_id) that arrives already marked
  // done/skipped, on a date that still has a real session sitting in "planned", is exactly the
  // shape of a real bug found live - Coach invented a duplicate instead of referencing the real
  // session already on that date, leaving it stale. Keyed by date (not id) so
  // validateWeekUpdate can check what's already on a day before accepting a brand-new entry for
  // it.
  const plannedSessionsByDate = new Map<string, { id: string; title: string }[]>();
  for (const session of weekSessions) {
    if (session.status !== "planned") continue;
    const list = plannedSessionsByDate.get(session.date) ?? [];
    list.push({ id: session.id, title: session.title });
    plannedSessionsByDate.set(session.date, list);
  }

  const { valid: validatedWeekUpdate, dropped: droppedWeekUpdate } = validateWeekUpdate(
    effectiveWeekUpdate,
    validDayDates,
    validSessionIds,
    existingSessionsForDiff,
    turn.athleteMessage,
    plannedSessionsByDate,
  );
  droppedActions.push(...droppedWeekUpdate);

  // Live-verified (#727): a full-week-kickoff week_update is built and structurally validated
  // eagerly inside buildCurrentWeekWrite (not deferred behind a resolve()), so a real validation
  // failure - reproduced live: two days missing/empty `intent` - threw straight out of this
  // function with no error boundary, crashing the whole turn. Every other action field in this
  // pipeline drops just the one bad action and keeps the rest of the turn; week_update didn't.
  //
  // The patch-mode path has the same shape of risk one level later: buildCurrentWeekWrite defers
  // its own applyWeekUpdate/assertCurrentWeekCommitReady call behind an async resolve(), which
  // commitFilesAtomic calls with no try/catch of its own - a bad patch result wouldn't just drop
  // week_update, it could crash the whole atomic commit and lose every other write in this turn.
  // Not yet live-reproduced (patch mode's surface is narrower than kickoff's), but the same
  // eager-validate-first shape closes it before it needs to be: run the exact same
  // applyWeekUpdate + assertCurrentWeekCommitReady pass once, synchronously, against the content
  // already fetched above - if it throws, skip the write entirely rather than betting on
  // commitFilesAtomic's resolve() surviving it. buildCurrentWeekWrite still redoes this same work
  // against a possibly-fresher read at actual commit time for the real write, preserving its
  // retry-safety for the happy path this validates.
  let currentWeekWrite: FileEntry | undefined;
  try {
    if (validatedWeekUpdate != null && !isFullWeekKickoff(validatedWeekUpdate)) {
      assertCurrentWeekCommitReady(
        applyWeekUpdate(
          currentWeekContent ?? null,
          validatedWeekUpdate,
          validTemplateIds,
          timezone,
          traceId,
          new Date(),
        ),
      );
    }
    currentWeekWrite = buildCurrentWeekWrite(
      repo,
      token,
      timezone,
      traceId,
      validatedWeekUpdate,
      validTemplateIds,
      currentWeekContent,
    );
  } catch (err) {
    droppedActions.push({
      field: "week_update",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  // ADR 0049: lazy same-turn rollover, alongside the CI job. current_week.json's rollover
  // otherwise only runs inside sync.user.yml, gated on the iOS app's own activity-sync push - an
  // athlete who hasn't synced recently gets no rollover at all. Checked on every turn, same as
  // injectCoachSinceIfNeeded is below, but only when this turn's own week_update didn't already
  // produce a write to the same path - the athlete's own intent this turn is more current than a
  // generic empty-frame refresh, and commitFilesAtomic does not merge two writes to the same path.
  let rolloverWrite: FileEntry | undefined;
  // turn.today is always a real YYYY-MM-DD date in production (loadTurnState computes it from
  // todayDateString before this ever runs) - this guard is defense-in-depth only, so a turn built
  // by a test harness (or any future caller) that skips that step no-ops here instead of handing
  // an unparseable date string into buildRolloverPlaceholder's own date arithmetic.
  if (currentWeekWrite === undefined && /^\d{4}-\d{2}-\d{2}$/.test(turn.today)) {
    // Reuse whatever read of current_week.json this turn already did - the patch-mode fetch
    // above when a (dropped) week_update needed one, otherwise requestCoachReply's own prefetch
    // (undefined only on a first-session turn, where it's never fetched at all). Only a
    // first-session turn falls back to a fresh soft read here, same contract as every other soft
    // read in this file: 404 quiet, anything else captured once, both read as null.
    const rolloverSourceContent =
      currentWeekContent !== undefined
        ? currentWeekContent
        : turn.prefetchedCurrentWeekContent !== undefined
          ? turn.prefetchedCurrentWeekContent
          : await (async () => {
              try {
                return await getFileRaw(repo, CURRENT_WEEK_PATH, token);
              } catch (err: unknown) {
                const status = (err as { status?: number }).status;
                if (status === 404) return null;
                await captureServerException(err);
                return null;
              }
            })();
    const rolloverNow = new Date(turn.now);
    if (currentWeekNeedsRollover(rolloverSourceContent ?? null, turn.today, rolloverNow)) {
      rolloverWrite = {
        path: CURRENT_WEEK_PATH,
        content: JSON.stringify(
          buildRolloverPlaceholder(timezone, turn.today, rolloverNow),
          null,
          2,
        ),
      };
    }
  }

  for (const dropped of droppedActions) {
    console.error("[coach-chat] dropped a structured-fact action - bad reference:", dropped, {
      traceId,
    });
    await captureValidationFailure(new Error(`${dropped.field}: ${dropped.reason}`), {
      traceId,
      field: dropped.field,
      reason: dropped.reason,
    });
  }

  // D1: a rejected action never disappears silently - fold it into the *next* turn's context so
  // Coach can naturally follow up ("I couldn't quite save that habit update, can you confirm?")
  // instead of the athlete finding out never. coach_log.json's "Recent Session Notes" section
  // (renderCoachContext) is already the existing continuity mechanism every turn reads from -
  // reusing it here (instead of inventing a new persisted field) means the very next Gemini call
  // sees this as real context, not just a hope that this turn's reply happens to mention it.
  //
  // C1 unified every turn onto one always-committed write set (optionalWrites, below) - there is
  // no more ordinary-vs-closing split withholding coach-log writes on an ordinary turn, so this
  // system-authored note rides the same single coachNoteWrite the model's own coach_note already
  // uses. commitFilesAtomic does not merge two writes to the same path, so the two notes are
  // combined into that one write here rather than sent separately.
  // The fallback note is built only from actions that survived validation above, so it never says
  // "recorded" for something a bad reference dropped. A dropped action already gets its own note.
  const droppedFields = new Set(droppedActions.map((dropped) => dropped.field));
  const survivingReply: typeof reply = {
    ...reply,
    injury_event: injuryEvents,
    quest_event: questEvents,
  };
  for (const field of droppedFields) {
    if (field in survivingReply)
      (survivingReply as unknown as Record<string, unknown>)[field] = undefined;
  }
  const fallbackCoachNote = modelCoachNote
    ? undefined
    : synthesizeRequiredCoachNote(survivingReply);
  if (fallbackCoachNote) {
    console.warn("[coach-chat] no coach_note from the model, writing a fallback from the fields:", {
      traceId,
    });
    recordSilentFixup(traceId, {
      kind: "coach_note_synthesized",
      action: "coach_note",
      detail: fallbackCoachNote,
    });
  }
  const trimmedCoachNote = modelCoachNote || fallbackCoachNote;
  const droppedActionsNote = formatDroppedActionsNote(droppedActions);
  const synthesizedQuestEventNote = synthesizedQuestEvent
    ? formatSynthesizedQuestEventNote(synthesizedQuest?.name)
    : undefined;
  // coach_note is one row per calendar day, overwritten in place - a later same-day turn that
  // writes anything to it but doesn't itself restate pending_clarification (the model only
  // reports this per-turn; it has no reason to keep echoing an old one) would otherwise drop a
  // still-open marker the moment that day's row gets overwritten. Carry the prior marker forward
  // whenever this turn didn't produce a fresh one, unless the athlete's own message this turn
  // reads as an answer to it.
  const carriedPendingClarification =
    turn.pendingClarification && !hasConfirmationCue(turn.athleteMessage)
      ? turn.pendingClarification
      : undefined;
  const pendingClarificationMarker = formatPendingClarificationMarker(
    reply.pending_clarification ?? carriedPendingClarification,
  );
  // buildCoachNoteWrite's capText caps the whole joined string from the tail, so the marker must
  // go first, not last, to survive a long coach_note/droppedActionsNote ahead of it -
  // formatPendingClarificationMarker also bounds its own length so it always fits intact
  // regardless of how long the free-text portion behind it runs.
  const coachNoteWrite = buildCoachNoteWrite(
    repo,
    token,
    turn.today,
    traceId,
    [pendingClarificationMarker, trimmedCoachNote, droppedActionsNote].filter(Boolean).join("\n") ||
      undefined,
  );

  // akash retest finding: the athlete-facing correction has to land in the reply actually sent
  // this turn, not just next turn's coach_log context above - so this builds the chat message
  // (and the reply text commitTurn returns) only now, after droppedActions is fully known, instead
  // of at the top of this function using the model's raw, pre-validation reply.reply. Finding E's
  // synthesis note rides the same same-turn-visibility logic.
  const droppedActionsCorrection = formatDroppedActionsCorrection(droppedActions);
  const proseOnlyWeekPlanCorrection = formatProseOnlyWeekPlanCorrection(
    turn.stillProseOnlyWeekPlan ?? false,
  );
  const missedWorkoutCreateCorrection = formatMissedWorkoutCreateCorrection(
    turn.stillMissedWorkoutCreate ?? false,
  );
  const missedTemplateEditCorrection = formatMissedTemplateEditCorrection(
    turn.stillMissedTemplateEdit ?? false,
  );
  const missedSessionPlanCorrection = formatMissedSessionPlanCorrection(
    turn.stillMissedSessionPlan ?? false,
  );
  const missedWeekUpdateCorrection = formatMissedWeekUpdateCorrection(
    turn.stillMissedWeekUpdate ?? false,
  );
  const correctionSuffix = [
    droppedActionsCorrection,
    proseOnlyWeekPlanCorrection,
    missedWorkoutCreateCorrection,
    missedTemplateEditCorrection,
    missedSessionPlanCorrection,
    missedWeekUpdateCorrection,
    synthesizedQuestEventNote,
  ]
    .filter(Boolean)
    .join("\n");
  const finalReplyText = correctionSuffix ? `${reply.reply}\n\n${correctionSuffix}` : reply.reply;
  const coachMsg: ChatMessage = {
    id: `c-${turn.now}`,
    role: "coach",
    paragraphs: [finalReplyText],
  };
  const allMessages = appendConversationTurn(turn.priorMessages, turn.userMsg, coachMsg, {
    id: `d-${turn.now}`,
    role: "divider",
    label: todayDividerLabel(timezone),
  });
  const { chatWrite, latestThreads, finalThreadId, computedTitle } = buildChatWrite({
    repo,
    token,
    traceId,
    now: turn.now,
    threadId: turn.threadId,
    trimmed: turn.trimmed,
    allMessages,
    replyText: finalReplyText,
  });

  const sportsUpdate = (reply.sports_update ?? []).filter((sport) => sport.trim().length > 0);
  const hasSportsUpdate = sportsUpdate.length > 0;
  const memoryFileWrite = buildMemoryFileWrite(repo, token, timezone, traceId, {
    memoryUpdate: reply.memory_update,
    coachingStyleUpdate: reply.coaching_style_update,
    sportsUpdate,
  });

  const profileUpdates = (reply.profile_update ?? []).filter(
    (update) => update.field != null && update.value != null,
  );
  const profileUpdateWrite = buildProfileUpdateWrite(repo, token, profileUpdates);

  const { today } = turn;

  const seasonStart = reply.season_start;
  const seasonStartWrites = buildSeasonStartWrite(repo, token, timezone, traceId, seasonStart);

  const questCreate = reply.quest_create;
  let questCreateWrite = buildQuestCreateWrite(repo, token, timezone, traceId, questCreate);

  // season_start's main_quest write and quest_create's habit-quest write can both target
  // quests.json in the same turn - merge them into one resolver, same discipline as the
  // profile_update/coach_since merge below (commitFilesAtomic does not merge duplicate paths).
  if (seasonStartWrites && questCreateWrite) {
    const resolveSeasonQuests = seasonStartWrites.questWrite.resolve;
    const questCreateForTurn = questCreate!;
    seasonStartWrites.questWrite.resolve = async () =>
      applyQuestCreate(await resolveSeasonQuests(), questCreateForTurn, today, traceId, new Date());
    questCreateWrite = undefined;
  }

  const { wasProfileComplete, profileComplete, projectedProfile, projectedMemory } =
    projectProfileCompletion({
      profile,
      memory,
      seasons,
      profileUpdates,
      sportsUpdate,
      hasSportsUpdate,
      coachingStyleUpdate: reply.coaching_style_update,
      seasonStart,
      today,
      traceId,
    });

  let closingFiles = turn.closingFiles;
  if (!wasProfileComplete && profileComplete && !closingFiles) {
    closingFiles = await loadClosingFileContext(repo, token);
  }
  let validUpdates = await injectCoachSinceIfNeeded(
    [],
    closingFiles,
    wasProfileComplete,
    profileComplete,
    timezone,
  );

  // profile_update and coach_since can target profile.json together. Merge them into one resolver
  // because commitFilesAtomic does not merge duplicate paths.
  //
  // Review finding (P1, #727 hardening): this used to hand-write just { coach_since }, discarding
  // first_session_benchmark_pending: true even though injectCoachSinceIfNeeded (above) always sets
  // both fields together in the same patch (coachSinceStamp.ts) - this branch only runs when that
  // function already fired, so the two fields are never set independently. On the common case (the
  // athlete's last profile field arrives the same turn as onboarding completion), the pending
  // marker never actually got written true, defeating the retry mechanism for exactly the athletes
  // who'd need it. Fixed by mirroring the same two-field patch instead of reconstructing a
  // narrower one.
  if (validUpdates.some((update) => update.path === PROFILE_PATH) && profileUpdateWrite) {
    const resolveProfileUpdate = profileUpdateWrite.resolve;
    profileUpdateWrite.resolve = async () => {
      const updated = await resolveProfileUpdate();
      const merged = applyJsonMergePatch(
        updated,
        JSON.stringify({
          coach_since: todayDateString(timezone, new Date()),
          first_session_benchmark_pending: true,
        }),
      );
      return merged.ok ? merged.content : updated;
    };
    validUpdates = validUpdates.filter((update) => update.path !== PROFILE_PATH);
  }

  // seasonWrite must precede questWrite here - buildSeasonStartWrite's questWrite.resolve()
  // reuses seasonWrite.resolve()'s cached computation and depends on it running first.
  const optionalWrites = [
    coachNoteWrite,
    memoryFileWrite,
    injuryWrite,
    questEventWrite,
    profileUpdateWrite,
    templateEditWrite,
    sessionPlanWrite,
    ...workoutCreateAndRemoveWrites,
    currentWeekWrite,
    rolloverWrite,
    seasonStartWrites?.seasonWrite,
    seasonStartWrites?.questWrite,
    questCreateWrite,
  ].filter((write): write is FileEntry => write != null);

  return {
    ...turn,
    chatWrite,
    latestThreads,
    finalThreadId,
    computedTitle,
    trimmedCoachNote,
    finalReplyText,
    optionalWrites,
    validUpdates,
    wasProfileComplete,
    profileComplete,
    projectedProfile,
    projectedMemory,
    droppedActions,
  };
}
