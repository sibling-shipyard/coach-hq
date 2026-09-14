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
  repairBenchmarkSpecForInvariants,
  buildFallbackBenchmarkSpec,
  seedBenchmarkProgressions,
  inferTrainingAvailability,
  BENCHMARK_ROUTINE_ID,
} from "./decide/coachFirstSessionBenchmark.js";
import { compileFirstWeek } from "./decide/firstWeekCompile.js";
import { PROGRESSIONS_PATH } from "./decide/coachQuestFiles.js";
import {
  PROFILE_PATH,
  MEMORY_PATH,
  WEEKDAYS,
  type ProfileJson,
  type MemoryJson,
  type CoachLogJson,
} from "./decide/coachMemoryFiles.js";
import { renderCoachContext, renderQuestContext } from "./decide/coachContext.js";
import { askGemini, GEMINI_MODEL } from "./gemini/geminiClient.js";
import { sumUsage, type GeminiUsage } from "../../_lib/sentry.js";
import {
  captureGeminiFailure,
  captureValidationFailure,
  captureStillUnresolvedGuard,
} from "../../_lib/sentry.js";
import {
  validateQuestEvents,
  validateInjuryEvents,
  validateTemplateEdit,
  validateSessionPlan,
  validateWeekUpdate,
  synthesizeQuestEventFromUnrecordedFacts,
  hasConfirmationCue,
  questNameReferencedIn,
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
import { exerciseTypeFieldViolation } from "./decide/workoutSchema.js";

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
  // #1053 gap 2: real token usage summed across every askGemini() call this turn made (the first
  // call plus up to two reprompts - content-violation and bad-reference). Additive-only field, so
  // every caller still typed against a plain RepliedTurn/TurnWrites keeps working; nothing that
  // persists a turn's reply spreads the whole object into committed athlete data, so this never
  // reaches a file write. See usageResponseInit() below for how a test harness reads it back, via
  // a response header - deliberately not part of commitTurn's athlete-facing JSON response body.
  usage?: GeminiUsage;
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

// Live-verified (#727 review): reproduced twice in 5 real OpenRouter runs - a "reps"-type
// exercise with no reps field at all (not a wrong type, just omitted). Gemini's structured-output
// mode has no conditional-required support (a field required only when a sibling field has a
// given value isn't representable in this schema shape - see workout_create's own schema
// comment), so nothing stops the model from skipping it. The write path already refuses to commit
// this (never commit invalid data) - this is a pre-emptive structural check on the raw reply, one
// reprompt attempt before that refusal ever has to fire, same class of fix as
// findOversizedTextField above for a text cap. Checks only the two fields the live failure
// actually hit; the full invariant set (progression id, dose cap, injury ack) still gets its own
// enforcement at the write path regardless; this only catches what a reprompt can plausibly fix
// with a second, cheap generation.
// #1037 PR F: used to return on the first bad exercise found (string | null), so a second bad
// exercise surviving the reprompt tripped applyWorkoutCreate's all-or-nothing throw and dropped
// the whole routine - the reprompt only ever named one of the two problems. Collects every
// violation across every phase/exercise instead, same idea as workout_create.injury_ack's
// existing all-violations check (applyWorkoutCreate above, "active injury flag(s) not
// acknowledged" - already the one place in this codebase that reports every violation at once).
function findMalformedWorkoutCreateExercises(reply: GeminiReply): string[] | null {
  const spec = reply.workout_create;
  if (!spec) return null;
  const violations: string[] = [];
  for (const phase of spec.phases ?? []) {
    for (const ex of phase.exercises ?? []) {
      // Review finding (P2, #727 hardening): this used to hand-check reps/duration_secs presence
      // itself, duplicating workoutSchema.ts's validateExercise - real risk of the two drifting
      // apart, since that file is meant to be the one place this shape is defined. Reuses its
      // exported exerciseTypeFieldViolation instead; only the wording changed slightly (this
      // note's caller prefixes it with the exercise name either way).
      const violation = exerciseTypeFieldViolation(ex);
      if (violation) violations.push(`"${ex.name}" ${violation}`);
    }
  }
  return violations.length > 0 ? violations : null;
}

// Live-verified (#727 review, 2026-09-13): the Weekly Kick-off Ritual intermittently narrates a
// full 7-day plan in reply text (a day-by-day bulleted breakdown) without ever setting
// week_update - the athlete reads a plan that was never saved. A generic "did the reply describe
// something without the matching action" heuristic was rejected elsewhere in this file for real
// false-positive risk against ordinary conversation (see the rejected gap-2a discussion this PR's
// history references), but this specific shape isn't that: a reply naming 5+ distinct weekday
// names is not something ordinary coaching chat produces by accident, only a real day-by-day
// week narration does. Scoped to non-firstSession turns only, since a first-session athlete never
// gets week_update at all (see the firstSession prompt branch above). Reuses WEEKDAYS
// (coachMemoryFiles.ts) rather than a third hand-copied weekday list - coachFirstSessionBenchmark.ts
// already has its own WEEKDAY_PATTERN for a different purpose (P2, #727 review).
const PROSE_ONLY_WEEK_PLAN_WEEKDAY_THRESHOLD = 5;

function isProseOnlyWeekPlan(reply: GeminiReply, firstSession: boolean): boolean {
  if (firstSession || reply.week_update) return false;
  const lowerReply = reply.reply.toLowerCase();
  const mentionedWeekdays = WEEKDAYS.filter((day) => lowerReply.includes(day)).length;
  return mentionedWeekdays >= PROSE_ONLY_WEEK_PLAN_WEEKDAY_THRESHOLD;
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

// #1037 PR F: returning-athlete counterpart to findMissedHabitLanguage above. That check is safe
// because a first-session athlete with zero existing quests has nothing yet to be "referencing,"
// so the broad HABIT_LANGUAGE_PATTERN (every day/daily/habit/routine/track/log/streak) is safe to
// key on directly. That disambiguator doesn't hold once quests exist - an established athlete says
// "routine" and "track" constantly about existing training, not a new habit quest (#1009's own
// LLD flagged this exact false-positive risk when this gap was first scoped). So this doesn't
// reuse the broad pattern at all - it keys on explicit new-habit-starting phrasing only, language
// that implies *beginning* something rather than describing something already underway.
// Narrowed after a first draft ("going to start" plus any following word) was checked against
// ordinary training chat - "I'm going to start my long run tomorrow" matched it, which is exactly
// the false-positive class this needs to avoid. "going to start" now requires "new"/"habit" in the
// same phrase, same discipline every other keyed-language pattern in this file already follows.
const NEW_HABIT_LANGUAGE_PATTERN =
  /\b(start(?:ing)? a new habit|want to start (?:tracking|doing)|going to start (?:a )?new (?:daily )?habit|new daily habit)\b/i;

function findMissedNewHabitLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.firstSession) return null; // covered by findMissedHabitLanguage above
  if ((reply.season_start?.new_habits ?? []).length > 0) return null;
  if ((reply.quest_create?.quests ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, NEW_HABIT_LANGUAGE_PATTERN);
}

// Live-verified (#727 review, 2026-09-13): reproduced live twice - the athlete stated a goal
// (and often habits in the same message), the reply/coach_note narrated the season as "launched"
// or "locked in," but season_start was never actually set. Same three-part scoping as
// findMissedInjuryLanguage/findMissedHabitLanguage above, and same reason it's safe: checks the
// ATHLETE's own words for goal-declaring language, not the model's reply phrasing, so this can't
// misfire on the model's own narration style the way a reply-text keyword match could. Scoped to
// first-session only - a returning athlete's season_start moment is rarer and less dense
// (fewer competing facts in one message), and this exact failure was only observed there.
// Deliberately narrower than the habit/injury patterns above - an earlier draft included bare
// "target"/"targeting"/"aim(ing) for"/"training for" and two existing tests caught it colliding
// with ordinary first-session chat ("still reaching my weekly mileage target" isn't a season-start
// moment). Kept to phrasings specific enough that they essentially only show up when a real
// goal/season is being declared.
const GOAL_LANGUAGE_PATTERN =
  /\b(my goal|the goal is|want to (?:be|get|reach|run|hit|lift|lose|gain|become)|by (?:the )?end of)\b/i;

function findMissedSeasonLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  if (reply.season_start) return null;
  return firstMatch(turn.geminiMessage, GOAL_LANGUAGE_PATTERN);
}

