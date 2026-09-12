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
} from "./decide/coachChatFiles.js";
import { withComputedDayOffsets, todayDividerLabel, todayDateString } from "./decide/coachDay.js";
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
} from "./decide/coachSinceStamp.js";
import {
  validTemplateIdsFromManifest,
  TEMPLATES_MANIFEST_PATH,
  TEMPLATES_PATH_PREFIX,
} from "./decide/coachWorkoutFiles.js";
import {
  buildBenchmarkSpec,
  seedBenchmarkProgressions,
  inferTrainingAvailability,
  BENCHMARK_ROUTINE_ID,
} from "./decide/coachFirstSessionBenchmark.js";
import { compileFirstWeek } from "./decide/firstWeekCompile.js";
import { PROGRESSIONS_PATH } from "./decide/coachQuestFiles.js";
import {
  PROFILE_PATH,
  MEMORY_PATH,
  type ProfileJson,
  type MemoryJson,
  type CoachLogJson,
} from "./decide/coachMemoryFiles.js";
import { renderCoachContext, renderQuestContext } from "./decide/coachContext.js";
import { askGemini, GEMINI_MODEL } from "./gemini/geminiClient.js";
import { captureGeminiFailure, captureValidationFailure } from "../../_lib/sentry.js";
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
} from "./decide/coachWeekFiles.js";
import {
  activeTemplatesContext,
  activeWeekSessionsContext,
  combineExtraContext,
  firstSessionContext,
  type OnboardingHints,
} from "./gemini/coachPromptText.js";
import type { GeminiReply, TurnMode } from "./gemini/coachReplySchema.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
  capText,
} from "./text-caps.bundle.js";
import { FIRST_SESSION_PROTOCOL } from "../../_generated/soul.js";
import { buildChatWrite } from "./decide/turnWrites/chatWrite.js";
import { buildCoachNoteWrite } from "./decide/turnWrites/coachNoteWrite.js";
import { buildMemoryFileWrite } from "./decide/turnWrites/memoryWrite.js";
import { buildInjuryWrites } from "./decide/turnWrites/injuryWrite.js";
import { buildQuestEventWrite, buildQuestCreateWrite } from "./decide/turnWrites/questWrite.js";
import { buildSeasonStartWrite } from "./decide/turnWrites/seasonWrite.js";
import { applyQuestCreate, applyTrainingAvailabilityUpdate } from "./decide/coachIntents.js";
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

import { parseActivityIds, type ActivitySyncRequest } from "./decide/activitySync.js";

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
  // A2 (#727) invariant 7: the subset of validInjuryFlagIds that's currently active - the set
  // workout_create's injury_ack must cover. See AthleteReferenceIds.activeInjuryFlagIds.
  activeInjuryFlagIds: ReadonlySet<string>;
  // Bug 3 (2026-09-10 pro baseline): the most recent real coach_log.json row's
  // pending_clarification, if any is still unresolved - see parsePendingClarification for how
  // it's read back and findUnconfirmedAssumption for how it's enforced.
  pendingClarification: string | null;
}

interface RepliedTurn extends TurnState {
  reply: GeminiReply;
  // Fetched in requestCoachReply, before askGemini, so the prompt can supply real template/
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
}

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

// Bug 3 (2026-09-10 pro baseline): pending_clarification is persisted inside the same day-keyed
// coach_log.json row coach_note already writes to (buildCoachNoteWrite), wrapped in a recognizable
// marker so it survives the round trip through free text without needing a schema change to
// coach_log.json itself. Only the most recent row is checked - an older unresolved question that's
// since been superseded (a new day's row written, with or without its own marker) shouldn't keep
// blocking forever. See formatPendingClarificationMarker for the write side.
const PENDING_CLARIFICATION_MARKER = "[Pending clarification:";

