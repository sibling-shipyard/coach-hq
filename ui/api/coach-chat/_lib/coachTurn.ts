import { commitFilesAtomic, type FileEntry } from "../../_lib/githubGitData.js";
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import {
  getFileRaw,
  getHeadSha,
  invalidateCoachContext,
  isFirstSessionRitualDone,
  loadCoachContext,
  parseJsonOrNull,
  resolveCoachChatBranch,
} from "./coachChatFiles.js";
import {
  withComputedDayOffsets,
  todayDividerLabel,
  todayDateString,
} from "./coachDay.js";
import {
  acceptedMessage,
  messageForGemini,
  shouldRequestClose,
} from "./closeSignal.js";
import {
  appendConversationTurn,
  loadChatHistory,
  type ChatMessage,
  type ChatThread,
} from "./chatThreads.js";
import {
  loadClosingFileContext,
  injectCoachSinceIfNeeded,
  type ClosingFileContext,
} from "./coachSinceStamp.js";
import { generateInitialTemplates, validTemplateIdsFromManifest, TEMPLATES_MANIFEST_PATH } from "./coachWorkoutFiles.js";
import { CURRENT_WEEK_PATH } from "./coachWeekFiles.js";
import { PROFILE_PATH, type ProfileJson, type MemoryJson } from "./coachMemoryFiles.js";
import { renderCoachContext, renderQuestContext } from "./coachContext.js";
import { askGemini } from "./geminiClient.js";
import {
  combineExtraContext,
  activeTemplatesContext,
  activeWeekSessionsContext,
  firstSessionContext,
  type OnboardingHints,
} from "./coachPromptText.js";
import type { GeminiReply } from "./coachReplySchema.js";
import { FIRST_SESSION_PROTOCOL } from "../../_generated/soul.js";
import { fspIncrementalWrites, ordinaryTurnResponse } from "./fspWrites.js";
import { buildChatWrite } from "./turnWrites/chatWrite.js";
import { buildCoachNoteWrite } from "./turnWrites/coachNoteWrite.js";
import { buildMemoryFileWrite } from "./turnWrites/memoryWrite.js";
import { buildInjuryEventWrite } from "./turnWrites/injuryWrite.js";
import { buildQuestEventWrite, buildQuestCreateWrite } from "./turnWrites/questWrite.js";
import { buildSeasonStartWrite } from "./turnWrites/seasonWrite.js";
import { buildProfileUpdateWrite, projectProfileCompletion } from "./turnWrites/profileWrite.js";
import { buildTemplateEditWrite, buildSessionPlanWrite } from "./turnWrites/workoutWrite.js";
import { buildCurrentWeekWrite } from "./turnWrites/weekWrite.js";

import {
  parseActivityIds,
  type ActivitySyncRequest,
} from "./activitySync.js";

interface PostBody {
  threadId?: string;
  messages?: ChatMessage[];
  message?: string;
  action?: "greet" | "activity_sync";
  activity_ids?: unknown;
  knownSha?: string;
  onboardingHints?: OnboardingHints;
  endConversationRequested?: boolean;
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
  endConversationRequested: boolean;
}

interface TurnState extends TurnRequest {
  repo: string;
  token: string;
  apiKey: string;
  currentSha: string | null;
  stale: boolean;
  context: Awaited<ReturnType<typeof loadCoachContext>>;
  timezone: string;
  athleteContext: string;
  questContext: string;
  firstSession: boolean;
  closeIntent: boolean;
  now: number;
  traceId: string;
  userMsg?: Extract<ChatMessage, { role: "user" }>;
  closingFiles?: ClosingFileContext;
  validTemplateIds: ReadonlySet<string>;
  weekSessionsForContext: {
    id: string;
    date: string;
    title: string;
    status: string;
  }[];
}

interface RepliedTurn extends TurnState {
  reply: GeminiReply;
  closing: boolean;
}

export interface TurnWrites extends RepliedTurn {
  chatWrite: FileEntry;
  latestThreads: ChatThread[];
  finalThreadId: string;
  computedTitle: string;
  trimmedCoachNote?: string;
  optionalWrites: FileEntry[];
  fspCandidates: (FileEntry | undefined)[];
  validUpdates: FileEntry[];
  wasProfileComplete: boolean;
  profileComplete: boolean;
  projectedProfile: ProfileJson;
  projectedMemory: MemoryJson;
}