// #1037 PR D: quest_event had no dedicated guard at all before this - its only backstop
// (synthesizeQuestEventFromUnrecordedFacts) rescues at most one completion and bails entirely
// once 2+ dropped facts each name-match a distinct quest, the exact multi-drop case that needs
// rescuing. Unlike the boolean findMissed*Language checks above, this one counts: it compares the
// number of active quests the athlete's own message names alongside completion/miss/excusal
// language against reply.quest_event.length, so "2 of 3 landed" still fires instead of being
// suppressed by the array being non-empty. Reuses questNameReferencedIn (validateActions.ts) for
// the actual name-matching rather than duplicating that logic.
// This is a LOWER BOUND, not an exact count - a quest name mentioned without status language
// nearby, or two quests with overlapping name words, can both misfire. Same risk class
// GOAL_LANGUAGE_PATTERN and sports_update's NEW_ACTIVITY_LANGUAGE_PATTERN already carry - run the
// full api/coach-chat/ suite after wiring this in and narrow on any collision, never drop the check.
const QUEST_STATUS_LANGUAGE_PATTERN =
  /\b(complet(?:ed|ing)|done|finish(?:ed)?|hit|nailed|crushed|missed|skip(?:ped)?|excused)\b/i;

function findMissedQuestLanguage(turn: TurnState, reply: GeminiReply): string | null {
  const activeQuests = (turn.context.quests?.quests ?? []).filter((q) => q.status === "active");
  if (activeQuests.length === 0) return null;
  if (!QUEST_STATUS_LANGUAGE_PATTERN.test(turn.geminiMessage)) return null;
  const mentionedNames = activeQuests.filter((q) =>
    questNameReferencedIn(q.name, turn.geminiMessage),
  );
  const capturedIds = new Set((reply.quest_event ?? []).map((e) => e.quest_id));
  const uncaptured = mentionedNames.filter((q) => !capturedIds.has(q.id));
  return uncaptured.length > 0 ? uncaptured.map((q) => q.name).join(", ") : null;
}