function parsePendingClarification(coachLog: CoachLogJson | null | undefined): string | null {
  const rows = coachLog?.rows ?? [];
  if (rows.length === 0) return null;
  const latestText = rows[rows.length - 1]?.text ?? "";
  const start = latestText.indexOf(PENDING_CLARIFICATION_MARKER);
  if (start === -1) return null;
  const afterMarker = latestText.slice(start + PENDING_CLARIFICATION_MARKER.length);
  // The marker always sits on its own line (joined first, with "\n" separating it from anything
  // after) and always closes with "]" as that line's very last character - taking the line's LAST
  // "]" rather than its first is what lets a question that legitimately contains one ("should I
  // do a [tempo] run?") come through intact instead of truncating at the wrong bracket.
  const newlineIndex = afterMarker.indexOf("\n");
  const markerLine = newlineIndex === -1 ? afterMarker : afterMarker.slice(0, newlineIndex);
  const end = markerLine.lastIndexOf("]");
  if (end === -1) return null;
  const question = markerLine.slice(0, end).trim();
  return question.length > 0 ? question : null;
}

// Bounded well under COACH_LOG_TEXT_CAP so the marker's own contribution to buildCoachNoteWrite's
// budget is small and predictable - a real open question is a short sentence, never anywhere near
// this, and capText's own truncation marker text is reserved for the free-text note portion, not
// this one.
const PENDING_CLARIFICATION_TEXT_CAP = 200;

// Write side of parsePendingClarification above - wraps the model's self-reported open question
// in the same recognizable marker. Undefined (folds into nothing) when the reply didn't leave one
// open, same "no empty line added" discipline as formatDroppedActionsNote.
function formatPendingClarificationMarker(
  pendingClarification: string | undefined,
): string | undefined {
  const trimmed = pendingClarification?.trim();
  if (!trimmed) return undefined;
  return `${PENDING_CLARIFICATION_MARKER} ${capText(trimmed, PENDING_CLARIFICATION_TEXT_CAP)}]`;
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
  // A2 (#727) invariant 7: active-only subset, same filter activeInjuryFlagsSection
  // (coachContext.ts) already uses to build the athlete-context section Gemini reads flag ids
  // from.
  const activeInjuryFlagIds = new Set<string>(
    (injuries?.flags ?? [])
      .filter((flag) => flag.status === "active")
      .map((flag) => flag.id)
      .filter((id): id is string => Boolean(id)),
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
    activeInjuryFlagIds,
    pendingClarification: parsePendingClarification(coachLog),
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

// Finding D (OpenRouter K1 retest) mitigation: a self-audit signal, not a text heuristic. A dense
// first message (a goal plus multiple injuries and habits in one turn) was found to make the
// model narrate every fact in reply/coach_note while dropping almost all the matching action
// fields - not a validation drop, the fields were simply never in the model's JSON. A keyword
// heuristic (scan reply/coach_note text for injury/goal/habit words, compare to which fields
// fired) was considered and rejected: it can't tell "mentioned a new injury" from "referenced an
// injury already on file," and dense messages use varied enough wording that a fixed keyword list
// would both over- and under-fire. Instead the model self-reports via unrecorded_facts
// (coachReplySchema.ts) - it already has full context on what it just wrote and what it actually
// committed, in the same generation pass, so it's better positioned to catch its own
// inconsistency than an external heuristic reverse-engineering intent from prose. Same "request,
// not guarantee" caveat as every other field here - the self-audit call could itself be
// unreliable - but it's the strongest single signal available without a second full extraction
// pass.
function findUnrecordedFacts(reply: GeminiReply): string[] | null {
  // Same null/type guard as findOversizedTextField's injury_flag/memory_update checks above -
  // the schema declares this as string[], but that's a request to Gemini, not a runtime
  // guarantee; a non-string element here must not throw and turn a usable reply into a false 500.
  const facts = (reply.unrecorded_facts ?? [])
    .filter((fact): fact is string => typeof fact === "string")
    .map((fact) => fact.trim())
    .filter(Boolean);
  return facts.length > 0 ? facts : null;
}

// Direct-pro baseline (2026-09-10): the FSP dense-message scenario above still silently dropped
// injuries 3/8 times even with unrecorded_facts live - the same same-generation blind spot as
// everywhere else it's missed a real omission. A general keyword heuristic across every turn was
// rejected above for exactly the reason still true on a returning turn: it can't tell "a new
// injury" from "one already on file." That ambiguity doesn't exist here - scoped to a
// first-session turn with zero injury flags on record yet, there is nothing yet to be
// referencing, so any injury language in the raw message is necessarily new. A false positive
// (injury-sounding word, no real injury meant) costs one extra reprompt the model can answer
// "no injury, disregard" to - bounded downside, unlike the unbounded false-fire risk on every
// other turn shape that got this idea rejected the first time.
// The bare `ach(?:e|ing)` alternative only ever matches at the START of a word (\b requires a
// boundary immediately before it) - "headache"/"backache"/"stomachache"/"toothache" have no
// boundary there at all, since "ach" sits mid-word, so the whole match silently never fires on
// exactly the phrasing an athlete reporting a headache would use. Named compound forms are listed
// explicitly, each still properly `\b`-anchored at its own real word start.
const INJURY_LANGUAGE_PATTERN =
  /\b(strain(?:ed)?|sprain(?:ed)?|tweak(?:ed)?|sore(?:ness)?|(?:head|back|stomach|tooth)?ach(?:e|ing)|pain(?:ful)?|hurt(?:s|ing)?|injur(?:y|ed)|discomfort|tender(?:ness)?|pulled|niggle|twinge|flare(?:d)?)\b/i;

// Shared by every findMissed*Language check below - each one needs exactly this "return the
// matched keyword, or null" idiom against its own pattern.
function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[0] ?? null;
}

function findMissedInjuryLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validInjuryFlagIds.size > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}

