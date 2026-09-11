/** Persist-on-sync Coach turn: one committed thread per verified activity batch. */
import { commitFilesAtomic, type ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { selectLlmAdapter } from "../../../_lib/llmClient.js";
import {
  getFileRaw,
  getHeadSha,
  isAthleteProfileComplete,
  loadCoachContext,
  resolveCoachChatBranch,
} from "../decide/coachChatFiles.js";
import { withComputedDayOffsets } from "../decide/coachDay.js";
import {
  CHAT_FILE_PATH,
  loadChatHistory,
  pruneForResponse,
  serializeChatHistory,
  type ChatThread,
} from "../chatThreads.js";
import {
  LATEST_COACH_MESSAGE_PATH,
  buildProactivePrompt,
  generateProactiveBody,
  listActivityFiles,
  loadProactiveContext,
  parseLatestMessageFile,
  serializeLatestMessage,
  type LatestCoachMessage,
} from "../../../coach-message/_lib/coachMessage.js";
import {
  activitySyncBatchId,
  buildActivitySyncThread,
  canonicalSyncActivityId,
  coachReplyText,
  commitActivitySyncHistory,
  findThreadForActivitySyncBatch,
  loadVerifiedActivities,
  type ActivitySyncRequest,
} from "../decide/activitySync.js";

function sameActivityIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function handleActivitySync(
  repo: string,
  token: string,
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
      reply: coachReplyText(existing, batchId),
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

  // One generator (#918): the same proactive-message body-generation /api/coach-message uses,
  // not activitySyncTurn's own Gemini call. This is the common case - the sync just completed,
  // so no thread exists for this batch yet and this call is the one that mints it.
  const readFile = (path: string) => getFileRaw(repo, path, token);
  let previousProactiveMessage: { created_at: string; body: string } | null = null;
  try {
    const parsed = parseLatestMessageFile(await readFile(LATEST_COACH_MESSAGE_PATH)).message;
    if (parsed) previousProactiveMessage = { created_at: parsed.created_at, body: parsed.body };
  } catch {
    previousProactiveMessage = null;
  }

  let replyText: string;
  try {
    const proactiveContext = await loadProactiveContext(
      request.activity_ids.map(canonicalSyncActivityId),
      { readFile, listActivityFiles: () => listActivityFiles(repo, token) },
      new Date(),
      previousProactiveMessage,
    );
    replyText = await generateProactiveBody(
      selectLlmAdapter(),
      buildProactivePrompt(context.soul, proactiveContext),
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status });
  }

  const now = Date.now();
  const newThread = buildActivitySyncThread({
    batchId,
    rows: verified.rows,
    replyText,
    now,
    timezone,
  });
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

  // Keep the Home widget card fresh even when the separate /api/coach-message call the iOS app
  // makes after this one never lands (network blip, timeout, GitHub hiccup - #925/#918). Only the
  // mint path (no thread yet, the common first-mover case) writes latest_message.json here; the
  // `existing`-thread early return above skips this file entirely and leaves it to
  // generateAndStoreCoachMessage's own existingThread branch, which already handles it.
  const canonicalActivityIds = [
    ...new Set(request.activity_ids.map(canonicalSyncActivityId)),
  ].sort();
  const latestMessageWrite: ResolvedFileWrite = {
    path: LATEST_COACH_MESSAGE_PATH,
    resolve: async () => {
      // chatWrite resolves first (array order, every retry attempt - commitFilesAtomic's own
      // contract) so writeOutcome reflects the thread that actually won any concurrent
      // mint-the-same-batch race by the time this reads it.
      const outcome = writeOutcome;
      const seedThreadId = outcome?.thread.id ?? newThread.id;
      const seedBody = outcome?.duplicate ? coachReplyText(outcome.thread, batchId) : replyText;
      const candidate: LatestCoachMessage = {
        id: `cm-${crypto.randomUUID()}`,
        created_at: new Date(now).toISOString(),
        activity_ids: canonicalActivityIds,
        body: seedBody,
        conversation_seed_id: seedThreadId,
      };
      const currentRaw = await readFile(LATEST_COACH_MESSAGE_PATH);
      const current = parseLatestMessageFile(currentRaw).message;
      if (
        current &&
        (sameActivityIds(current.activity_ids, candidate.activity_ids) ||
          Date.parse(current.created_at) >= Date.parse(candidate.created_at))
      ) {
        return currentRaw ?? serializeLatestMessage(current);
      }
      return serializeLatestMessage(candidate);
    },
  };

  try {
    const result = await commitFilesAtomic(
      [chatWrite, latestMessageWrite],
      `coach: chat — ${newThread.title}`,
      {
        repo,
        branch: resolveCoachChatBranch(),
        token,
      },
    );
    const outcome = writeOutcome;
    if (!outcome) {
      return Response.json(
        { error: "Coach replied but saving failed: history write did not resolve" },
        { status: 502 },
      );
    }
    return Response.json({
      reply: outcome.duplicate ? coachReplyText(outcome.thread, batchId) : replyText,
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