// #1009 (profile_update hardening): same scoping as the checks above - first-session
// only, since that's the only turn type where a stated age/height/weight/timezone is reliably
// new rather than a restatement of something already on file. Four independent field checks
// (dob, height_cm, weight_kg, timezone), each gated on its own "is this actually missing" check
// (no value on file yet AND no matching profile_update entry this turn for that specific field) -
// a bare number or "based in" phrase means nothing on its own without that gate, and would
// otherwise collide constantly with ordinary first-session chat. height_cm and weight_kg share
// BODY_METRIC_PATTERN since one regex matches either unit, but they're checked separately so the
// model capturing one doesn't suppress a reprompt for the other still being missing. Keys on the
// athlete's own message, never the model's reply/coach_note phrasing, for the same reason
// findMissedInjuryLanguage/findMissedHabitLanguage/findMissedSeasonLanguage do.
const AGE_LANGUAGE_PATTERN = /\b\d{1,2}\s*(?:years?\s*old|yo)\b|\bborn\b/i;
const BODY_METRIC_PATTERN = /\b\d{2,3}\s*(?:cm|kg|lbs?|ft|feet|inches)\b/i;
const TIMEZONE_LANGUAGE_PATTERN = /\bbased in\b|\btime ?zone\b|\bIST\b|\bGMT\b|\bUTC\b/i;

function findMissedProfileLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (!turn.firstSession) return null;
  const updatedFields = new Set((reply.profile_update ?? []).map((u) => u.field));
  const profile = turn.context.profile;
  if (!profile?.dob && !updatedFields.has("dob")) {
    const hit = firstMatch(turn.geminiMessage, AGE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.height_cm && !updatedFields.has("height_cm")) {
    const hit = firstMatch(turn.geminiMessage, BODY_METRIC_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.weight_kg && !updatedFields.has("weight_kg")) {
    const hit = firstMatch(turn.geminiMessage, BODY_METRIC_PATTERN);
    if (hit) return hit;
  }
  if (!profile?.timezone && !updatedFields.has("timezone")) {
    const hit = firstMatch(turn.geminiMessage, TIMEZONE_LANGUAGE_PATTERN);
    if (hit) return hit;
  }
  return null;
}

// #1009 (workout_remove hardening): returning-athlete only - a first-session athlete has no
// existing routines yet (coachPromptText.ts explicitly withholds workout_remove on that branch),
// so there's nothing to remove and this check would never have anything real to key on. No
// id-set check here on purpose - applyWorkoutRemove (decide/coachWorkoutFiles.ts) already throws
// if the model invents an id not in the real manifest, which is the right layer for a "removed
// the wrong thing" failure. This detector only asks whether the athlete described removing
// something that the model never acted on at all.
const REMOVAL_LANGUAGE_PATTERN =
  /\b(delete|remove|get rid of|don'?t want)\b.{0,20}\b(routine|workout|template)\b/i;

function findMissedRemovalLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.firstSession) return null;
  if (reply.workout_remove) return null;
  return firstMatch(turn.geminiMessage, REMOVAL_LANGUAGE_PATTERN);
}

// #1009 (sports_update hardening): deliberately the narrowest pattern in this set. A bare sport
// name risks matching an ordinary session report with no update intent at all ("badminton was
// rough today" is not a sports_update moment), so this keys only on explicit new-activity
// phrasing, never a sport name alone. Runs on every turn, not gated to first-session or
// returning - a new/changed sport can arrive on either.
const NEW_ACTIVITY_LANGUAGE_PATTERN = /\b(started|new sport|picked up|also (?:play|do|doing))\b/i;

function findMissedSportsLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if ((reply.sports_update ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, NEW_ACTIVITY_LANGUAGE_PATTERN);
}

// #1009 (injury_event hardening): the opposite scoping problem from findMissedInjuryLanguage
// above. That check is safe because zero active flags means any injury language is necessarily
// new. Here flags already exist, which is exactly what makes plain injury language ambiguous - is
// the athlete updating a known flag, reporting a brand-new one (injury_flag), or just describing
// ordinary training discomfort that isn't flag-worthy at all? The narrow, safe version: only fire
// when EXACTLY ONE active flag exists, since "which injury" stops being ambiguous once there's
// only one candidate. Deliberately not scoped to firstSession like its sibling - injury updates
// are a returning-athlete-dominant flow, and the single-active-flag condition is what makes this
// safe instead of the first-session/zero-flags disambiguator the sibling uses. Reuses the existing
// INJURY_LANGUAGE_PATTERN rather than a new one - same phrasing, different gate.
// Known scope boundary, not an oversight: with 2+ active flags this stays silent even when the
// athlete clearly describes an injury changing, because there's no safe way to tell which flag
// they mean without risking a reprompt on an ordinary 1-of-many mention. See the dedicated test
// below confirming this is deliberate.
function findMissedInjuryUpdateLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if ((turn.activeInjuryFlagIds ?? new Set()).size !== 1) return null;
  if ((reply.injury_event ?? []).length > 0) return null;
  if ((reply.injury_flag ?? []).length > 0) return null;
  return firstMatch(turn.geminiMessage, INJURY_LANGUAGE_PATTERN);
}