// Finding D (2026-09-10 pro baseline): findMissedInjuryLanguage above closes the dense-message
// omission gap for injuries specifically, but the same same-generation self-audit blind spot is
// real for every action type, not just injuries - this is the next highest-value domain. Same
// three-part scoping that makes the injury version safe (first-session, zero pre-existing
// referents, no matching field already set) transfers directly: on a first-session turn with zero
// existing quests, there is nothing yet to be "referencing," so any habit-shaped language is
// necessarily new. Habits arrive via either season_start.new_habits or a standalone quest_create -
// check both before concluding one was dropped. A distinct, narrower keyword set than the injury
// one on purpose - habits were separately observed to be honestly *deferred* by the model in
// nearly every dense-message trial rather than silently dropped, so this is closing a smaller
// residual risk, not the dominant failure mode for this domain.
const HABIT_LANGUAGE_PATTERN =
  /\b(every ?day|daily|habit|routine|track(?:ing)?|log(?:ging)?|streak)\b/i;

function findMissedHabitLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (turn.validQuestIds.size > 0) return null;
  if ((reply.season_start?.new_habits ?? []).length > 0) return null;
  if ((reply.quest_create?.quests ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, HABIT_LANGUAGE_PATTERN);
}

// Single source of truth for "which fields count as schedule-changing" - both this function and
// buildTurnWrites's blockedFields computation need the exact same list, and drift between two
// separately-maintained copies would silently change what gets reprompted vs. what gets blocked.
// Named fields, not just a boolean, since buildTurnWrites also needs to report which ones it held
// back.
function scheduleChangingFieldNames(reply: GeminiReply): string[] {
  return [
    reply.template_edit != null && "template_edit",
    reply.session_plan != null && "session_plan",
    // A full-week-kickoff-shaped week_update rewrites the whole week, not one disputed session,
    // so it's deliberately not gated here. A patch-shaped week_update references existing
    // sessions and is gated.
    reply.week_update != null && !isFullWeekKickoff(reply.week_update) && "week_update",
  ].filter((field): field is string => Boolean(field));
}

