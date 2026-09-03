import {
  commitFilesAtomic,
  type FileEntry,
  type ResolvedFileWrite,
} from "../../_lib/githubGitData.js";
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import {
  getFileRaw,
  getHeadSha,
  invalidateCoachContext,
  isFirstSessionRitualDone,
  loadCoachContext,
  resolveCoachChatBranch,
} from "./coachChatFiles.js";
import { withComputedDayOffsets, todayDividerLabel, todayDateString } from "./coachDay.js";
import {
  appendConversationTurn,
  loadChatHistory,
  pruneForResponse,
  type ChatMessage,
  type ChatThread,
} from "./chatThreads.js";
import {
  loadClosingFileContext,
  injectCoachSinceIfNeeded,
  type ClosingFileContext,
} from "./coachSinceStamp.js";
import {
  generateInitialTemplates,
  validTemplateIdsFromManifest,
  TEMPLATES_MANIFEST_PATH,
} from "./coachWorkoutFiles.js";
import { PROFILE_PATH, type ProfileJson, type MemoryJson } from "./coachMemoryFiles.js";
import { renderCoachContext, renderQuestContext } from "./coachContext.js";
import { askGemini, GEMINI_MODEL } from "./geminiClient.js";
import { captureGeminiFailure, captureValidationFailure } from "../../_lib/sentry.js";
import {
  validateQuestEvents,
  validateInjuryEvents,
  type DroppedAction,
} from "./turnWrites/validateActions.js";
import {
  combineExtraContext,
  firstSessionContext,
  type OnboardingHints,
} from "./coachPromptText.js";
import type { GeminiReply, TurnMode } from "./coachReplySchema.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "./text-caps.bundle.js";
import { FIRST_SESSION_PROTOCOL } from "../../_generated/soul.js";
import { buildChatWrite } from "./turnWrites/chatWrite.js";
import { buildCoachNoteWrite } from "./turnWrites/coachNoteWrite.js";
import { buildMemoryFileWrite } from "./turnWrites/memoryWrite.js";
import { buildInjuryWrites } from "./turnWrites/injuryWrite.js";
import { buildQuestEventWrite, buildQuestCreateWrite } from "./turnWrites/questWrite.js";
import { buildSeasonStartWrite } from "./turnWrites/seasonWrite.js";
import { applyQuestCreate } from "./coachIntents.js";
import { buildProfileUpdateWrite, projectProfileCompletion } from "./turnWrites/profileWrite.js";
import { buildTemplateEditWrite, buildSessionPlanWrite } from "./turnWrites/workoutWrite.js";
import { buildCurrentWeekWrite } from "./turnWrites/weekWrite.js";

import { parseActivityIds, type ActivitySyncRequest } from "./activitySync.js";

interface PostBody {
  threadId?: string;
  messages?: ChatMessage[];
  message?: string;
  action?: "greet" | "activity_sync";
  activity_ids?: unknown;
  knownSha?: string;
  onboardingHints?: OnboardingHints;
}

export interface GreetRequest {
  action: "greet";
  onboardingHints?: OnboardingHints;
}

export interface TurnRequest {
  threadId?: string;
  priorMessages: ChatMessage[];
  trimmed: string;
  geminiMessage: string;
  knownSha?: string;
}

interface TurnState extends TurnRequest {
  repo: string;
  token: string;
  apiKey: string;
  currentSha: string | null;
  stale: boolean;
  context: Awaited<ReturnType<typeof loadCoachContext>>;
  timezone: string;
  // Computed once here and reused everywhere this turn needs "today" (athleteContext,
  // questContext, and later buildCoachNoteWrite's day-keyed overwrite) - recomputing it
  // independently at commit time, after an askGemini round trip (or a reprompt's second one),
  // can land on a different day than what Gemini was actually shown if the turn straddles local
  // midnight.
  today: string;
  athleteContext: string;
  questContext: string;
  firstSession: boolean;
  now: number;
  traceId: string;
  userMsg?: Extract<ChatMessage, { role: "user" }>;
  closingFiles?: ClosingFileContext;
  // D1 layer 1 (#736): extracted here, before the askGemini call, instead of only after (as
  // buildTurnWrites did pre-D1) - generationConfigFor needs these to build the request's
  // enum-constrained quest_id/flag_id fields, not just to validate the reply afterward.
  validQuestIds: ReadonlySet<string>;
  validInjuryFlagIds: ReadonlySet<string>;
}

interface RepliedTurn extends TurnState {
  reply: GeminiReply;
}

