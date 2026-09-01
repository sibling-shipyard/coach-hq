/** Persist-on-sync Coach turn: one committed thread per verified activity batch. */
import { commitFilesAtomic, type ResolvedFileWrite } from "../../_lib/githubGitData.js";
import {
  getFileRaw,
  getHeadSha,
  isAthleteProfileComplete,
  loadCoachContext,
  parseJsonOrNull,
  resolveCoachChatBranch,
} from "./coachChatFiles.js";
import { todayDateString, todayDividerLabel, withComputedDayOffsets } from "./coachDay.js";
import {
  appendConversationTurn,
  CHAT_FILE_PATH,
  loadChatHistory,
  pruneForResponse,
  sanitizeTitle,
  serializeChatHistory,
  THREAD_TITLE_MAX_CHARS,
  truncateTitle,
  type ChatMessage,
  type ChatThread,
} from "./chatThreads.js";
import { renderCoachContext, renderQuestContext } from "./coachContext.js";
import { askGemini, GEMINI_MODEL } from "./geminiClient.js";
import { captureGeminiFailure } from "../../_lib/sentry.js";
import {
  activeWeekSessionsContext,
  activitySyncBatchContext,
  combineExtraContext,
} from "./coachPromptText.js";
import { CURRENT_WEEK_PATH } from "./coachWeekFiles.js";
import {
  ACTIVITY_SYNC_USER_TEXT,
  activitySyncBatchId,
  coachReplyText,
  commitActivitySyncHistory,
  findThreadForActivitySyncBatch,
  loadVerifiedActivities,
  syncedActivityListAttachment,
  syncThreadTitle,
  type ActivitySyncRequest,
} from "./activitySync.js";

async function weekSessionsForContext(repo: string, token: string) {
  const currentWeekRaw = await getFileRaw(repo, CURRENT_WEEK_PATH, token).catch(() => null);
  const parsedWeek = parseJsonOrNull<{
    days?: {
      date: string;
      sessions?: { id: string; title: string; status: string }[];
    }[];
  }>(currentWeekRaw);
  return (parsedWeek?.days ?? []).flatMap((day) =>
    (day.sessions ?? []).map((session) => ({ ...session, date: day.date })),
  );
}

export async function handleActivitySync(
  repo: string,
  token: string,
  apiKey: string,
  request: ActivitySyncRequest,
): Promise<Response> {
  const batchId = activitySyncBatchId(request.activity_ids);
  const [history, context, currentSha] = await Promise.all([
    loadChatHistory(repo, token),
    loadCoachContext(repo, token, { fresh: true }),
    getHeadSha(repo, token).catch(() => null),
  ]);
  const timezone = context.profile?.timezone?.trim() || "UTC";
  const profileComplete = isAthleteProfileComplete(
    context.profile,
    context.memory,
    context.seasons,
  );

  const existing = findThreadForActivitySyncBatch(history.threads, batchId);
  if (existing) {
    return Response.json({
      reply: coachReplyText(existing),
      closed: false,
      duplicate: true,
      threadId: existing.id,
      threads: withComputedDayOffsets(pruneForResponse(history.threads), timezone),
      repoSha: currentSha,
      profileComplete,
    });
  }

  const verified = await loadVerifiedActivities(repo, token, request.activity_ids);
  if (!verified.ok) {
    return Response.json({ error: "One or more activities were not found" }, { status: 422 });
  }
  if (!context.soul) {
    return Response.json({ error: "Coach SOUL bundle is unavailable" }, { status: 500 });
  }

  const weekSessions = await weekSessionsForContext(repo, token);
  const athleteContext = renderCoachContext({
    profile: context.profile,
    memory: context.memory,
    injuries: context.injuries,
    coachLog: context.coachLog,
    athleteInsights: context.athleteInsights,
  });
  const questContext = renderQuestContext({
    seasons: context.seasons,
    quests: context.quests,
    progress: context.progress,
    progressions: context.progressions,
    today: todayDateString(timezone, new Date()),
  });

  let replyText: string;
  try {
    const reply = await askGemini(
      apiKey,
      context.soul,
      athleteContext,
      questContext,
      [],
      ACTIVITY_SYNC_USER_TEXT,
      "activity_sync",
      false,
      combineExtraContext(
        activitySyncBatchContext(verified.rows),
        activeWeekSessionsContext(weekSessions),
      ),
      undefined,
      timezone,
    );
    replyText = reply.reply;
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] activity_sync askGemini failed:", err);
    await captureGeminiFailure(err, {
      model: GEMINI_MODEL,
      upstreamStatus: status,
      turnMode: "activity_sync",
      athleteMessage: ACTIVITY_SYNC_USER_TEXT,
    });
    return Response.json({ error: message }, { status });
  }

  const now = Date.now();
  const title = syncThreadTitle(verified.rows);
  const coachMsg: ChatMessage = {
    id: `c-${now}`,
    role: "coach",
    paragraphs: [replyText],
    attachments: [syncedActivityListAttachment(batchId, verified.rows)],
  };
  const allMessages = appendConversationTurn([], undefined, coachMsg, {
    id: `d-${now}`,
    role: "divider",
    label: todayDividerLabel(timezone),
  });
  const newThread: ChatThread = {
    id: `t-${now}`,
    createdAt: now,
    title: truncateTitle(sanitizeTitle(title), THREAD_TITLE_MAX_CHARS),
    preview: replyText.slice(0, 80),
    messages: allMessages,
  };
  let writeOutcome: { threads: ChatThread[]; duplicate: boolean; thread: ChatThread } | undefined;
  const chatWrite: ResolvedFileWrite = {
    path: CHAT_FILE_PATH,
    resolve: async () => {
      const fresh = await loadChatHistory(repo, token);
      writeOutcome = commitActivitySyncHistory(fresh.threads, batchId, newThread);
      return serializeChatHistory(
        writeOutcome.threads,
        new Date().toISOString(),
        `sync-${now.toString(36)}`,
      );
    },
  };

  try {
    const result = await commitFilesAtomic([chatWrite], `coach: chat — ${title}`, {
      repo,
      branch: resolveCoachChatBranch(),
      token,
    });
    const outcome = writeOutcome;
    if (!outcome) {
      return Response.json(
        { error: "Coach replied but saving failed: history write did not resolve" },
        { status: 502 },
      );
    }
    return Response.json({
      reply: outcome.duplicate ? coachReplyText(outcome.thread) : replyText,
      closed: false,
      duplicate: outcome.duplicate,
      threadId: outcome.thread.id,
      threads: withComputedDayOffsets(pruneForResponse(outcome.threads), timezone),
      repoSha: result.commitSha,
      profileComplete,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] activity_sync commitFilesAtomic failed:", err);
    return Response.json({ error: `Coach replied but saving failed: ${message}` }, { status: 502 });
  }
}