// Bug 3 Primary (2026-09-10 pro baseline): the reprompt-side enforcement of pending_clarification
// tracking - see parsePendingClarification (read side) and GeminiReply.pending_clarification's
// comment for the full story. If last turn left a real question open, and this turn's reply
// touches a schedule-changing field at all, and the athlete's raw message this turn carries no
// affirmative confirmation cue, treat the pending question as still unanswered - deliberately not
// trying to track *which* session the question was about (that would need parsing free text into
// structured intent, itself an unreliable step); any schedule-changing write while a real question
// sits unanswered is worth a reprompt. If the reprompt doesn't resolve it either,
// buildTurnWrites's own layer (see the "still" check below) leaves it to layer 3's defense-in-depth
// content-diff guard (validateActions.ts) as the final backstop.
function findUnconfirmedAssumption(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.pendingClarification) return null;
  if (scheduleChangingFieldNames(reply).length === 0) return null;
  if (hasConfirmationCue(turn.geminiMessage)) return null;
  return turn.pendingClarification;
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
    [templatesManifestContent, currentWeekContent] = await Promise.all([
      getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token).catch(() => null),
      getFileRaw(turn.repo, CURRENT_WEEK_PATH, turn.token).catch(() => null),
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
    const unrecordedFacts = findUnrecordedFacts(reply);
    const missedInjuryLanguage = findMissedInjuryLanguage(turn, reply);
    const missedHabitLanguage = findMissedHabitLanguage(turn, reply);
    const unconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
    // Finding E: set only when the reprompt below actually fires and unrecordedFacts is still
    // present afterward - the last-resort synthesis signal buildTurnWrites uses (see
    // RepliedTurn.stillUnrecordedFacts).
    let stillUnrecordedFactsForSynthesis: string[] | null = null;
    // Bug 3 Primary: set when the reprompt fires and the assumption is still unresolved after it -
    // buildTurnWrites drops any schedule-changing action this turn when this is set (see
    // RepliedTurn.stillUnconfirmedAssumption).
    let stillUnconfirmedAssumptionForDrop: string | null = null;
    if (
      violation ||
      missingNote ||
      unrecordedFacts ||
      missedInjuryLanguage ||
      missedHabitLanguage ||
      unconfirmedAssumption
    ) {
      console.warn("[coach-chat] reply content violation, reprompting once:", {
        violation,
        missingNote,
        unrecordedFacts,
        missedInjuryLanguage,
        missedHabitLanguage,
        unconfirmedAssumption,
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
      if (unconfirmedAssumption) {
        notes.push(
          `you left this open last turn and never got a real answer to it: "${unconfirmedAssumption}"` +
            " - the athlete's message this turn doesn't clearly resolve it, so do not commit a" +
            " week_update/template_edit/session_plan based on an assumed answer;" +
            " ask again instead, or proceed only if the athlete's message genuinely does answer it",
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
      const stillUnrecordedFacts = findUnrecordedFacts(reply);
      const stillMissedInjuryLanguage = findMissedInjuryLanguage(turn, reply);
      const stillMissedHabitLanguage = findMissedHabitLanguage(turn, reply);
      const stillUnconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
      // Bug found live (2026-09-10): using the SECOND pass's own unrecorded_facts here was wrong
      // - the model stops self-flagging the miss on retry (it now believes its confabulated
      // excuse resolved it), even though the field still isn't captured. Carry forward the
      // FIRST pass's unrecordedFacts instead, unconditionally - it was the reliable detection,
      // and buildTurnWrites' own alreadyHandledQuestIds check already no-ops the synthesis safely
      // if the reprompt's second pass did, in fact, add a real quest_event.
      stillUnrecordedFactsForSynthesis = unrecordedFacts;
      stillUnconfirmedAssumptionForDrop = stillUnconfirmedAssumption;
      if (
        stillOversized ||
        stillMissingNote ||
        stillUnrecordedFacts ||
        stillMissedInjuryLanguage ||
        stillMissedHabitLanguage ||
        stillUnconfirmedAssumption
      ) {
        console.warn(
          "[coach-chat] reply still has a content violation after reprompt:",
          {
            stillOversized,
            stillMissingNote,
            stillUnrecordedFacts,
            stillMissedInjuryLanguage,
            stillMissedHabitLanguage,
            stillUnconfirmedAssumption,
          },
          { traceId: turn.traceId },
        );
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
      prefetchedTemplatesManifestContent: templatesManifestContent,
      prefetchedCurrentWeekContent: currentWeekContent,
      stillUnrecordedFacts: stillUnrecordedFactsForSynthesis,
      stillUnconfirmedAssumption: stillUnconfirmedAssumptionForDrop,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    console.error("[coach-chat] askGemini failed:", err);
    await captureGeminiFailure(err, {
      traceId: turn.traceId,
      // geminiClient.ts tags the resolved adapter's real model onto the error before it
      // propagates here - falls back to the direct-Gemini constant only if that never ran.
      model: (err as { model?: string }).model ?? GEMINI_MODEL,
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
function formatDroppedActionsCorrection(droppedActions: DroppedAction[]): string | undefined {
  if (droppedActions.length === 0) return undefined;
  const fields = droppedActions.map((dropped) => dropped.field).join(", ");
  return `(Note: couldn't save ${fields} this turn - something about that request didn't go through. If it's still relevant, ask again.)`;
}

// Finding E: the athlete-facing counterpart to synthesizeQuestEventFromUnrecordedFacts - same
// same-turn-visibility reasoning as formatDroppedActionsCorrection above, but for the opposite
// case (something got auto-recorded on the athlete's behalf, not dropped). Surfaced so the
// athlete can immediately correct it if the synthesis guessed wrong, rather than a silent write
// they'd have no way to notice.
function formatSynthesizedQuestEventNote(questName: string | undefined): string {
  return questName
    ? `(Logged "${questName}" as completed - let me know if that's not right.)`
    : "(Logged that as completed - let me know if that's not right.)";
}

export async function buildTurnWrites(turn: RepliedTurn): Promise<TurnWrites> {
  const { repo, token, timezone, traceId, reply } = turn;
  const { profile, memory, seasons, quests } = turn.context;
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
  // which one fired. requestCoachReply already fetched the templates manifest before askGemini on
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
          : await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token).catch(() => null),
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
      : await getFileRaw(repo, CURRENT_WEEK_PATH, token).catch(() => null)
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

  const { valid: validatedWeekUpdate, dropped: droppedWeekUpdate } = validateWeekUpdate(
    effectiveWeekUpdate,
    validDayDates,
    validSessionIds,
    existingSessionsForDiff,
    turn.geminiMessage,
  );
  droppedActions.push(...droppedWeekUpdate);

  const currentWeekWrite = buildCurrentWeekWrite(
    repo,
    token,
    timezone,
    traceId,
    validatedWeekUpdate,
    validTemplateIds,
    currentWeekContent,
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
    turn.pendingClarification && !hasConfirmationCue(turn.geminiMessage)
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
  const correctionSuffix = [droppedActionsCorrection, synthesizedQuestEventNote]
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
    ...workoutCreateAndRemoveWrites,
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

// Writes one benchmark routine (coachFirstSessionBenchmark.ts's buildBenchmarkSpec, compiled
// through the same applyWorkoutCreate/buildWorkoutCreateAndRemoveWrites path an ordinary
// workout_create turn uses), seeds one progression per benchmarked pattern, derives the structured
// training_availability field from memory's existing intake prose, and compiles a real first week
// (firstWeekCompile.ts) that places the benchmark and anchor sessions on the athlete's stated
// training days. All one commit, and never allowed to block or fail the athlete's reply - none of
// this is on the critical path of the turn's own response, so a failure here only logs and moves
// on.
//
// Gated on the false->true profileComplete transition (never just "profileComplete is true"):
// isAthleteProfileComplete (coachChatFiles.ts) is a field-presence check recomputed every turn
// from current profile/memory/seasons content, so it stays true forever once an athlete's profile
// is complete - a live-verified regression (#727 review) found that dropping the transition
// requirement here made this fire, and commit a synthetic first week, on every single ordinary
// turn from any already-established athlete, since it has no reason to ever get the benchmark's
// id into its manifest otherwise. ALSO gated on the benchmark's own routine id being absent from
// the manifest, not on the manifest merely existing - carve-skeleton now seeds a manifest with two
// starter templates at carve time (A4), so "does a manifest exist" was always true and this never
// ran for a freshly carved repo either (the original P0, #727 review). A dropped invariant on the
// transition turn itself still means no automatic retry - a known, narrower gap than the one this
// replaces, tracked as follow-up rather than papered over with something unsafe for existing
// athletes.
export async function generateFirstSessionWorkoutsAfterCompletion(turn: TurnWrites): Promise<void> {
  if (turn.wasProfileComplete || !turn.profileComplete) return;
  try {
    const manifestContent = await getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token);
    const existingRoutineIds = validTemplateIdsFromManifest(manifestContent);
    if (existingRoutineIds.has(BENCHMARK_ROUTINE_ID)) return;

    const memory = turn.projectedMemory;
    const injuries = turn.context.injuries ?? { flags: [] };
    const activeInjuryFlagIds = new Set(
      injuries.flags.filter((f) => f.status === "active").map((f) => f.id),
    );
    const progressions = turn.context.progressions ?? null;

    const spec = buildBenchmarkSpec(memory, injuries);
    const { writes: benchmarkWrites, dropped } = buildWorkoutCreateAndRemoveWrites(
      turn.traceId,
      spec,
      undefined,
      existingRoutineIds,
      activeInjuryFlagIds,
      progressions,
    );
    if (dropped.length > 0 || benchmarkWrites.length === 0) {
      throw new Error(
        dropped.map((d) => d.reason).join("; ") || "workout_create produced no writes",
      );
    }
    const benchmarkRoutineId = benchmarkWrites[0].path
      .slice(TEMPLATES_PATH_PREFIX.length)
      .replace(/\.json$/, "");

    const nowIso = new Date().toISOString();
    const { content: progressionsContent } = seedBenchmarkProgressions(
      progressions,
      spec,
      nowIso,
      turn.traceId,
    );

    const trainingAvailability = inferTrainingAvailability(memory);
    const memoryWrite: FileEntry = {
      path: MEMORY_PATH,
      content: applyTrainingAvailabilityUpdate(
        JSON.stringify(memory),
        trainingAvailability,
        todayDateString(turn.timezone, new Date()),
        turn.traceId,
      ),
    };

    const weekUpdate = compileFirstWeek({
      today: turn.today,
      availability: trainingAvailability,
      benchmarkRoutineId,
      benchmarkTitle: spec.title,
      sports: memory.sports ?? [],
    });
    const weekContent = applyWeekUpdate(
      null,
      weekUpdate,
      new Set([benchmarkRoutineId]),
      turn.timezone,
      turn.traceId,
      new Date(),
    );

    const writes: FileEntry[] = [
      ...benchmarkWrites,
      { path: PROGRESSIONS_PATH, content: progressionsContent },
      memoryWrite,
      { path: CURRENT_WEEK_PATH, content: weekContent },
    ];

    await commitFilesAtomic(writes, "coach: first session benchmark and first week", {
      repo: turn.repo,
      branch: resolveCoachChatBranch(),
      token: turn.token,
    });
    console.log("[coach-chat] first session benchmark and first week committed", {
      traceId: turn.traceId,
      benchmarkRoutineId,
      files: writes.length,
    });
  } catch (err) {
    console.error(
      "[coach-chat] first session benchmark generation failed - continuing without it:",
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
        // Two different counters, kept distinct on purpose (OpenRouter K1 retest finding): a
        // reader who sees a bare "droppedFacts: 0" here has no way to tell that from a turn that
        // actually dropped an action for a bad reference - droppedActionsValidation is what
        // counts that (buildTurnWrites' reference-validation drops), droppedFactsCommitFailures
        // is the late-write-failure count this function itself tracks.
        droppedFactsCommitFailures: commitFailureDrops.length,
        droppedActionsValidation: turn.droppedActions?.length ?? 0,
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
        reply: turn.finalReplyText,
      },
      { status: 502 },
    );
  }

  await generateFirstSessionWorkoutsAfterCompletion(turn);
  return Response.json({
    reply: turn.finalReplyText,
    threadId: turn.finalThreadId,
    threads: withComputedDayOffsets(pruneForResponse(turn.latestThreads), turn.timezone),
    repoSha,
    stale: turn.stale,
    profileComplete: turn.profileComplete,
    traceId: turn.traceId,
    droppedActions: [...(turn.droppedActions ?? []), ...commitFailureDrops],
  });
}