export interface TurnWrites extends RepliedTurn {
  chatWrite: ResolvedFileWrite;
  latestThreads: ChatThread[];
  finalThreadId: string;
  computedTitle: string;
  trimmedCoachNote?: string;
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

export async function handleHistory(repo: string, token: string): Promise<Response> {
  const [history, context] = await Promise.all([
    loadChatHistory(repo, token),
    loadCoachContext(repo, token),
  ]);
  const timezone = context.profile?.timezone?.trim() || "UTC";
  return Response.json({
    threads: withComputedDayOffsets(pruneForResponse(history.threads), timezone),
  });
}

export async function parseTurnRequest(
  req: Request,
): Promise<Response | GreetRequest | TurnRequest | ActivitySyncRequest> {
  const body = (await req.json()) as PostBody;
  if (body.action === "greet") return { action: "greet", onboardingHints: body.onboardingHints };
  if (body.action === "activity_sync") {
    const parsedIds = parseActivityIds(body.activity_ids);
    if (!parsedIds.ok) return Response.json({ error: parsedIds.error }, { status: 400 });
    return {
      action: "activity_sync",
      activity_ids: parsedIds.activityIds,
      knownSha: body.knownSha,
    };
  }

  const trimmed = (body.message ?? "").trim();
  if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });
  return {
    threadId: body.threadId,
    priorMessages: body.messages ?? [],
    trimmed,
    geminiMessage: trimmed,
    knownSha: body.knownSha,
  };
}

export function isGreetRequest(
  value: GreetRequest | TurnRequest | ActivitySyncRequest,
): value is GreetRequest {
  return "action" in value && value.action === "greet";
}

export function isActivitySyncRequest(
  value: GreetRequest | TurnRequest | ActivitySyncRequest,
): value is ActivitySyncRequest {
  return "action" in value && value.action === "activity_sync";
}

export async function loadTurnState(
  request: TurnRequest,
  repo: string,
  token: string,
  apiKey: string,
): Promise<Response | TurnState> {
  const currentSha = await getHeadSha(repo, token).catch(() => null);
  const stale = request.knownSha != null && currentSha != null && request.knownSha !== currentSha;
  const context = await loadCoachContext(repo, token, { fresh: stale });
  const {
    soul,
    profile,
    memory,
    injuries,
    coachLog,
    seasons,
    quests,
    progress,
    progressions,
    athleteInsights,
  } = context;
  if (!soul) return Response.json({ error: "Coach SOUL bundle is unavailable" }, { status: 500 });

  const timezone = profile?.timezone?.trim() || "UTC";
  const firstSession = !isFirstSessionRitualDone(profile, memory, seasons, quests);
  const now = Date.now();
  const traceId = Math.random().toString(36).slice(2, 10);
  const today = todayDateString(timezone, new Date());
  // D1 layer 1 (#736): the athlete's real current quest/injury ids, extracted before the Gemini
  // call so generationConfigFor can enum-constrain quest_event.quest_id/injury_event.flag_id to
  // real values, not just validate the reply after the fact.
  const validQuestIds = new Set<string>(
    [
      quests?.main_quest?.id,
      ...(quests?.quests ?? [])
        .filter((quest) => quest.status === "active")
        .map((quest) => quest.id),
    ].filter((id): id is string => Boolean(id)),
  );
  const validInjuryFlagIds = new Set<string>(
    (injuries?.flags ?? []).map((flag) => flag.id).filter((id): id is string => Boolean(id)),
  );

  return {
    ...request,
    repo,
    token,
    apiKey,
    currentSha,
    stale,
    context,
    timezone,
    today,
    athleteContext: renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights,
      today,
    }),
    questContext: renderQuestContext({
      seasons,
      quests,
      progress,
      progressions,
      today,
    }),
    firstSession,
    now,
    traceId,
    userMsg: request.trimmed ? { id: `u-${now}`, role: "user", text: request.trimmed } : undefined,
    validQuestIds,
    validInjuryFlagIds,
  };
}

