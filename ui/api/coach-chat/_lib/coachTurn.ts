import { commitFilesAtomic, type FileEntry } from "../../_lib/githubGitData.js";
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import {
  getFileRaw,
  getHeadSha,
  invalidateCoachContext,
  isAthleteProfileComplete,
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
  CHAT_FILE_PATH,
  THREAD_TITLE_MAX_CHARS,
  sanitizeTitle,
  truncateTitle,
  loadChatHistory,
  mergeThreadToFront,
  applyRetention,
  serializeChatHistory,
  appendConversationTurn,
  type ChatMessage,
  type ChatThread,
} from "./chatThreads.js";
import {
  loadClosingFileContext,
  injectCoachSinceIfNeeded,
  type ClosingFileContext,
} from "./coachSinceStamp.js";
import {
  applyCoachNote,
  applyMemoryUpdate,
  applyInjuryEvent,
  applyQuestEvent,
  applyProfileUpdate,
  applyCoachingStyleUpdate,
  applySportsUpdate,
  applySeasonStart,
  applyQuestCreate,
} from "./coachIntents.js";
import {
  generateInitialTemplates,
  applyTemplateEdit,
  applySessionPlan,
  validTemplateIdsFromManifest,
  templatePath,
  sessionPath,
  TEMPLATES_MANIFEST_PATH,
} from "./coachWorkoutFiles.js";
import {
  applyWeekPlan,
  applySessionReconcile,
  applyPlanEdit,
  CURRENT_WEEK_PATH,
} from "./coachWeekFiles.js";
import {
  MEMORY_PATH,
  INJURIES_PATH,
  COACH_LOG_PATH,
  PROFILE_PATH,
  MEMORY_NOTE_LABELS,
  type ProfileJson,
  type MemoryJson,
} from "./coachMemoryFiles.js";
import {
  PROGRESS_PATH,
  SEASONS_PATH,
  QUESTS_PATH,
  type SeasonsJson,
} from "./coachQuestFiles.js";
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