export async function handleHistory(
  repo: string,
  token: string,
): Promise<Response> {
  const [history, context] = await Promise.all([
    loadChatHistory(repo, token),
    loadCoachContext(repo, token),
  ]);
  const timezone = context.profile?.timezone?.trim() || "UTC";
  return Response.json({
    threads: withComputedDayOffsets(history.threads, timezone),
  });
}

export async function parseTurnRequest(
  req: Request,
): Promise<Response | GreetRequest | TurnRequest | ActivitySyncRequest> {
  const body = (await req.json()) as PostBody;
  if (body.action === "greet")
    return { action: "greet", onboardingHints: body.onboardingHints };
  if (body.action === "activity_sync") {
    const parsedIds = parseActivityIds(body.activity_ids);
    if (!parsedIds.ok)
      return Response.json({ error: parsedIds.error }, { status: 400 });
    return {
      action: "activity_sync",
      activity_ids: parsedIds.activityIds,
      knownSha: body.knownSha,
    };
  }

  const endConversationRequested = body.endConversationRequested === true;
  const trimmed = acceptedMessage(body.message, endConversationRequested);
  if (trimmed == null)
    return Response.json({ error: "Message required" }, { status: 400 });
  return {
    threadId: body.threadId,
    priorMessages: body.messages ?? [],
    trimmed,
    geminiMessage: messageForGemini(trimmed, endConversationRequested),
    knownSha: body.knownSha,
    endConversationRequested,
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
  const stale =
    request.knownSha != null &&
    currentSha != null &&
    request.knownSha !== currentSha;
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
  if (!soul)
    return Response.json(
      { error: "Coach SOUL bundle is unavailable" },
      { status: 500 },
    );

  const timezone = profile?.timezone?.trim() || "UTC";
  const firstSession = !isFirstSessionRitualDone(
    profile,
    memory,
    seasons,
    quests,
  );
  const closeIntent = shouldRequestClose(
    request.trimmed,
    request.priorMessages,
    request.endConversationRequested,
  );
  const now = Date.now();
  const traceId = Math.random().toString(36).slice(2, 10);
  let closingFiles: ClosingFileContext | undefined;
  let validTemplateIds: ReadonlySet<string> = new Set();
  let weekSessionsForContext: TurnState["weekSessionsForContext"] = [];

  if (closeIntent) {
    closingFiles = await loadClosingFileContext(repo, token);
    const manifestRaw = await getFileRaw(
      repo,
      TEMPLATES_MANIFEST_PATH,
      token,
    ).catch(() => null);
    validTemplateIds = validTemplateIdsFromManifest(manifestRaw);
    const currentWeekRaw = await getFileRaw(
      repo,
      CURRENT_WEEK_PATH,
      token,
    ).catch(() => null);
    const parsedWeek = parseJsonOrNull<{
      days?: {
        date: string;
        sessions?: { id: string; title: string; status: string }[];
      }[];
    }>(currentWeekRaw);
    weekSessionsForContext = (parsedWeek?.days ?? []).flatMap((day) =>
      (day.sessions ?? []).map((session) => ({ ...session, date: day.date })),
    );
  }

  return {
    ...request,
    repo,
    token,
    apiKey,
    currentSha,
    stale,
    context,
    timezone,
    athleteContext: renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights,
    }),
    questContext: renderQuestContext({
      seasons,
      quests,
      progress,
      progressions,
      today: todayDateString(timezone, new Date()),
    }),
    firstSession,
    closeIntent,
    now,
    traceId,
    userMsg: request.trimmed
      ? { id: `u-${now}`, role: "user", text: request.trimmed }
      : undefined,
    closingFiles,
    validTemplateIds,
    weekSessionsForContext,
  };
}

export async function requestCoachReply(
  turn: TurnState,
): Promise<Response | RepliedTurn> {
  try {
    const reply = await askGemini(
      turn.apiKey,
      turn.context.soul!,
      turn.athleteContext,
      turn.questContext,
      turn.priorMessages,
      turn.geminiMessage,
      turn.closeIntent ? "closing" : "ordinary",
      turn.firstSession,
      combineExtraContext(
        firstSessionContext(turn.firstSession, FIRST_SESSION_PROTOCOL),
        activeTemplatesContext(turn.validTemplateIds),
        activeWeekSessionsContext(turn.weekSessionsForContext),
      ),
      turn.traceId,
      turn.timezone,
    );
    return {
      ...turn,
      reply,
      closing: turn.closeIntent && reply.session_closed === true,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] askGemini failed:", err);
    return Response.json({ error: message }, { status });
  }
}