// #1037 PR D: returning-athlete counterpart to findMissedInjuryLanguage, and also the fix for
// findMissedInjuryUpdateLanguage's 2+-flag blind spot above - one function covers both gaps since
// they share INJURY_LANGUAGE_PATTERN and the same "did fewer things land than were described"
// question. Not scoped to "zero flags" (that disambiguator only makes sense pre-onboarding) and
// not scoped to exactly one flag either - resolving WHICH flag a bare mention means is
// findMissedInjuryUpdateLanguage's job (single-active-flag only); this only asks whether the
// count of things captured (injury_flag + injury_event entries) is lower than the count of real,
// distinct injury mentions in the message. A lower bound, not exact matching to a specific flag.
//
// INJURY_LANGUAGE_PATTERN matches keywords like "sore"/"hurt"/"pain" - a single injury described
// across two sentences ("my knee still hurts, it's sore in the mornings") produces 2 keyword hits
// for 1 real injury, which would over-count and false-positive a reprompt for an injury already
// captured once. Raw per-keyword counting isn't safe to ship as-is.
//
// I originally tried collapsing keyword hits purely by word-distance (hits within N words of the
// prior hit collapse together), on the theory that a real second injury needs its own
// location/context words first and so sits farther from the prior keyword than a restated hit on
// the same injury does. That doesn't hold up: "My ankle hurts, my knee hurts too, and my shoulder
// is sore" has three genuinely distinct injuries whose keyword hits are only ~5 words apart
// pairwise - well inside any window wide enough to also catch the restated-nearby case - so a
// pure word-distance heuristic collapses all three into one and silently drops two real injuries.
// Word distance alone can't tell "one injury restated nearby" from "several different injuries
// listed close together," because both patterns produce similar gaps between keyword hits.
//
// The actual distinguishing signal is body location. A real second injury almost always names its
// own body part ("my ankle... my knee... my shoulder"); a restated mention of the same injury
// usually either drops the location entirely (a pronoun or ellipsis - "it's still sore," "still
// hurts in the mornings") or repeats the same location word. So I match on the nearest named body
// part around each hit first, and only fall back to word-distance from the last counted hit when a
// hit has no location word nearby at all (a bare "it hurts" with nothing named) - which keeps the
// old, simpler behavior for that edge case. Verified in the test suite against: three distinct
// injuries close together (must all count, the case above), one injury restated nearby (must not
// double-count), and the plain word-distance fallback with no location word present.
const INJURY_MENTION_COLLAPSE_WINDOW_WORDS = 12;

// Common body-part/location vocabulary - the signal that lets countDistinctInjuryMentions tell a
// restated mention of the same injury apart from a second, genuinely different one. Not
// exhaustive, just the common set an athlete would actually say out loud when talking about a
// running/lifting injury. Deliberately leaves out "head"/"skull" - "head" gets used
// non-anatomically constantly in ordinary chat ("in my head," "ahead of," "get ahead") and the
// false-positive cost of that outweighs the rare real case of a head injury, which an athlete
// would almost always also name explicitly (concussion, headache) rather than relying on this
// detector.
//
// I considered replacing this fixed list with "match any noun phrase after 'my'" so new terms
// never need a manual add. Not doing that here - "my training," "my coach," "my week" aren't body
// parts, and that approach needs its own false-positive narrowing pass against the test corpus
// before it's safe to ship. Left as a future option, not built.
const BODY_LOCATION_WORDS = [
  "ankle",
  "ankles",
  "knee",
  "knees",
  "shoulder",
  "shoulders",
  "back",
  "hip",
  "hips",
  "wrist",
  "wrists",
  "elbow",
  "elbows",
  "foot",
  "feet",
  "calf",
  "calves",
  "hamstring",
  "hamstrings",
  "quad",
  "quads",
  "quadricep",
  "quadriceps",
  "groin",
  "neck",
  "shin",
  "shins",
  "achilles",
  "hand",
  "hands",
  "thigh",
  "thighs",
  "toe",
  "toes",
  "heel",
  "heels",
  "rib",
  "ribs",
  "glute",
  "glutes",
  "IT band",
  "iliotibial band",
  "tendon",
  "tendons",
  "tendinitis",
  "ligament",
  "ligaments",
  "cartilage",
  "meniscus",
  "rotator cuff",
  "labrum",
  "plantar fascia",
  "plantar fasciitis",
  "sciatic",
  "sciatica",
  "spine",
  "spinal",
  "chest",
  "pec",
  "pecs",
  "forearm",
  "forearms",
  "bicep",
  "biceps",
  "tricep",
  "triceps",
  "jaw",
  "abdomen",
  "abs",
  "core",
  "lat",
  "lats",
];
const LOCATION_PATTERN = new RegExp(`\\b(${BODY_LOCATION_WORDS.join("|")})\\b`, "i");

// Trailing "s" on a matched word almost always means a simple plural ("ankles" -> "ankle"), so
// stripping it collapses plural/singular phrasing of the same injury onto the same key. A few
// medical terms end in "s" without being plural at all - stripping those would mangle the key
// (e.g. "tendinitis" -> "tendiniti", "meniscus" -> "meniscu"). Those all end in "itis" or "us", so
// checking for those suffixes first is enough to spare them without hand-listing every term.
const LOCATION_FALSE_PLURAL_SUFFIXES = ["itis", "us"];