// Layer 2 of the text-caps design (issue #462): the Gemini schema's maxLength (layer 1) and the
// prompt's stated caps (layer 0) are both requests, not guarantees - Gemini can still overshoot.
// This checks the parsed reply against the same three caps and reports the first violation found;
// layer 3 (capText in turnWrites/*) is the deterministic backstop if this and the reprompt below
// both fail.
function findOversizedTextField(
  reply: GeminiReply,
): { field: string; length: number; cap: number } | null {
  if (reply.coach_note && reply.coach_note.length > COACH_LOG_TEXT_CAP) {
    return { field: "coach_note", length: reply.coach_note.length, cap: COACH_LOG_TEXT_CAP };
  }
  if (reply.memory_update?.text && reply.memory_update.text.length > MEMORY_NOTE_TEXT_CAP) {
    return {
      field: "memory_update.text",
      length: reply.memory_update.text.length,
      cap: MEMORY_NOTE_TEXT_CAP,
    };
  }
  const oversizedNewInjury = (reply.injury_flag ?? []).find(
    (flag) => flag.text != null && flag.text.length > INJURY_FLAG_TEXT_CAP,
  );
  if (oversizedNewInjury) {
    return {
      field: "injury_flag[].text",
      length: oversizedNewInjury.text!.length,
      cap: INJURY_FLAG_TEXT_CAP,
    };
  }
  const oversizedInjury = (reply.injury_event ?? []).find(
    (event) => event.text != null && event.text.length > INJURY_FLAG_TEXT_CAP,
  );
  if (oversizedInjury) {
    return {
      field: "injury_event[].text",
      length: oversizedInjury.text!.length,
      cap: INJURY_FLAG_TEXT_CAP,
    };
  }
  return null;
}

// C2's enforcement rule: coach_note is required whenever the same reply also produced another
// structured write, since that's exactly the case where something happened worth remembering and
// Gemini doesn't get to silently skip recording it (JSON schema can't express "required only if
// another field is present," so this is a post-hoc check, same as findOversizedTextField above).
// A turn with none of these other fields (small talk, a check-in with nothing to report) leaves
// coach_note genuinely optional.
const ACTIONS_REQUIRING_COACH_NOTE = [
  "profile_update",
  "memory_update",
  "injury_flag",
  "injury_event",
  "quest_event",
  "quest_create",
  "season_start",
] as const satisfies readonly (keyof GeminiReply)[];

function missingRequiredCoachNote(reply: GeminiReply): boolean {
  if (reply.coach_note && reply.coach_note.trim()) return false;
  return ACTIONS_REQUIRING_COACH_NOTE.some((field) => {
    const value = reply[field];
    return Array.isArray(value) ? value.length > 0 : value != null;
  });
}

// D1 layer 2 (#736): schema constraints (layer 1) are strong but not formally airtight - this
// codebase's own experience already shows maxLength is "a real constraint Gemini receives, not a
// guarantee it honors" (docs/eng-docs/gemini-flow.md:154-155). Same shape as
// findOversizedTextField above: detect the specific bad reference, name the actual valid ids in
// one corrective reprompt, use the corrected result. A stale/hallucinated id that survives even
// this is layer 3's job (buildTurnWrites) - drop just that action, never the whole turn.
function findInvalidReference(
  reply: GeminiReply,
  validQuestIds: ReadonlySet<string>,
  validInjuryFlagIds: ReadonlySet<string>,
): { field: string; badId: string; validIds: readonly string[] } | null {
  const badQuestEvent = (reply.quest_event ?? []).find(
    (event) => event.quest_id != null && !validQuestIds.has(event.quest_id),
  );
  if (badQuestEvent) {
    return {
      field: "quest_event",
      badId: badQuestEvent.quest_id,
      validIds: [...validQuestIds],
    };
  }
  const badInjuryEvent = (reply.injury_event ?? []).find(
    (event) => event.flag_id != null && !validInjuryFlagIds.has(event.flag_id),
  );
  if (badInjuryEvent) {
    return {
      field: "injury_event",
      badId: badInjuryEvent.flag_id,
      validIds: [...validInjuryFlagIds],
    };
  }
  return null;
}

// D1 (#736): a Gemini-call failure ("Coach never got to reply") gets its own honest, consistent
// shape distinct from a commit failure ("Coach replied but I couldn't save it") - the raw
// upstream error text (e.g. "Gemini request failed (503): ...") is not something a non-technical
// athlete should see verbatim.
function friendlyGeminiErrorMessage(status: number): string {
  if (status === 429) return "Coach is getting a lot of requests right now - try again shortly.";
  if (status === 503 || status === 504) {
    return "Coach couldn't respond in time - try again in a moment.";
  }
  if (status >= 500) return "Something went wrong on our end - try again shortly.";
  return "Coach couldn't reply to that - try rephrasing or try again.";
}