interface PostBody {
  threadId?: string;
  messages?: ChatMessage[];
  message?: string;
  action?: "greet";
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
): Promise<Response | GreetRequest | TurnRequest> {
  const body = (await req.json()) as PostBody;
  if (body.action === "greet")
    return { action: "greet", onboardingHints: body.onboardingHints };

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
  value: GreetRequest | TurnRequest,
): value is GreetRequest {
  return "action" in value && value.action === "greet";
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
  const { profile, memory, injuries, seasons, quests } = turn.context;
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
  const finalThreadId = turn.threadId ?? `t-${turn.now}`;
  const firstUserText =
    allMessages.find(
      (message): message is Extract<ChatMessage, { role: "user" }> =>
        message.role === "user",
    )?.text ?? turn.trimmed;
  const computedTitle = truncateTitle(
    sanitizeTitle(firstUserText),
    THREAD_TITLE_MAX_CHARS,
  );
  let latestThreads: ChatThread[] = [];
  const chatWrite: FileEntry = {
    path: CHAT_FILE_PATH,
    resolve: async () => {
      const fresh = await loadChatHistory(repo, token);
      const existing = fresh.threads.find(
        (thread) => thread.id === finalThreadId,
      );
      const thread: ChatThread = {
        id: finalThreadId,
        createdAt: existing?.createdAt ?? turn.now,
        title: existing?.title ?? computedTitle,
        preview: reply.reply.slice(0, 80),
        messages: allMessages,
      };
      const retained = applyRetention(
        mergeThreadToFront(fresh.threads, thread),
      );
      latestThreads.splice(0, latestThreads.length, ...retained);
      return serializeChatHistory(retained, new Date().toISOString(), traceId);
    },
  };

  const trimmedCoachNote = reply.coach_note?.trim();
  const coachNoteWrite: FileEntry | undefined = trimmedCoachNote
    ? {
        path: COACH_LOG_PATH,
        resolve: async () =>
          applyCoachNote(
            await getFileRaw(repo, COACH_LOG_PATH, token),
            trimmedCoachNote,
            todayDateString(timezone, new Date()),
            traceId,
            new Date(),
          ),
      }
    : undefined;

  const memoryUpdate = reply.memory_update;
  const hasMemoryUpdate = Boolean(
    memoryUpdate?.label && memoryUpdate.text?.trim(),
  );
  const coachingStyleUpdate = reply.coaching_style_update;
  const sportsUpdate = (reply.sports_update ?? []).filter(
    (sport) => sport.trim().length > 0,
  );
  const hasSportsUpdate = sportsUpdate.length > 0;
  const memoryFileWrite: FileEntry | undefined =
    hasMemoryUpdate || coachingStyleUpdate || hasSportsUpdate
      ? {
          path: MEMORY_PATH,
          resolve: async () => {
            let working: string | null = await getFileRaw(
              repo,
              MEMORY_PATH,
              token,
            );
            if (hasMemoryUpdate) {
              working = applyMemoryUpdate(
                working,
                memoryUpdate!.label,
                memoryUpdate!.text,
                todayDateString(timezone, new Date()),
                traceId,
              );
            }
            if (coachingStyleUpdate) {
              working = applyCoachingStyleUpdate(
                working,
                coachingStyleUpdate,
                todayDateString(timezone, new Date()),
                traceId,
              );
            }
            if (hasSportsUpdate) {
              working = applySportsUpdate(
                working,
                sportsUpdate,
                todayDateString(timezone, new Date()),
                traceId,
              );
            }
            return working as string;
          },
        }
      : undefined;

  const injuryEvents = (reply.injury_event ?? []).filter(
    (event) =>
      event.status != null &&
      (event.flag_id != null || (event.text?.trim().length ?? 0) > 0),
  );
  const injuryEventWrite: FileEntry | undefined =
    injuryEvents.length > 0
      ? {
          path: INJURIES_PATH,
          resolve: async () =>
            applyInjuryEvent(
              await getFileRaw(repo, INJURIES_PATH, token),
              injuryEvents,
              todayDateString(timezone, new Date()),
            ),
        }
      : undefined;

  const questEvents = reply.quest_event ?? [];
  const validQuestIds = new Set<string>(
    [
      quests?.main_quest?.id,
      ...(quests?.quests ?? [])
        .filter((quest) => quest.status === "active")
        .map((quest) => quest.id),
    ].filter((id): id is string => Boolean(id)),
  );
  const questEventWrite: FileEntry | undefined =
    questEvents.length > 0
      ? {
          path: PROGRESS_PATH,
          resolve: async () =>
            applyQuestEvent(
              await getFileRaw(repo, PROGRESS_PATH, token),
              questEvents,
              todayDateString(timezone, new Date()),
              seasons?.current_season_id ?? "",
              traceId,
              new Date(),
              validQuestIds,
            ),
        }
      : undefined;

  const profileUpdates = (reply.profile_update ?? []).filter(
    (update) => update.field != null && update.value != null,
  );
  const profileUpdateWrite: FileEntry | undefined =
    profileUpdates.length > 0
      ? {
          path: PROFILE_PATH,
          resolve: async () =>
            applyProfileUpdate(
              await getFileRaw(repo, PROFILE_PATH, token),
              profileUpdates,
            ),
        }
      : undefined;

  const templateEdit = reply.template_edit;
  const templateEditWrite: FileEntry | undefined = templateEdit?.template_id
    ? {
        path: templatePath(templateEdit.template_id),
        resolve: async () =>
          applyTemplateEdit(
            await getFileRaw(
              repo,
              templatePath(templateEdit.template_id),
              token,
            ),
            templateEdit,
            turn.validTemplateIds,
            traceId,
          ),
      }
    : undefined;

  const sessionPlan = reply.session_plan;
  const sessionPlanDate = todayDateString(timezone, new Date());
  const sessionPlanWrite: FileEntry | undefined = sessionPlan?.template_id
    ? {
        path: sessionPath(sessionPlanDate, sessionPlan.template_id),
        resolve: async () => {
          const fresh = await getFileRaw(
            repo,
            templatePath(sessionPlan.template_id),
            token,
          );
          return applySessionPlan(
            fresh,
            { ...sessionPlan, session_date: sessionPlanDate },
            turn.validTemplateIds,
            traceId,
          ).content;
        },
      }
    : undefined;

  const weekPlan = reply.week_plan;
  const weekPlanRequested = Boolean(
    weekPlan?.headline?.trim() &&
    weekPlan.body?.trim() &&
    weekPlan.days?.length === 7,
  );
  const sessionReconcileEvents = reply.session_reconcile ?? [];
  const planEditEvents = reply.plan_edit ?? [];
  let currentWeekWrite: FileEntry | undefined;
  if (weekPlanRequested) {
    if (sessionReconcileEvents.length > 0 || planEditEvents.length > 0) {
      console.warn(
        "[coach-chat] week_plan and session_reconcile/plan_edit both set - dropping the latter because their ids reference the old week",
        { traceId },
      );
    }
    currentWeekWrite = {
      path: CURRENT_WEEK_PATH,
      content: applyWeekPlan(
        weekPlan!,
        turn.validTemplateIds,
        timezone,
        traceId,
        new Date(),
      ),
    };
  } else if (sessionReconcileEvents.length > 0 || planEditEvents.length > 0) {
    currentWeekWrite = {
      path: CURRENT_WEEK_PATH,
      resolve: async () => {
        let working = await getFileRaw(repo, CURRENT_WEEK_PATH, token);
        if (sessionReconcileEvents.length > 0) {
          working = applySessionReconcile(
            working,
            sessionReconcileEvents,
            turn.validTemplateIds,
            traceId,
            new Date(),
          );
        }
        if (planEditEvents.length > 0) {
          working = applyPlanEdit(
            working,
            planEditEvents,
            turn.validTemplateIds,
            traceId,
            new Date(),
          );
        }
        return working as string;
      },
    };
  }

  const seasonStart = reply.season_start;
  const seasonStartWrite: FileEntry | undefined = seasonStart?.name?.trim()
    ? {
        path: SEASONS_PATH,
        resolve: async () =>
          applySeasonStart(
            await getFileRaw(repo, SEASONS_PATH, token),
            seasonStart,
            traceId,
            new Date(),
          ),
      }
    : undefined;
  const questCreate = reply.quest_create;
  const questCreateWrite: FileEntry | undefined =
    questCreate?.main_quest || (questCreate?.quests?.length ?? 0) > 0
      ? {
          path: QUESTS_PATH,
          resolve: async () =>
            applyQuestCreate(
              await getFileRaw(repo, QUESTS_PATH, token),
              questCreate!,
              todayDateString(timezone, new Date()),
              traceId,
              new Date(),
            ),
        }
      : undefined;

  const wasProfileComplete = isAthleteProfileComplete(profile, memory, seasons);
  const projectedField = (field: (typeof profileUpdates)[number]["field"]) =>
    profileUpdates.find((update) => update.field === field)?.value;
  const projectedProfile: ProfileJson = {
    version: 1,
    coach_since: profile?.coach_since ?? null,
    name: (projectedField("name") as string | undefined) ?? profile?.name ?? "",
    dob: (projectedField("dob") as string | undefined) ?? profile?.dob ?? null,
    timezone:
      (projectedField("timezone") as string | undefined) ??
      profile?.timezone ??
      "UTC",
    height_cm:
      projectedField("height_cm") != null
        ? Number(projectedField("height_cm"))
        : (profile?.height_cm ?? null),
    weight_kg:
      projectedField("weight_kg") != null
        ? Number(projectedField("weight_kg"))
        : (profile?.weight_kg ?? null),
  };
  const projectedMemory: MemoryJson = {
    version: 1,
    _meta: memory?._meta ?? {
      updated_at: "",
      updated_by: "model",
      trace_id: "",
    },
    sports: hasSportsUpdate ? sportsUpdate : (memory?.sports ?? []),
    coaching_style: coachingStyleUpdate ?? memory?.coaching_style ?? null,
    notes:
      memory?.notes ??
      (Object.fromEntries(
        MEMORY_NOTE_LABELS.map((label) => [
          label,
          { text: "", updated_at: "", trace_id: "" },
        ]),
      ) as MemoryJson["notes"]),
  };
  const projectedSeasons = seasonStart?.name?.trim()
    ? parseJsonOrNull<SeasonsJson>(
        applySeasonStart(
          seasons ? JSON.stringify(seasons) : null,
          seasonStart,
          traceId,
          new Date(),
        ),
      )
    : seasons;
  const profileComplete = isAthleteProfileComplete(
    projectedProfile,
    projectedMemory,
    projectedSeasons,
  );

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