function normalizeLocationWord(word: string): string {
  const lower = word.toLowerCase();
  if (LOCATION_FALSE_PLURAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return lower;
  return lower.replace(/s$/, "");
}

// Looks for a body-location word in a small window of words around a hit rather than across the
// whole message, so a location word describing a different sentence/injury far away doesn't get
// wrongly attributed to this hit. Scans word-by-word and keeps the CLOSEST match by distance from
// the hit, not the first one the window happens to contain in reading order - two hits close
// together can have overlapping windows, and taking "first match in the joined window text" would
// attribute both to whichever location word appears earliest, even when a closer, different one
// exists for the second hit.
//
// Checks a 2-word phrase starting at each index before falling back to the single word there, so
// multi-word terms ("IT band," "rotator cuff," "plantar fasciitis") match - LOCATION_PATTERN can
// only match against whatever string it's handed, and a single word from the `words` array never
// contains a 2-word phrase on its own.
//
// Also checks for "left"/"right" immediately before the matched location word ("my left knee") and
// folds it into the returned key, so two mentions of the same body part on opposite sides count as
// distinct injuries instead of collapsing into one. Only checks directly-preceding words - rarer
// phrasing like "knee on my left side" isn't worth the added complexity here. Laterality is always
// optional: with no "left"/"right" nearby, the bare word comes back unchanged.
function nearestLocationWord(words: string[], hitWordIndex: number): string | null {
  const windowRadius = 5;
  const start = Math.max(0, hitWordIndex - windowRadius);
  const end = Math.min(words.length, hitWordIndex + windowRadius + 1);
  let closest: { word: string; distance: number; index: number } | null = null;
  for (let i = start; i < end; i++) {
    // Try the 2-word phrase starting here first, but only trust it if the match actually spans
    // both words (contains a space) - LOCATION_PATTERN also holds single-word alternatives, and
    // `${words[i]} ${words[i + 1]}`.match(...) can match just one of those inside the joined
    // string (e.g. "my glute" matching plain "glute"). Taking that as a hit here would credit the
    // match to index i (the first word) instead of where the word actually is, throwing off the
    // distance comparison against genuinely closer hits. Falling through to the single-word check
    // on words[i] keeps that case anchored at its real index.
    const twoWord = i + 1 < end ? `${words[i]} ${words[i + 1]}` : null;
    const twoWordMatch = twoWord ? twoWord.match(LOCATION_PATTERN) : null;
    const found =
      twoWordMatch && twoWordMatch[0].includes(" ")
        ? twoWordMatch
        : words[i].match(LOCATION_PATTERN);
    if (!found) continue;
    const distance = Math.abs(i - hitWordIndex);
    if (!closest || distance < closest.distance) {
      closest = { word: normalizeLocationWord(found[0]), distance, index: i };
    }
  }
  if (!closest) return null;
  const precedingWords = words
    .slice(Math.max(0, closest.index - 2), closest.index)
    .join(" ")
    .toLowerCase();
  const laterality = /\b(left|right)\b/.exec(precedingWords)?.[1];
  return laterality ? `${laterality} ${closest.word}` : closest.word;
}

function countDistinctInjuryMentions(text: string): string[] {
  const pattern = new RegExp(INJURY_LANGUAGE_PATTERN, "gi");
  const words = text.split(/\s+/).filter(Boolean);
  const hits: { keyword: string; wordIndex: number; location: string | null }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const wordIndex = text.slice(0, match.index).split(/\s+/).filter(Boolean).length;
    hits.push({ keyword: match[0], wordIndex, location: nearestLocationWord(words, wordIndex) });
  }
  const distinct: { keyword: string; wordIndex: number; location: string | null }[] = [];
  for (const hit of hits) {
    // Same named body part as an already-counted mention - same real injury, collapse it.
    if (hit.location !== null && distinct.some((counted) => counted.location === hit.location)) {
      continue;
    }
    // No location word nearby at all - fall back to word-distance from the last counted hit
    // (comparing to the last DISTINCT hit here, not the last raw hit, unlike the old version).
    const lastCounted = distinct[distinct.length - 1];
    if (
      hit.location === null &&
      lastCounted &&
      hit.wordIndex - lastCounted.wordIndex <= INJURY_MENTION_COLLAPSE_WINDOW_WORDS
    ) {
      continue;
    }
    distinct.push(hit);
  }
  return distinct.map((counted) => counted.keyword);
}

