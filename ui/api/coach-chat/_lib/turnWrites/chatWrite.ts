// Builds the chat-transcript write: every turn's write to chat_history.json, merging the
// current thread to the front and re-serializing. Split out of coachTurn.ts so the transcript
// concern reads on its own, separate from the athlete-data writes (memory, injuries, quests...)
// a turn may also produce.
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import {
  CHAT_FILE_PATH,
  THREAD_TITLE_MAX_CHARS,
  sanitizeTitle,
  truncateTitle,
  loadChatHistory,
  mergeThreadToFront,
  applyRetention,
  serializeChatHistory,
  type ChatMessage,
  type ChatThread,
} from "../chatThreads.js";

export interface ChatWriteResult {
  chatWrite: ResolvedFileWrite;
  latestThreads: ChatThread[];
  finalThreadId: string;
  computedTitle: string;
}

export function buildChatWrite(params: {
  repo: string;
  token: string;
  traceId: string;
  now: number;
  threadId: string | undefined;
  trimmed: string;
  allMessages: ChatMessage[];
  replyText: string;
}): ChatWriteResult {
  const { repo, token, traceId, now, threadId, trimmed, allMessages, replyText } = params;
  const finalThreadId = threadId ?? `t-${now}`;
  const firstUserText =
    allMessages.find(
      (message): message is Extract<ChatMessage, { role: "user" }> => message.role === "user",
    )?.text ?? trimmed;
  const computedTitle = truncateTitle(sanitizeTitle(firstUserText), THREAD_TITLE_MAX_CHARS);
  const latestThreads: ChatThread[] = [];
  const chatWrite: ResolvedFileWrite = {
    path: CHAT_FILE_PATH,
    resolve: async () => {
      const fresh = await loadChatHistory(repo, token);
      const existing = fresh.threads.find((thread) => thread.id === finalThreadId);
      const thread: ChatThread = {
        id: finalThreadId,
        createdAt: existing?.createdAt ?? now,
        title: existing?.title ?? computedTitle,
        preview: replyText.slice(0, 80),
        messages: allMessages,
      };
      const retained = applyRetention(mergeThreadToFront(fresh.threads, thread));
      latestThreads.splice(0, latestThreads.length, ...retained);
      return serializeChatHistory(retained, new Date().toISOString(), traceId);
    },
  };
  return { chatWrite, latestThreads, finalThreadId, computedTitle };
}
