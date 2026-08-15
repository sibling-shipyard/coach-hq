/**
 * coach-chat.ts — real Coach Phelps sessions from the browser and iOS, backed by Gemini.
 * Full design/flow: docs/eng-docs/coach-chat-flow.md. Commit + retention design: ADR 0012.
 * Module split: docs/plans/coach-chat-modularization.md - this file is the HTTP handler only;
 * everything else (prompt construction, Gemini transport, thread persistence, write authority,
 * day math, close-signal detection) lives under ui/api/coach-chat/_lib/.
 *
 * GET                        → load already-wrapped/committed threads
 * POST {action: "greet"}     → start a new conversation with Coach speaking first (A4) - no
 *                               athlete message. Creates + commits a thread with just Coach's
 *                               opening line, or reuses today's still-unanswered greeting
 *                               thread if one already exists.
 * POST {threadId?, messages, message} → send a message, get a real coach reply.
 *                               No repo write unless this message closes the
 *                               session, in which case the whole thread (plus
 *                               coach_note, if any) commits in one batch.
 *
 * No delete endpoint - retention is fully automatic (ADR 0012 amendment): the 7 most recent
 * threads are kept, oldest evicted on write. There's no user-facing delete control.
 *
 * coach-chat-reliability-debug: closing-turn ask stripped to the bare minimum (coach_note only -
 * no file_updates, no sleep/side-quest/injury checklist, no Part B retry/honesty-guard) to test
 * whether a much smaller ask is more reliable than the full-featured one. Local to this branch.
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { commitFilesAtomic, type FileEntry } from "./_lib/githubGitData.js";
import {
  STATE_FILE_PATH,
  getFileRaw,
  getHeadSha,
  isAthleteProfileComplete,
  loadCoachContext,
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
import { askGemini } from "./coach-chat/_lib/geminiClient.js";
import { onboardingHintsContext, type GeminiReply, type OnboardingHints } from "./coach-chat/_lib/coachPrompt.js";

// A4: coach speaks first. Every greet() call generates a fresh opener via Gemini (informed by
// current state.md/quest_log.md) and hands back a not-yet-committed thread id - nothing is
// written to the repo here. The greeting only actually lands in the repo if the athlete replies
// and that conversation later closes (its full message history, greeting included, is what the
// close-commit writes in one atomic commit - see the closing-turn path below). Before this, every
// greet() committed a brand-new thread immediately, which meant opening the tab and not engaging
// permanently ate one of the 7 retention slots and littered the repo with empty
// "coach: chat — new conversation" commits - confirmed in real usage on both live athlete repos.
// The close path already handles a client-supplied threadId that was never committed (treats it
// as a brand-new thread, this file's message-send handler: `threadId ?? \`t-${now}\``), so this
// needs no special-casing there - it's the same mechanism ordinary mid-conversation turns already
// rely on (nothing commits until close).
async function handleGreet(
  repo: string,
  token: string,
  apiKey: string,
  onboardingHints?: OnboardingHints,
): Promise<Response> {
  const [history, context] = await Promise.all([loadChatHistory(repo, token), loadCoachContext(repo, token)]);
  const { soul, state: stateMd, questLog } = context;
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
      onboardingHintsContext(onboardingHints),
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const errMessage = err instanceof Error ? err.message : String(err);
    // This catch returns directly instead of re-throwing, so the outer handler's console.error
    // never runs for it - without its own log line, an askGemini failure here is completely
    // invisible in Runtime Logs (found the hard way: several real 500s had zero log output).
    console.error("[coach-chat] greet askGemini failed:", err);
    return Response.json({ error: errMessage }, { status });
  }

  const now = Date.now();
  const repoSha = await getHeadSha(repo, token).catch(() => null); // A5: best-effort, never blocks a reply
  return Response.json({
    reply: reply.reply,
    // Neither client actually reads this - both web and iOS mint their own local id and
    // materialize the greeting as an uncommitted thread client-side (see the comment above this
    // function). Kept in the response on purpose, not a leftover: preserves the response shape
    // exactly, so this backend change and the client-side follow-ups don't have to ship in
    // lockstep.
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
      // Retention is enforced on write (POST), not here - a GET must never rewrite the file
      // just because it was read. Every thread returned here is active - retention (ADR 0012
      // amendment) drops the oldest automatically, no user-facing delete exists any more.
      return Response.json({ threads: withComputedDayOffsets(history.threads, stateMd ?? "") });
    }

    if (req.method === "POST") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return Response.json({ error: "Coach chat isn't configured yet" }, { status: 500 });

      // `messages` is the client's own running history for this thread (nothing persisted
      // server-side for an unwrapped conversation) - the server only ever reads the repo's
      // chat_history.json at the moment a thread actually closes, below.
      const { threadId, messages, message, action, knownSha, onboardingHints } = (await req.json()) as {
        threadId?: string;
        messages?: ChatMessage[];
        message?: string;
        action?: "greet";
        // A5: the repoSha this client last saw for this thread (from a prior response) - lets
        // the server detect "another device wrapped a session (or otherwise wrote to this repo)
        // since I last saw it" without any lock.
        knownSha?: string;
        // B4: only meaningful alongside action: "greet" - see onboardingHintsContext().
        onboardingHints?: OnboardingHints;
      };

      // A4: coach speaks first. Landing on "new conversation" calls this instead of sending a
      // message - the athlete hasn't typed anything yet.
      if (action === "greet") {
        return handleGreet(repo, token, apiKey, onboardingHints);
      }

      const trimmed = (message ?? "").trim();
      if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });

      // A5: best-effort - a failed HEAD check never blocks the turn, it just means staleness
      // can't be detected this time (same as before A5 existed).
      const currentSha = await getHeadSha(repo, token).catch(() => null);
      const stale = knownSha != null && currentSha != null && knownSha !== currentSha;

      // A3: reuses whatever coach-chat-context.ts's app-load preload already warmed for this
      // repo (60s TTL) instead of always paying a fresh GitHub round-trip on every turn - unless
      // A5 just detected the cache is stale, in which case force a fresh read so Gemini's
      // context reflects whatever landed on the repo since (e.g. a session closed elsewhere).
      const { soul, state: stateMd, questLog } = await loadCoachContext(repo, token, { fresh: stale });
      if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

      const priorMessages = messages ?? [];
      // Keyword match is only a trigger to ASK Gemini to consider closing - it is not itself
      // the close decision. Gemini reports back via reply.session_closed whether it actually
      // closed this turn (it may instead ask a clarifying question) - see closing below.
      // A10: also true if a close attempt is still pending from a few messages back (see
      // wasCloseAttemptPending) - the athlete answering to Coach's own clarifying question is
      // still part of the same close attempt, even though that answer alone never matches
      // CLOSE_SESSION_PATTERN.
      const closeIntent = isCloseSignal(trimmed) || wasCloseAttemptPending(priorMessages);
      const now = Date.now();
      // Minted here, not down at the close-trace log site, so it's available to
      // askGemini/finishGeminiResponse below - the model's own closing-turn reasoning is the
      // highest-value diagnostic line this trace exists for, and it has to be taggable with the
      // same traceId the eventual commit outcome logs under.
      const traceId = Math.random().toString(36).slice(2, 10);
      const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

      // Only fetched on a closing turn - purely for the server-side coach_since stamp, Gemini
      // never sees this content (see loadClosingFileContext).
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
          undefined,
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
        // No repo write at all for an ordinary turn - the client just appends both messages
        // to its own in-memory thread. Losing this on a refresh before wrap is accepted. This
        // also covers a close-intent turn where Gemini asked a clarifying question instead of
        // actually closing (session_closed came back false) - no premature commit.
        return Response.json({ reply: reply.reply, closed: false, repoSha: currentSha, stale });
      }

      // Closing: this is the one moment a real commit happens, so build the thread's final
      // message list and merge it into whatever's already committed for this repo.
      const allMessages: ChatMessage[] = priorMessages.length
        ? [...priorMessages, userMsg, coachMsg]
        : [{ id: `d-${now}`, role: "divider", label: todayDividerLabel(stateMd ?? "") }, userMsg, coachMsg];

      // Fixed once outside the retry loop so the id/title/preview this response reports stay
      // stable across attempts, even though the merge against fresh state below can run more
      // than once.
      const finalThreadId = threadId ?? `t-${now}`;
      // coach-chat-reliability-debug: no longer asking Gemini for a title at all - suspected of
      // competing with coach_note for the model's attention (observed dumping the intended
      // coach_note content into title instead, leaving coach_note empty). Always the old
      // truncated-first-message behavior now. sanitizeTitle/truncateTitle stay in use here even
      // though the title is no longer model-generated, in case a first user message itself ever
      // carries a stray non-ASCII character.
      const firstUserText = allMessages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user")?.text ?? trimmed;
      const computedTitle = truncateTitle(sanitizeTitle(firstUserText), THREAD_TITLE_MAX_CHARS);
      const previewText = reply.reply.slice(0, 80);

      // Resolved fresh on every commit retry attempt (see githubGitData.ts), not from a
      // snapshot read before this function was even called - otherwise two requests racing on
      // the same repo (e.g. this close vs. another tab's "Delete forever") could have the
      // last-to-commit silently overwrite the first's changes instead of merging on top of them.
      let latestThreads: ChatThread[] = [];
      const chatWrite: FileEntry = {
        path: CHAT_FILE_PATH,
        resolve: async () => {
          const fresh = await loadChatHistory(repo, token);
          const existing = fresh.threads.find((t) => t.id === finalThreadId);
          if (existing && existing.status === "deleted") {
            // Stale client reference (e.g. a backgrounded tab holding an old thread open) closing
            // into a thread another request deleted since this conversation started - fail loudly
            // instead of silently resurrecting it. (In practice a hard-deleted thread is removed
            // from the array entirely, so `existing` won't be found at all here - this branch is
            // a defensive backstop, not the primary guard.)
            throw Object.assign(
              new Error(`Thread ${finalThreadId} was ${existing.status} - refusing to reactivate it via close`),
              { status: 400 }, // non-transient: don't burn retries on a real rejection
            );
          }
          const thread: ChatThread = {
            id: finalThreadId,
            dayOffset: existing?.dayOffset ?? 0, // stored value is stale by design - recomputed from createdAt below on every response
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

      // coach-chat-reliability-debug: only included in `writes` below when reply.coach_note is
      // present and non-empty after trimming. Fetches coach_notes.md's own fresh content at
      // commit time (same pattern as chatWrite above), not from a turn-start snapshot.
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

      // B2/ADR 0018: detect the false→true profileComplete transition against what's actually
      // about to be committed - a close-turn that finishes the intake writes state.md this same
      // turn and coach_since must key off that fresh value. state.md itself is no longer edited
      // here (no file_updates any more), so this is keyed off the pre-turn stateMd only.
      const wasProfileComplete = isAthleteProfileComplete(stateMd ?? "");
      const profileComplete = isAthleteProfileComplete(stateMd ?? "");
      const validUpdates = injectCoachSinceIfNeeded([], closingFiles, wasProfileComplete, profileComplete, stateMd ?? "");

      // coach-chat-reliability-debug: visibility without retry machinery - if a close lands with
      // neither a coach_since stamp nor a coach_note, log it plainly so it's easy to tell apart
      // from a close that genuinely had nothing to save (also visible via the reasoning log
      // above, correlatable by traceId).
      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with no coach_note.", { athleteMessage: trimmed, traceId });
      }

      // ADR 0012: chat_history.json plus coach_notes.md (when reply.coach_note was reported),
      // plus a coach_since stamp on the one turn that needs it, land in ONE atomic commit via
      // the Git Data API.
      const writes: FileEntry[] = coachNoteWrite ? [...validUpdates, chatWrite, coachNoteWrite] : [...validUpdates, chatWrite];

      let repoSha: string;
      try {
        const result = await commitFilesAtomic(writes, `coach: chat — ${computedTitle || "session update"}`, {
          repo,
          // Configurable so testing a real close doesn't have to write to a live athlete's
          // actual main - defaults to main, unchanged, when unset.
          branch: process.env.COACH_CHAT_BRANCH ?? "main",
          token,
        });
        repoSha = result.commitSha;
        // One structured line per close, correlating the traceId with what actually committed.
        // console.log, not warn: a healthy close isn't a problem.
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
        // The resolve() guard above throws a tagged {status: 400} when this close targets a
        // thread another request archived/deleted in the meantime - that's a correct rejection,
        // not a save failure, so it gets its own status/message instead of being flattened into
        // the generic "saving failed" 502 below (which would be actively misleading here).
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
    // resolveRepoAuth handles both auth modes (ADR 0012 makes coach chat iOS-reachable the
    // same way ADR 0005's widget-snapshots.ts already is): session cookie for web,
    // `Authorization: Bearer <token>` + `X-Coach-Repo: owner/repo` for iOS. Cookie mode's
    // setCookie (ADR 0009 rotation) is undefined in Bearer mode, so withSessionCookie below
    // is a no-op for iOS calls.
    const resolved = await resolveRepoAuth(req);
    if (resolved instanceof Response) return resolved;
    try {
      const res = await handle(req, resolved);
      return withSessionCookie(res, resolved.setCookie);
    } catch (err) {
      // A rotated refresh_token (ADR 0009) is single-use - losing resolved.setCookie here
      // would strand the next request, not just fail this one.
      const message = err instanceof Error ? err.message : "Coach chat failed";
      // A 401 from GitHub itself (expired/invalid token) is surfaced as a real 401 instead of
      // a generic 500 - iOS's Bearer auth has no cookie-refresh equivalent, so this status is
      // its only signal to re-prompt sign-in rather than showing a dead-end error.
      const status = (err as { status?: number }).status === 401 ? 401 : 500;
      console.error("[coach-chat]", err);
      return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
    }
  },
};
