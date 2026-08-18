/**
 * coach-chat.ts — real Coach Phelps sessions from the browser and iOS, backed by Gemini.
 * Full design/flow: docs/eng-docs/coach-chat-flow.md. Commit + retention: ADR 0012. This file is
 * the HTTP handler only - prompt construction, Gemini transport, thread persistence, write
 * authority, day math, and close-signal detection live under ui/api/coach-chat/_lib/.
 *
 * GET                        → load committed threads
 * POST {action: "greet"}     → Coach speaks first (A4), no athlete message, no repo write
 * POST {threadId?, messages, message} → send a message, get a reply. No repo write unless it
 *                               closes the session, in which case the whole thread (+ coach_note/
 *                               rolling_state.json, if any) commits in one batch.
 *
 * No delete endpoint - retention is automatic (ADR 0012 amendment): 7 most recent threads kept,
 * oldest evicted on write.
 *
 * coach-chat-reliability-debug: closing-turn ask was stripped to coach_note only, then rebuilt
 * incrementally on the same "model reports a fact, server owns the file mechanic" principle
 * (docs/plans/coach-intent-schema.md) - see BACKLOG.md for what's still not wired back in yet.
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { commitFilesAtomic, type FileEntry } from "./_lib/githubGitData.js";
import {
  STATE_FILE_PATH,
  ROLLING_STATE_PATH,
  getFileRaw,
  getHeadSha,
  isAthleteProfileComplete,
  loadCoachContext,
  resolveCoachChatBranch,
} from "./coach-chat/_lib/coachChatFiles.js";
import { withComputedDayOffsets, todayDividerLabel, todayDateString } from "./coach-chat/_lib/coachDay.js";
import { isCloseSignal, wasCloseAttemptPending } from "./coach-chat/_lib/closeSignal.js";
import {
  CHAT_FILE_PATH,
  THREAD_TITLE_MAX_CHARS,
  sanitizeTitle,
  truncateTitle,
  loadChatHistory,
  mergeThreadToFront,
  applyRetention,
  type ChatMessage,
  type ChatThread,
} from "./coach-chat/_lib/chatThreads.js";
import {
  COACH_NOTES_PATH,
  appendCoachNote,
  loadClosingFileContext,
  injectCoachSinceIfNeeded,
  type ClosingFileContext,
} from "./coach-chat/_lib/coachWrites.js";
import { applyRollingState } from "./coach-chat/_lib/coachIntents.js";
import { askGemini } from "./coach-chat/_lib/geminiClient.js";
import {
  combineExtraContext,
  firstSessionContext,
  onboardingHintsContext,
  rollingStateContext,
  type GeminiReply,
  type OnboardingHints,
} from "./coach-chat/_lib/coachPrompt.js";
import { FIRST_SESSION_PROTOCOL } from "./_generated/soul.js";

// A4: coach speaks first. Generates a fresh opener via Gemini and hands back a not-yet-committed
// thread id - nothing writes to the repo here. The greeting only lands if the athlete replies
// and the conversation later closes (see the closing-turn path below, which handles a
// client-supplied threadId that was never committed the same as any other new thread).
async function handleGreet(
  repo: string,
  token: string,
  apiKey: string,
  onboardingHints?: OnboardingHints,
): Promise<Response> {
  const [history, context] = await Promise.all([loadChatHistory(repo, token), loadCoachContext(repo, token)]);
  const { soul, state: stateMd, questLog, rollingState, profile, memory } = context;
  if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

  let reply: GeminiReply;
  try {
    reply = await askGemini(
      apiKey,
      soul,
      stateMd ?? "",
      questLog ?? "",
      [],
      "",
      "greeting",
      combineExtraContext(
        firstSessionContext(isAthleteProfileComplete(profile, memory), FIRST_SESSION_PROTOCOL),
        onboardingHintsContext(onboardingHints),
        rollingStateContext(rollingState),
      ),
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const errMessage = err instanceof Error ? err.message : String(err);
    // Returns directly instead of re-throwing, so the outer handler's console.error never runs
    // for it - log here or an askGemini failure is invisible in Runtime Logs.
    console.error("[coach-chat] greet askGemini failed:", err);
    return Response.json({ error: errMessage }, { status });
  }

  const now = Date.now();
  const repoSha = await getHeadSha(repo, token).catch(() => null); // A5: best-effort, never blocks a reply
  return Response.json({
    reply: reply.reply,
    // Neither client reads this - both mint their own local id for the uncommitted greeting.
    // Kept for response-shape stability.
    threadId: `t-${now}`,
    threads: withComputedDayOffsets(history.threads, stateMd ?? ""),
    repoSha,
  });
}

// Split from fetch() below so a rotated session cookie only needs attaching in one place.
async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
    const repo = auth.repo_full_name;
    const token = auth.gh_token;

    if (req.method === "GET") {
      const [history, stateMd] = await Promise.all([loadChatHistory(repo, token), getFileRaw(repo, STATE_FILE_PATH, token)]);
      // Retention is enforced on write, not here - a GET must never rewrite the file just
      // because it was read.
      return Response.json({ threads: withComputedDayOffsets(history.threads, stateMd ?? "") });
    }

    if (req.method === "POST") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return Response.json({ error: "Coach chat isn't configured yet" }, { status: 500 });

      // `messages` is the client's own running history - nothing persists server-side until close.
      const { threadId, messages, message, action, knownSha, onboardingHints } = (await req.json()) as {
        threadId?: string;
        messages?: ChatMessage[];
        message?: string;
        action?: "greet";
        // A5: repoSha this client last saw - lets the server detect a write from elsewhere
        // without a lock.
        knownSha?: string;
        // B4: only meaningful alongside action: "greet" - see onboardingHintsContext().
        onboardingHints?: OnboardingHints;
      };

      if (action === "greet") {
        return handleGreet(repo, token, apiKey, onboardingHints);
      }

      const trimmed = (message ?? "").trim();
      if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });

      // A5: best-effort - a failed HEAD check just means staleness can't be detected this time.
      const currentSha = await getHeadSha(repo, token).catch(() => null);
      const stale = knownSha != null && currentSha != null && knownSha !== currentSha;

      // A3: reuses the app-load preload's 60s cache, unless A5 just found it stale, in which
      // case force a fresh read.
      const { soul, state: stateMd, questLog, rollingState, profile, memory } = await loadCoachContext(repo, token, { fresh: stale });
      if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

      const priorMessages = messages ?? [];
      // Keyword match only triggers asking Gemini to consider closing - reply.session_closed is
      // the real decision (see closing below). A10: also true if a close attempt is still
      // pending from a few messages back, since answering Coach's clarifying question doesn't
      // itself match CLOSE_SESSION_PATTERN.
      const closeIntent = isCloseSignal(trimmed) || wasCloseAttemptPending(priorMessages);
      const now = Date.now();
      // Minted here so it's available to askGemini/finishGeminiResponse, taggable with the same
      // id the eventual commit-outcome log uses.
      const traceId = Math.random().toString(36).slice(2, 10);
      const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

      // Only fetched on a closing turn, for the server-side coach_since stamp - Gemini never
      // sees this content.
      let closingFiles: ClosingFileContext | undefined;
      if (closeIntent) {
        closingFiles = await loadClosingFileContext(repo, token);
      }

      let reply: GeminiReply;
      try {
        reply = await askGemini(
          apiKey,
          soul,
          stateMd ?? "",
          questLog ?? "",
          priorMessages,
          trimmed,
          closeIntent ? "closing" : "ordinary",
          // First Session spans several turns, so this has to fire on ordinary turns too -
          // greet-only would drop the protocol the moment the athlete answered the first question.
          combineExtraContext(
            firstSessionContext(isAthleteProfileComplete(profile, memory), FIRST_SESSION_PROTOCOL),
            rollingStateContext(rollingState),
          ),
          traceId,
        );
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error("[coach-chat] askGemini failed:", err);
        return Response.json({ error: errMessage }, { status });
      }

      const coachMsg: ChatMessage = { id: `c-${now}`, role: "coach", paragraphs: [reply.reply] };
      const closing = closeIntent && reply.session_closed === true;

      if (!closing) {
        // No repo write for an ordinary turn - client appends both messages to its own
        // in-memory thread. Also covers a close-intent turn where Gemini asked a clarifying
        // question instead of closing.
        return Response.json({ reply: reply.reply, closed: false, repoSha: currentSha, stale });
      }

      // Closing: build the thread's final message list and merge into what's already committed.
      const allMessages: ChatMessage[] = priorMessages.length
        ? [...priorMessages, userMsg, coachMsg]
        : [{ id: `d-${now}`, role: "divider", label: todayDividerLabel(stateMd ?? "") }, userMsg, coachMsg];

      // Fixed outside the retry loop so the response's id/title/preview stay stable across
      // attempts.
      const finalThreadId = threadId ?? `t-${now}`;
      // coach-chat-reliability-debug: title is no longer model-generated (suspected of competing
      // with coach_note for the model's attention) - always the truncated-first-message fallback.
      const firstUserText = allMessages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user")?.text ?? trimmed;
      const computedTitle = truncateTitle(sanitizeTitle(firstUserText), THREAD_TITLE_MAX_CHARS);
      const previewText = reply.reply.slice(0, 80);

      // Resolved fresh on every commit retry (see githubGitData.ts) so two requests racing on
      // the same repo merge rather than the last-to-commit overwriting the first.
      let latestThreads: ChatThread[] = [];
      const chatWrite: FileEntry = {
        path: CHAT_FILE_PATH,
        resolve: async () => {
          const fresh = await loadChatHistory(repo, token);
          const existing = fresh.threads.find((t) => t.id === finalThreadId);
          if (existing && existing.status === "deleted") {
            // Stale client closing into a thread deleted since this conversation started - fail
            // loudly instead of silently resurrecting it. Defensive backstop; a hard-deleted
            // thread is normally removed from the array entirely.
            throw Object.assign(
              new Error(`Thread ${finalThreadId} was ${existing.status} - refusing to reactivate it via close`),
              { status: 400 }, // non-transient: don't burn retries on a real rejection
            );
          }
          const thread: ChatThread = {
            id: finalThreadId,
            dayOffset: existing?.dayOffset ?? 0, // stale by design - recomputed from createdAt on every response
            createdAt: existing?.createdAt ?? now,
            title: existing?.title ?? computedTitle,
            preview: previewText,
            ageLabel: "NOW",
            status: "active",
            messages: allMessages,
          };
          const retained = applyRetention(mergeThreadToFront(fresh.threads, thread));
          latestThreads = retained;
          return JSON.stringify({ threads: retained }, null, 2);
        },
      };

      // Only included in `writes` below when non-empty. Fetches coach_notes.md fresh at commit
      // time, same pattern as chatWrite above.
      const trimmedCoachNote = reply.coach_note?.trim();
      const coachNoteWrite: FileEntry | undefined = trimmedCoachNote
        ? {
            path: COACH_NOTES_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, COACH_NOTES_PATH, token);
              return appendCoachNote(fresh, trimmedCoachNote, todayDateString(stateMd ?? "", new Date()));
            },
          }
        : undefined;

      // Reuses trimmedCoachNote verbatim (no new Gemini field) into rolling_state.json's bounded
      // last-N-sessions log, read back into every future turn's prompt (rollingStateContext).
      // Fetched fresh at commit time, same pattern as coachNoteWrite above.
      const rollingStateWrite: FileEntry | undefined = trimmedCoachNote
        ? {
            path: ROLLING_STATE_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, ROLLING_STATE_PATH, token);
              return applyRollingState(fresh, { date: todayDateString(stateMd ?? "", new Date()), text: trimmedCoachNote });
            },
          }
        : undefined;

      // B2/ADR 0018: state.md isn't edited here, so both sides of this transition check stay the
      // pre-turn value until something actually edits the Athlete Profile section (see BACKLOG.md #1).
      const wasProfileComplete = isAthleteProfileComplete(profile, memory);
      const profileComplete = isAthleteProfileComplete(profile, memory);
      const validUpdates = injectCoachSinceIfNeeded([], closingFiles, wasProfileComplete, profileComplete, stateMd ?? "");

      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with no coach_note.", { athleteMessage: trimmed, traceId });
      }

      // ADR 0012: chat_history.json plus coach_notes.md/rolling_state.json (when reported), plus
      // a coach_since stamp when needed, land in ONE atomic commit.
      const optionalWrites: FileEntry[] = [];
      if (coachNoteWrite) optionalWrites.push(coachNoteWrite);
      if (rollingStateWrite) optionalWrites.push(rollingStateWrite);
      const writes: FileEntry[] = [...validUpdates, chatWrite, ...optionalWrites];

      let repoSha: string;
      try {
        const result = await commitFilesAtomic(writes, `coach: chat — ${computedTitle || "session update"}`, {
          repo,
          // Same resolver every read in this turn already used (resolveCoachChatBranch) - reads
          // and writes must never diverge, or a scratch-branch test silently reads real main.
          branch: resolveCoachChatBranch(),
          token,
        });
        repoSha = result.commitSha;
        console.log("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          coachNote: trimmedCoachNote ? "present" : "empty",
          committed: writes.map((w) => w.path),
          ms: Date.now() - now,
        }));
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        // The resolve() guard above throws a tagged {status: 400} for a correct rejection (this
        // close targeted a deleted thread), not a save failure - don't flatten it into the
        // generic 502 below.
        if ((err as { status?: number }).status === 400) {
          return Response.json({ error: errMessage, traceId }, { status: 400 });
        }
        console.error("[coach-chat] close-trace", JSON.stringify({
          traceId,
          threadId: finalThreadId,
          repo,
          coachNote: trimmedCoachNote ? "present" : "empty",
          error: errMessage,
          ms: Date.now() - now,
        }));
        console.error("[coach-chat] closing commitFilesAtomic failed:", err, { traceId });
        return Response.json({ error: `Coach replied but saving failed: ${errMessage}`, traceId }, { status: 502 });
      }

      return Response.json({
        reply: reply.reply,
        closed: true,
        threadId: finalThreadId,
        threads: withComputedDayOffsets(latestThreads, stateMd ?? ""),
        repoSha,
        profileComplete,
        traceId,
      });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export default {
  async fetch(req: Request): Promise<Response> {
    // resolveRepoAuth handles both auth modes: session cookie for web, Bearer token +
    // X-Coach-Repo for iOS. Cookie mode's setCookie (ADR 0009 rotation) is undefined in Bearer
    // mode, so withSessionCookie is a no-op for iOS calls.
    const resolved = await resolveRepoAuth(req);
    if (resolved instanceof Response) return resolved;
    try {
      const res = await handle(req, resolved);
      return withSessionCookie(res, resolved.setCookie);
    } catch (err) {
      // A rotated refresh_token (ADR 0009) is single-use - losing resolved.setCookie here
      // would strand the next request.
      const message = err instanceof Error ? err.message : "Coach chat failed";
      // iOS has no cookie-refresh equivalent, so a real 401 (not a generic 500) is its only
      // signal to re-prompt sign-in.
      const status = (err as { status?: number }).status === 401 ? 401 : 500;
      console.error("[coach-chat]", err);
      return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
    }
  },
};