export async function buildTurnWrites(turn: RepliedTurn): Promise<TurnWrites> {
  const { repo, token, timezone, traceId, reply } = turn;
  const { profile, memory, seasons, quests } = turn.context;
  const coachMsg: ChatMessage = {
    id: `c-${turn.now}`,
    role: "coach",
    paragraphs: [reply.reply],
  };
  const allMessages = appendConversationTurn(
    turn.priorMessages,
    turn.userMsg,
    coachMsg,
    {
      id: `d-${turn.now}`,
      role: "divider",
      label: todayDividerLabel(timezone),
    },
  );

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
  const coachNoteWrite = buildCoachNoteWrite(repo, token, timezone, traceId, reply.coach_note);

  const sportsUpdate = (reply.sports_update ?? []).filter(
    (sport) => sport.trim().length > 0,
  );
  const hasSportsUpdate = sportsUpdate.length > 0;
  const memoryFileWrite = buildMemoryFileWrite(repo, token, timezone, traceId, {
    memoryUpdate: reply.memory_update,
    sportsUpdate,
  });

  const injuryEvents = (reply.injury_event ?? []).filter(
    (event) =>
      event.status != null &&
      (event.flag_id != null || (event.text?.trim().length ?? 0) > 0),
  );
  const injuryEventWrite = buildInjuryEventWrite(repo, token, timezone, injuryEvents);

  const questEvents = reply.quest_event ?? [];
  const validQuestIds = new Set<string>(
    [
      quests?.main_quest?.id,
      ...(quests?.quests ?? [])
        .filter((quest) => quest.status === "active")
        .map((quest) => quest.id),
    ].filter((id): id is string => Boolean(id)),
  );
  const questEventWrite = buildQuestEventWrite(
    repo,
    token,
    timezone,
    traceId,
    questEvents,
    seasons?.current_season_id ?? "",
    validQuestIds,
  );

  const profileUpdates = (reply.profile_update ?? []).filter(
    (update) => update.field != null && update.value != null,
  );
  const profileUpdateWrite = buildProfileUpdateWrite(repo, token, profileUpdates);

  const templateEditWrite = buildTemplateEditWrite(
    repo,
    token,
    traceId,
    reply.template_edit,
    turn.validTemplateIds,
  );

  const sessionPlanWrite = buildSessionPlanWrite(
    repo,
    token,
    timezone,
    traceId,
    reply.session_plan,
    turn.validTemplateIds,
  );

  const currentWeekWrite = buildCurrentWeekWrite(
    repo,
    token,
    timezone,
    traceId,
    reply.week_plan,
    reply.session_reconcile ?? [],
    reply.plan_edit ?? [],
    turn.validTemplateIds,
  );

  const seasonStart = reply.season_start;
  const seasonStartWrite = buildSeasonStartWrite(repo, token, traceId, seasonStart);

  const questCreate = reply.quest_create;
  const questCreateWrite = buildQuestCreateWrite(repo, token, timezone, traceId, questCreate);

  const { wasProfileComplete, profileComplete, projectedProfile, projectedMemory } =
    projectProfileCompletion({
      profile,
      memory,
      seasons,
      profileUpdates,
      sportsUpdate,
      hasSportsUpdate,
      seasonStart,
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
  if (
    validUpdates.some((update) => update.path === PROFILE_PATH) &&
    profileUpdateWrite
  ) {
    const resolveProfileUpdate = profileUpdateWrite.resolve;
    profileUpdateWrite.resolve = async () => {
      const updated = await resolveProfileUpdate();
      const merged = applyJsonMergePatch(
        updated,
        JSON.stringify({ coach_since: todayDateString(timezone, new Date()) }),
      );
      return merged.ok ? merged.content : updated;
    };
    validUpdates = validUpdates.filter(
      (update) => update.path !== PROFILE_PATH,
    );
  }

  const fspCandidates = [
    ...validUpdates,
    memoryFileWrite,
    injuryEventWrite,
    questEventWrite,
    profileUpdateWrite,
    seasonStartWrite,
    questCreateWrite,
  ];
  const optionalWrites = [
    coachNoteWrite,
    memoryFileWrite,
    injuryEventWrite,
    questEventWrite,
    profileUpdateWrite,
    templateEditWrite,
    sessionPlanWrite,
    currentWeekWrite,
    seasonStartWrite,
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
    fspCandidates,
    validUpdates,
    wasProfileComplete,
    profileComplete,
    projectedProfile,
    projectedMemory,
  };
}

export async function generateTemplatesAfterCompletion(
  turn: TurnWrites,
): Promise<void> {
  if (turn.wasProfileComplete || !turn.profileComplete) return;
  try {
    if (
      (await getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token)) != null
    )
      return;
    const { templates } = await generateInitialTemplates(
      turn.projectedProfile,
      turn.projectedMemory,
      turn.context.injuries ?? { flags: [] },
      turn.timezone,
      turn.traceId,
      turn.apiKey,
    );
    await commitFilesAtomic(
      templates,
      "coach: initial workout templates generated",
      {
        repo: turn.repo,
        branch: resolveCoachChatBranch(),
        token: turn.token,
      },
    );
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

export async function commitOrdinaryTurn(turn: TurnWrites): Promise<Response> {
  const writes = fspIncrementalWrites(
    turn.wasProfileComplete,
    turn.fspCandidates,
  );
  let repoSha = turn.currentSha;
  if (writes.length > 0) {
    try {
      const result = await commitFilesAtomic(
        writes,
        "coach: first session details recorded",
        {
          repo: turn.repo,
          branch: resolveCoachChatBranch(),
          token: turn.token,
        },
      );
      repoSha = result.commitSha;
      invalidateCoachContext(turn.repo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json(
        {
          error: `Coach replied but saving failed: ${message}`,
          traceId: turn.traceId,
        },
        { status: 502 },
      );
    }
  }
  await generateTemplatesAfterCompletion(turn);
  return Response.json(
    ordinaryTurnResponse(
      turn.reply.reply,
      repoSha,
      turn.stale,
      turn.profileComplete,
    ),
  );
}

export async function commitClosingTurn(turn: TurnWrites): Promise<Response> {
  if (turn.validUpdates.length === 0 && !turn.trimmedCoachNote) {
    console.warn("[coach-chat] close landed with no coach_note.", {
      athleteMessage: turn.trimmed,
      traceId: turn.traceId,
    });
  }
  const writes = [...turn.validUpdates, turn.chatWrite, ...turn.optionalWrites];
  let repoSha: string;
  try {
    const result = await commitFilesAtomic(
      writes,
      `coach: chat — ${turn.computedTitle || "session update"}`,
      {
        repo: turn.repo,
        branch: resolveCoachChatBranch(),
        token: turn.token,
      },
    );
    repoSha = result.commitSha;
    console.log(
      "[coach-chat] close-trace",
      JSON.stringify({
        traceId: turn.traceId,
        threadId: turn.finalThreadId,
        repo: turn.repo,
        coachNote: turn.trimmedCoachNote ? "present" : "empty",
        committed: writes.map((write) => write.path),
        ms: Date.now() - turn.now,
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      "[coach-chat] close-trace",
      JSON.stringify({
        traceId: turn.traceId,
        threadId: turn.finalThreadId,
        repo: turn.repo,
        coachNote: turn.trimmedCoachNote ? "present" : "empty",
        error: message,
        ms: Date.now() - turn.now,
      }),
    );
    console.error("[coach-chat] closing commitFilesAtomic failed:", err, {
      traceId: turn.traceId,
    });
    return Response.json(
      {
        error: `Coach replied but saving failed: ${message}`,
        traceId: turn.traceId,
      },
      { status: 502 },
    );
  }

  await generateTemplatesAfterCompletion(turn);
  return Response.json({
    reply: turn.reply.reply,
    closed: true,
    threadId: turn.finalThreadId,
    threads: withComputedDayOffsets(turn.latestThreads, turn.timezone),
    repoSha,
    profileComplete: turn.profileComplete,
    traceId: turn.traceId,
  });
}