function findUncountedInjuryLanguage(turn: TurnState, reply: GeminiReply): string | null {
  if (turn.firstSession) return null; // covered by findMissedInjuryLanguage above
  const mentions = countDistinctInjuryMentions(turn.geminiMessage);
  if (mentions.length === 0) return null;
  const captured = (reply.injury_flag ?? []).length + (reply.injury_event ?? []).length;
  return mentions.length > captured ? mentions[captured] : null;
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
// #1037 PR F: used to `.find` and return on the first bad id across quest_event/injury_event -
// a second bad id in the same reply got no mention in the reprompt at all, so the corrective call
// could fix one and leave the other for layer 3 to silently drop. Not a correctness bug -
// validateActions.ts's per-entry drop logic already handles multiple bad ids at commit time
// regardless of what the reprompt says - this only makes the reprompt message Gemini sees more
// complete, so its retry has full information instead of playing whack-a-mole one id at a time.
function findInvalidReferences(
  reply: GeminiReply,
  validQuestIds: ReadonlySet<string>,
  validInjuryFlagIds: ReadonlySet<string>,
): { field: string; badId: string; validIds: readonly string[] }[] | null {
  const badQuestEvents = (reply.quest_event ?? [])
    .filter((event) => event.quest_id != null && !validQuestIds.has(event.quest_id))
    .map((event) => ({
      field: "quest_event",
      badId: event.quest_id,
      validIds: [...validQuestIds],
    }));
  const badInjuryEvents = (reply.injury_event ?? [])
    .filter((event) => event.flag_id != null && !validInjuryFlagIds.has(event.flag_id))
    .map((event) => ({
      field: "injury_event",
      badId: event.flag_id,
      validIds: [...validInjuryFlagIds],
    }));
  const all = [...badQuestEvents, ...badInjuryEvents];
  return all.length > 0 ? all : null;
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

// sumUsage now lives in sentry.ts (next to GeminiUsage itself, imported above) so
// geminiClient.ts's own JSON-parse retry can reuse the exact same merge instead of hand-rolling a
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
  usage: GeminiUsage | undefined,
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
    let usageAccum: GeminiUsage | undefined = reply.usage;
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
    const missedNewHabitLanguage = findMissedNewHabitLanguage(turn, reply);
    const missedSeasonLanguage = findMissedSeasonLanguage(turn, reply);
    const missedProfileLanguage = findMissedProfileLanguage(turn, reply);
    const missedRemovalLanguage = findMissedRemovalLanguage(turn, reply);
    const missedSportsLanguage = findMissedSportsLanguage(turn, reply);
    const missedInjuryUpdateLanguage = findMissedInjuryUpdateLanguage(turn, reply);
    const missedQuestLanguage = findMissedQuestLanguage(turn, reply);
    const uncountedInjuryLanguage = findUncountedInjuryLanguage(turn, reply);
    const unconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
    const malformedExercises = findMalformedWorkoutCreateExercises(reply);
    const proseOnlyWeekPlan = isProseOnlyWeekPlan(reply, turn.firstSession);
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
      missedNewHabitLanguage ||
      missedSeasonLanguage ||
      missedProfileLanguage ||
      missedRemovalLanguage ||
      missedSportsLanguage ||
      missedInjuryUpdateLanguage ||
      missedQuestLanguage ||
      uncountedInjuryLanguage ||
      unconfirmedAssumption ||
      malformedExercises ||
      proseOnlyWeekPlan
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
        missedInjuryUpdateLanguage,
        missedQuestLanguage,
        uncountedInjuryLanguage,
        unconfirmedAssumption,
        malformedExercises,
        proseOnlyWeekPlan,
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
      if (proseOnlyWeekPlan) {
        notes.push(
          "your reply describes a full week's plan (multiple named weekdays) but week_update" +
            " was never set - if you are genuinely committing this week now, set week_update with" +
            " the same days/sessions you just described; the athlete cannot see anything you only" +
            " wrote in the reply text",
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
      const stillMissedInjuryUpdateLanguage = findMissedInjuryUpdateLanguage(turn, reply);
      const stillMissedQuestLanguage = findMissedQuestLanguage(turn, reply);
      const stillUncountedInjuryLanguage = findUncountedInjuryLanguage(turn, reply);
      const stillUnconfirmedAssumption = findUnconfirmedAssumption(turn, reply);
      const stillMalformedExercises = findMalformedWorkoutCreateExercises(reply);
      const stillProseOnlyWeekPlan = isProseOnlyWeekPlan(reply, turn.firstSession);
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
        stillMissedNewHabitLanguage ||
        stillMissedSeasonLanguage ||
        stillMissedProfileLanguage ||
        stillMissedRemovalLanguage ||
        stillMissedSportsLanguage ||
        stillMissedInjuryUpdateLanguage ||
        stillMissedQuestLanguage ||
        stillUncountedInjuryLanguage ||
        stillUnconfirmedAssumption ||
        stillMalformedExercises ||
        stillProseOnlyWeekPlan
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
            stillMissedInjuryUpdateLanguage,
            stillMissedQuestLanguage,
            stillUncountedInjuryLanguage,
            stillUnconfirmedAssumption,
            stillMalformedExercises,
            stillProseOnlyWeekPlan,
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
            stillMissedInjuryUpdateLanguage ? "missedInjuryUpdateLanguage" : null,
            stillMissedQuestLanguage ? "missedQuestLanguage" : null,
            stillUncountedInjuryLanguage ? "uncountedInjuryLanguage" : null,
            stillUnconfirmedAssumption ? "unconfirmedAssumption" : null,
            stillMalformedExercises ? "malformedExercises" : null,
            stillProseOnlyWeekPlan ? "proseOnlyWeekPlan" : null,
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
        turn.geminiMessage,
        `\n[System note: ${badReferenceNotes}. Redo each field using only a valid id, or omit it`,
        "if none apply; keep everything else the same.]",
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
      usage: usageAccum,
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
    turn.geminiMessage,
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

// Review finding (P2, #727 hardening): factored out of two near-identical read/merge-patch call
// sites that both cleared this same field (the standalone stale-marker path below, and the
// success-path clear inline in generateFirstSessionWorkoutsAfterCompletion) - same fresh-read,
// same patch shape, same warning on failure. Returns the FileEntry to commit, or null if there was
// nothing to write (no profile content, or the patch itself failed) - callers decide whether to
// commit it standalone or append it to a batch already in flight.
async function buildClearPendingWrite(turn: TurnWrites): Promise<FileEntry | null> {
  const freshProfileContent = await getFileRaw(turn.repo, PROFILE_PATH, turn.token);
  if (!freshProfileContent) return null;
  const cleared = applyJsonMergePatch(
    freshProfileContent,
    // Resets the attempt counter too, not just pending - if pending ever legitimately gets set
    // true again later (a fresh signup edge case, not the retry loop this counts), it should start
    // counting from zero rather than carrying over a stale count from an unrelated earlier attempt.
    JSON.stringify({ first_session_benchmark_pending: false, first_session_benchmark_attempts: 0 }),
  );
  if (!cleared.ok) {
    console.warn(`[coach-chat] could not clear first_session_benchmark_pending: ${cleared.error}`, {
      traceId: turn.traceId,
    });
    return null;
  }
  return { path: PROFILE_PATH, content: cleared.content };
}

// Standalone commit for the case generateFirstSessionWorkoutsAfterCompletion finds the benchmark
// already in the manifest but the marker still pending - a prior turn's own clear (below, folded
// into that turn's benchmark commit) must have dropped. There's no other write to piggyback on
// here, unlike the main path, so this is its own small commit rather than appended to `writes`.
async function clearFirstSessionBenchmarkPending(turn: TurnWrites): Promise<void> {
  const write = await buildClearPendingWrite(turn);
  if (!write) return;
  await commitFilesAtomic([write], "coach: clear stale first_session_benchmark_pending marker", {
    repo: turn.repo,
    branch: resolveCoachChatBranch(),
    token: turn.token,
  });
}

// Review finding (P1, #727 hardening): without a cap, a real failure unrelated to spec validity
// (a commit error, a transient GitHub API failure) left first_session_benchmark_pending stuck true
// forever - every future turn re-ran the full generation attempt with no backoff. 3 attempts is
// generous given the fallback spec is structurally safe from every invariant this pipeline checks;
// past this, whatever's failing is not something a 4th identical attempt will fix.
const FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS = 3;

// Writes one benchmark routine (coachFirstSessionBenchmark.ts's buildBenchmarkSpec, compiled
// through the same applyWorkoutCreate/buildWorkoutCreateAndRemoveWrites path an ordinary
// workout_create turn uses), seeds one progression per benchmarked pattern, derives the structured
// training_availability field from memory's existing intake prose, and compiles a real first week
// (firstWeekCompile.ts) that places the benchmark and anchor sessions on the athlete's stated
// training days. All one commit, and never allowed to block or fail the athlete's reply - none of
// this is on the critical path of the turn's own response, so a failure here only logs and moves
// on.
//
// Gated on first_session_benchmark_pending (profile.json), not on the wasProfileComplete
// transition alone (#727 retry fix). isAthleteProfileComplete (coachChatFiles.ts) is a
// field-presence check recomputed every turn from current profile/memory/seasons content, so it
// stays true forever once an athlete's profile is complete - a live-verified regression (#727
// review) found that gating on "profileComplete is true" alone made this fire, and commit a
// synthetic first week, on every single ordinary turn from any already-established athlete, since
// it has no reason to ever get the benchmark's id into its manifest otherwise. The pending marker
// (coachSinceStamp.ts's injectCoachSinceIfNeeded, set in the same merge patch as coach_since on
// the real false->true transition) is the durable version of that same one-shot signal: an
// already-established athlete never gets it set, so this still never fires for them, but a
// genuinely new signup whose first attempt threw stays pending and gets retried on the very next
// turn instead of being stuck forever. Cleared below only once a benchmark actually commits.
// ALSO gated on the benchmark's own routine id being absent from the manifest, not on the
// manifest merely existing - carve-skeleton now seeds a manifest with two starter templates at
// carve time (A4), so "does a manifest exist" was always true and this never ran for a freshly
// carved repo either (the original P0, #727 review).
export async function generateFirstSessionWorkoutsAfterCompletion(turn: TurnWrites): Promise<void> {
  const firstSessionTransition = !turn.wasProfileComplete && turn.profileComplete;
  const pendingFromEarlierAttempt = turn.context.profile?.first_session_benchmark_pending === true;
  if (!turn.profileComplete || (!firstSessionTransition && !pendingFromEarlierAttempt)) return;
  const attemptsSoFar = turn.context.profile?.first_session_benchmark_attempts ?? 0;
  if (attemptsSoFar >= FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS) {
    console.error(
      `[coach-chat] first session benchmark generation gave up after ${attemptsSoFar} failed` +
        " attempts - clearing pending instead of retrying again",
      { traceId: turn.traceId },
    );
    const write = await buildClearPendingWrite(turn);
    if (write) {
      await commitFilesAtomic(
        [write],
        "coach: give up on first session benchmark after repeated failures",
        { repo: turn.repo, branch: resolveCoachChatBranch(), token: turn.token },
      );
    }
    return;
  }
  try {
    const manifestContent = await getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token);
    const existingRoutineIds = validTemplateIdsFromManifest(manifestContent);
    if (existingRoutineIds.has(BENCHMARK_ROUTINE_ID)) {
      // The benchmark already landed on some earlier turn, but pending is still true - the
      // profile write that was supposed to clear it alongside that commit must have dropped
      // (stale getFileRaw, a bad merge patch). Without this, every future turn would keep
      // re-fetching the manifest and bailing right here, never reaching the clear below.
      if (pendingFromEarlierAttempt) await clearFirstSessionBenchmarkPending(turn);
      return;
    }

    const memory = turn.projectedMemory;
    const injuries = turn.context.injuries ?? { flags: [] };
    const activeInjuryFlagIds = new Set(
      injuries.flags.filter((f) => f.status === "active").map((f) => f.id),
    );
    const progressions = turn.context.progressions ?? null;

    // Fix 1: repair the generated spec against the two invariants that depend on repo state
    // buildBenchmarkSpec doesn't see fresh at call time (dose vs. a since-updated progression,
    // an injury flag the caller knows about that the spec didn't). Fix 2: if a repaired spec
    // still somehow trips an invariant, fall back to one fixed bodyweight movement structurally
    // incapable of tripping any of them, so a benchmark + first week always commits.
    const generatedSpec = repairBenchmarkSpecForInvariants(
      buildBenchmarkSpec(memory, injuries),
      progressions,
      activeInjuryFlagIds,
    );
    let { writes: benchmarkWrites, dropped } = buildWorkoutCreateAndRemoveWrites(
      turn.traceId,
      generatedSpec,
      undefined,
      existingRoutineIds,
      activeInjuryFlagIds,
      progressions,
    );
    let spec = generatedSpec;
    if (dropped.length > 0 || benchmarkWrites.length === 0) {
      console.error(
        "[coach-chat] repaired first session benchmark spec still invalid - falling back:",
        dropped.map((d) => d.reason).join("; ") || "workout_create produced no writes",
        { traceId: turn.traceId },
      );
      const fallbackSpec = buildFallbackBenchmarkSpec(activeInjuryFlagIds);
      const fallbackResult = buildWorkoutCreateAndRemoveWrites(
        turn.traceId,
        fallbackSpec,
        undefined,
        existingRoutineIds,
        activeInjuryFlagIds,
        null,
      );
      if (fallbackResult.dropped.length > 0 || fallbackResult.writes.length === 0) {
        throw new Error(
          fallbackResult.dropped.map((d) => d.reason).join("; ") ||
            "fallback workout_create produced no writes",
        );
      }
      spec = fallbackSpec;
      benchmarkWrites = fallbackResult.writes;
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

    // Clear first_session_benchmark_pending (and the attempt counter) in the same atomic commit
    // as the benchmark itself - the marker only exists to make a failed attempt retryable, so it
    // must come off exactly when (and only when) a benchmark actually lands, never before. Reading
    // fresh here (not turn.context.profile, loaded at the top of the turn) picks up the
    // pending:true this same turn's own commitTurn facts-commit may have just written on a real
    // transition turn.
    const clearPendingWrite = await buildClearPendingWrite(turn);
    if (clearPendingWrite) writes.push(clearPendingWrite);

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
    // Review finding (P1, #727 hardening): records the failed attempt so the cap check at the top
    // of this function can eventually give up instead of retrying forever - see
    // FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS. Its own failure (a bad read, a bad patch, a commit
    // error) only logs - this is already inside the outermost catch, so there's nothing further to
    // fall back to, and the athlete's turn must still complete either way.
    try {
      const freshProfileContent = await getFileRaw(turn.repo, PROFILE_PATH, turn.token);
      if (freshProfileContent) {
        const incremented = applyJsonMergePatch(
          freshProfileContent,
          JSON.stringify({ first_session_benchmark_attempts: attemptsSoFar + 1 }),
        );
        if (incremented.ok) {
          await commitFilesAtomic(
            [{ path: PROFILE_PATH, content: incremented.content }],
            "coach: record failed first session benchmark attempt",
            { repo: turn.repo, branch: resolveCoachChatBranch(), token: turn.token },
          );
        } else {
          console.warn(
            `[coach-chat] could not record failed first session benchmark attempt: ${incremented.error}`,
            { traceId: turn.traceId },
          );
        }
      }
    } catch (attemptErr) {
      console.error(
        "[coach-chat] could not record failed first session benchmark attempt:",
        attemptErr,
        { traceId: turn.traceId },
      );
    }
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
    // Gemini already ran and was billed by this point regardless of whether the commit itself
    // succeeds - drop the usage header here too and a harness reading it sees $0 for a turn that
    // really cost money (review finding).
    return Response.json(
      {
        error: `Coach replied but saving failed: ${message}`,
        traceId: turn.traceId,
        reply: turn.finalReplyText,
      },
      usageResponseInit(turn.usage, { status: 502 }),
    );
  }

  await generateFirstSessionWorkoutsAfterCompletion(turn);
  return Response.json(
    {
      reply: turn.finalReplyText,
      threadId: turn.finalThreadId,
      threads: withComputedDayOffsets(pruneForResponse(turn.latestThreads), turn.timezone),
      repoSha,
      stale: turn.stale,
      profileComplete: turn.profileComplete,
      traceId: turn.traceId,
      droppedActions: [...(turn.droppedActions ?? []), ...commitFailureDrops],
    },
    usageResponseInit(turn.usage),
  );
}