export async function requestCoachReply(turn: TurnState): Promise<Response | RepliedTurn> {
  const mode: TurnMode = "ordinary";
  const extraContext = combineExtraContext(
    firstSessionContext(turn.firstSession, FIRST_SESSION_PROTOCOL),
  );
  const referenceIds = {
    questIds: [...(turn.validQuestIds ?? [])],
    injuryFlagIds: [...(turn.validInjuryFlagIds ?? [])],
  };
  try {
    let reply = await askGemini(
      turn.apiKey,
      turn.context.soul!,
      turn.athleteContext,
      turn.questContext,
      turn.priorMessages,
      turn.geminiMessage,
      mode,
      turn.firstSession,
      extraContext,
      turn.traceId,
      turn.timezone,
      referenceIds,
    );
    // Content-triggered retry, not a transport one (that's geminiClient.ts's own retry on
    // timeout/rate-limit) - kept as its own explicit step here. Exactly one reprompt attempt,
    // covering both content violations findOversizedTextField and missingRequiredCoachNote can
    // find - a turn could in principle trip both at once, and one combined reprompt naming both
    // problems costs the same one extra call as fixing either alone, instead of two sequential
    // reprompts doubling latency. If the reprompt doesn't fully fix it, layer 3's capText
    // backstop in turnWrites/* handles the size side and the missing-note side is simply
    // accepted as-is (no note ever silently invented from nothing).
    const violation = findOversizedTextField(reply);
    const missingNote = missingRequiredCoachNote(reply);
    if (violation || missingNote) {
      console.warn("[coach-chat] reply content violation, reprompting once:", {
        violation,
        missingNote,
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
      const repromptMessage = [
        turn.geminiMessage,
        `\n[System note: ${notes.join("; also, ")}. Keep everything else the same.]`,
      ].join(" ");
      reply = await askGemini(
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
      // The reprompt is a request, not a guarantee either - if Gemini still overshoots, capText
      // in turnWrites/* will truncate silently downstream. Log it here so a persistent
      // oversize-then-truncate or still-missing-note pattern shows up somewhere instead of
      // vanishing silently.
      const stillOversized = findOversizedTextField(reply);
      const stillMissingNote = missingRequiredCoachNote(reply);
      if (stillOversized || stillMissingNote) {
        console.warn(
          "[coach-chat] reply still has a content violation after reprompt:",
          { stillOversized, stillMissingNote },
          { traceId: turn.traceId },
        );
      }
    }
    // D1 layer 2 (#736): same one-retry-cap discipline as the oversized-field reprompt above -
    // exactly one corrective call, named to this specific bad reference. Runs after the text-cap
    // reprompt (independent concerns, each capped at one retry, both stay inside the shared
    // 45s-per-call / 300s-function budget). Layer 3 drops it if this also comes back bad.
    const badReference = findInvalidReference(
      reply,
      turn.validQuestIds ?? new Set(),
      turn.validInjuryFlagIds ?? new Set(),
    );
    if (badReference) {
      console.warn("[coach-chat] reply referenced an invalid id, reprompting once:", badReference, {
        traceId: turn.traceId,
      });
      const repromptMessage = [
        turn.geminiMessage,
        `\n[System note: your ${badReference.field} referenced id "${badReference.badId}", which`,
        `does not exist. The only valid ids are: ${badReference.validIds.join(", ") || "(none)"}.`,
        "Redo that field using only a valid id, or omit it if none apply; keep everything else",
        "the same.]",
      ].join(" ");
      reply = await askGemini(
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
      const stillBad = findInvalidReference(
        reply,
        turn.validQuestIds ?? new Set(),
        turn.validInjuryFlagIds ?? new Set(),
      );
      if (stillBad) {
        console.warn(
          "[coach-chat] reply still referenced an invalid id after reprompt, layer 3 will drop it:",
          stillBad,
          { traceId: turn.traceId },
        );
      }
    }
    return {
      ...turn,
      reply,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[coach-chat] askGemini failed:", err);
    await captureGeminiFailure(err, {
      traceId: turn.traceId,
      model: GEMINI_MODEL,
      upstreamStatus: status,
      turnMode: mode,
      athleteMessage: turn.geminiMessage,
    });
    return Response.json(
      { error: friendlyGeminiErrorMessage(status), traceId: turn.traceId },
      { status },
    );
  }
}

// D1: a short, plain-English coach_log.json row naming what got dropped this turn - not the raw
// `DroppedAction.reason` string (written for a Sentry/console reader), phrased instead as
// something Coach itself can read back next turn and act on naturally. Undefined when nothing
// was dropped, so it never adds an empty line to the combined coach_note.
function formatDroppedActionsNote(droppedActions: DroppedAction[]): string | undefined {
  if (droppedActions.length === 0) return undefined;
  const fields = droppedActions.map((dropped) => dropped.field).join(", ");
  return `[System note: couldn't save an update this turn (${fields}) - the reference didn't match anything on file. If it's still relevant, check back in with the athlete and redo it.]`;
}

export async function buildTurnWrites(turn: RepliedTurn): Promise<TurnWrites> {
  const { repo, token, timezone, traceId, reply } = turn;
  const { profile, memory, seasons } = turn.context;
  const coachMsg: ChatMessage = {
    id: `c-${turn.now}`,
    role: "coach",
    paragraphs: [reply.reply],
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
    replyText: reply.reply,
  });

  const trimmedCoachNote = reply.coach_note?.trim();

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
  const injuryWrite = buildInjuryWrites(repo, token, timezone, newInjuries, injuryEvents);

  const { valid: questEvents, dropped: droppedQuestEvents } = validateQuestEvents(
    reply.quest_event ?? [],
    turn.validQuestIds,
  );
  droppedActions.push(...droppedQuestEvents);
  const questEventWrite = buildQuestEventWrite(
    repo,
    token,
    timezone,
    traceId,
    questEvents,
    seasons?.current_season_id ?? "",
    turn.validQuestIds,
  );

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
  const droppedActionsNote = formatDroppedActionsNote(droppedActions);
  const coachNoteWrite = buildCoachNoteWrite(
    repo,
    token,
    turn.today,
    traceId,
    [trimmedCoachNote, droppedActionsNote].filter(Boolean).join("\n") || undefined,
  );

  const sportsUpdate = (reply.sports_update ?? []).filter((sport) => sport.trim().length > 0);
  const hasSportsUpdate = sportsUpdate.length > 0;
  const memoryFileWrite = buildMemoryFileWrite(repo, token, timezone, traceId, {
    memoryUpdate: reply.memory_update,
    sportsUpdate,
  });

  const profileUpdates = (reply.profile_update ?? []).filter(
    (update) => update.field != null && update.value != null,
  );
  const profileUpdateWrite = buildProfileUpdateWrite(repo, token, profileUpdates);

  // C1: session artifacts (template_edit/session_plan/week_plan/session_reconcile/plan_edit)
  // are available on every returning-athlete turn now, not gated to a closing turn - so the
  // templates-manifest fetch that validates their template_id references has to move here too,
  // and stay lazy: fetch it only when the reply actually asked for one of these, not on every
  // ordinary turn that never touches them (that would reintroduce the exact eager GitHub-read
  // cost this PR removes). Gemini itself gets no pre-fetched id list any more (see
  // coachPromptText.ts) - a wrong id just fails validation below instead of committing.
  const needsTemplateContext =
    reply.template_edit != null ||
    reply.session_plan != null ||
    reply.week_plan != null ||
    (reply.session_reconcile?.length ?? 0) > 0 ||
    (reply.plan_edit?.length ?? 0) > 0;
  const validTemplateIds: ReadonlySet<string> = needsTemplateContext
    ? validTemplateIdsFromManifest(
        await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token).catch(() => null),
      )
    : new Set<string>();

  const templateEditWrite = buildTemplateEditWrite(
    repo,
    token,
    traceId,
    reply.template_edit,
    validTemplateIds,
  );

  const sessionPlanWrite = buildSessionPlanWrite(
    repo,
    token,
    timezone,
    traceId,
    reply.session_plan,
    validTemplateIds,
  );

  const currentWeekWrite = buildCurrentWeekWrite(
    repo,
    token,
    timezone,
    traceId,
    reply.week_plan,
    reply.session_reconcile ?? [],
    reply.plan_edit ?? [],
    validTemplateIds,
  );

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
      seasonStart,
      today,
      traceId,
    });

  let closingFiles = turn.closingFiles;
  if (!wasProfileComplete && profileComplete && !closingFiles) {
    closingFiles = await loadClosingFileContext(repo, token);
  }
  let validUpdates = injectCoachSinceIfNeeded(
    [],
    closingFiles,
    wasProfileComplete,
    profileComplete,
    timezone,
  );

  // profile_update and coach_since can target profile.json together. Merge them into one resolver
  // because commitFilesAtomic does not merge duplicate paths.
  if (validUpdates.some((update) => update.path === PROFILE_PATH) && profileUpdateWrite) {
    const resolveProfileUpdate = profileUpdateWrite.resolve;
    profileUpdateWrite.resolve = async () => {
      const updated = await resolveProfileUpdate();
      const merged = applyJsonMergePatch(
        updated,
        JSON.stringify({ coach_since: todayDateString(timezone, new Date()) }),
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
    currentWeekWrite,
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
    optionalWrites,
    validUpdates,
    wasProfileComplete,
    profileComplete,
    projectedProfile,
    projectedMemory,
    droppedActions,
  };
}

export async function generateTemplatesAfterCompletion(turn: TurnWrites): Promise<void> {
  if (turn.wasProfileComplete || !turn.profileComplete) return;
  try {
    if ((await getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token)) != null) return;
    const { templates } = await generateInitialTemplates(
      turn.projectedProfile,
      turn.projectedMemory,
      turn.context.injuries ?? { flags: [] },
      turn.timezone,
      turn.traceId,
      turn.apiKey,
    );
    await commitFilesAtomic(templates, "coach: initial workout templates generated", {
      repo: turn.repo,
      branch: resolveCoachChatBranch(),
      token: turn.token,
    });
    console.log("[coach-chat] initial workout templates committed", {
      traceId: turn.traceId,
      count: templates.length,
    });
  } catch (err) {
    console.error(
      "[coach-chat] initial workout template generation failed - continuing without it:",
      err,
      {
        traceId: turn.traceId,
      },
    );
  }
}

// One commit path for every turn - it always writes the full set (data-fact fields per A1/B3,
// session-artifact fields alongside them) and always returns the same response shape.
//
// D1 layer 3 (#736): chat history commits independently of the structured-fact writes - what was
// said is never at risk from a bad structured field, they're unrelated data. Facts are attempted
// first (already pre-validated by buildTurnWrites - see droppedActions); a facts-commit failure
// is captured and folded into droppedActions rather than losing the athlete's message too. The
// chat commit is the one true risk point left: if that fails, the response carries Gemini's
// already-generated reply text alongside the error, instead of discarding it.
export async function commitTurn(turn: TurnWrites): Promise<Response> {
  const factWrites = [...turn.validUpdates, ...turn.optionalWrites];
  const commitFailureDrops: DroppedAction[] = [];
  if (factWrites.length > 0) {
    try {
      await commitFilesAtomic(
        factWrites,
        `coach: chat — ${turn.computedTitle || "session update"}`,
        {
          repo: turn.repo,
          branch: resolveCoachChatBranch(),
          token: turn.token,
        },
      );
      invalidateCoachContext(turn.repo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[coach-chat] facts commitFilesAtomic failed:", err, {
        traceId: turn.traceId,
      });
      await captureValidationFailure(err, {
        traceId: turn.traceId,
        field: "facts_commit",
        reason: message,
      });
      for (const write of factWrites) {
        commitFailureDrops.push({
          field: write.path,
          reason: `save failed: ${message}`,
          kind: "commit_failure",
        });
      }
    }
  }

  let repoSha: string;
  try {
    const result = await commitFilesAtomic([turn.chatWrite], "coach: chat message recorded", {
      repo: turn.repo,
      branch: resolveCoachChatBranch(),
      token: turn.token,
    });
    repoSha = result.commitSha;
    invalidateCoachContext(turn.repo);
    console.log(
      "[coach-chat] turn committed",
      JSON.stringify({
        traceId: turn.traceId,
        threadId: turn.finalThreadId,
        repo: turn.repo,
        committed: [...factWrites.map((write) => write.path), turn.chatWrite.path],
        droppedFacts: commitFailureDrops.length,
        ms: Date.now() - turn.now,
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] chat commitFilesAtomic failed:", err, {
      traceId: turn.traceId,
    });
    return Response.json(
      {
        error: `Coach replied but saving failed: ${message}`,
        traceId: turn.traceId,
        reply: turn.reply.reply,
      },
      { status: 502 },
    );
  }

  await generateTemplatesAfterCompletion(turn);
  return Response.json({
    reply: turn.reply.reply,
    threadId: turn.finalThreadId,
    threads: withComputedDayOffsets(pruneForResponse(turn.latestThreads), turn.timezone),
    repoSha,
    stale: turn.stale,
    profileComplete: turn.profileComplete,
    traceId: turn.traceId,
    droppedActions: [...(turn.droppedActions ?? []), ...commitFailureDrops],
  });
}
