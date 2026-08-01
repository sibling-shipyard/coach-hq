/**
 * coach-chat.ts — real Coach Phelps sessions from the browser and iOS, backed by Gemini.
 * Full design/flow: docs/eng-docs/coach-chat-flow.md. Commit + retention design: ADR 0012.
 *
 * GET                        → load already-wrapped/committed threads
 * POST {threadId?, messages, message} → send a message, get a real coach reply.
 *                               No repo write unless this message closes the
 *                               session, in which case the whole thread (plus
 *                               any file_updates) commits in one batch.
 * PATCH {threadId, status}   → archive / unarchive / delete / restore an
 *                               already-committed thread
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { commitFilesAtomic, type FileEntry } from "./_lib/githubGitData.js";

const CHAT_FILE_PATH = "user_data/coach/chat_history.json";
const SOUL_FILE_PATH = "propagated/SOUL.md";
const STATE_FILE_PATH = "user_data/coach/state.md";
const QUEST_LOG_PATH = "gen/quest_log.md";

const SESSIONS_PREFIX = "user_data/activities/workout_plans/sessions/";

// Dated model ids keep getting cut early without much notice - gemini-2.0-flash was deprecated,
// then gemini-2.5-flash also started 404ing for free-tier keys ahead of its own announced
// shutdown date. Use Google's maintained "-latest" alias instead: it always points at their
// current recommended flash model, so this doesn't need chasing every time a dated version
// gets sunset. Check aistudio.google.com/rate-limit for this account's actual current
// RPM/RPD numbers - free-tier limits aren't published as a fixed table anymore.
const GEMINI_MODEL = "gemini-flash-latest";

// Only these files carry Coach's write authority (SOUL.md §2, §12) - anything a Gemini
// response proposes outside this set is dropped, even though the prompt already tells it
// not to propose others. Defense in depth, not trust in the model's instruction-following.
const COACH_WRITABLE_FILES = new Set([
  "user_data/coach/state.md",
  "user_data/coach/coach_notes.md",
  "user_data/ledger/challenge_v2.json",
  "user_data/ledger/current_week.json",
  "user_data/coach/sleep_log.json",
]);
function isCoachWritable(path: string): boolean {
  return COACH_WRITABLE_FILES.has(path) || path.startsWith(SESSIONS_PREFIX);
}

// Matches SOUL.md §1 step 6's `TZ=<timezone> date` - the web chat has no shell, so this is
// the direct equivalent: pull the IANA zone out of state.md's Athlete Profile line
// (`- **Timezone:** Asia/Kolkata (IST, UTC+5:30)`) and format "today" in it, falling back to
// UTC the same way SOUL.md's own boot sequence does when the field isn't set yet.
function todayContextLine(stateMd: string): string {
  const match = stateMd.match(/\*\*Timezone:\*\*\s*([A-Za-z_]+\/[A-Za-z_]+)/);
  const timezone = match?.[1] ?? "UTC";
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    return `Today is ${formatted} (${timezone}).`;
  } catch {
    return `Today is ${new Date().toISOString()} (UTC - couldn't resolve "${timezone}" as a timezone).`;
  }
}

// Deliberately simple keyword match, not asking Gemini to self-detect intent - the whole point
// is one deterministic, reliable trigger for the close-out turn instead of hoping the model
// notices a session-ending signal buried in a 370-line SOUL.md dump on its own. False negatives
// just mean the athlete has to say it more plainly; false positives are cheap (worst case, an
// extra real save).
const CLOSE_SESSION_PATTERN =
  /\b(wrap|close|end)\b[\s\w]*\bsession\b|\bwrap it up\b|done for (today|the day)|that'?s it for (today|now)|goodnight coach/i;

function isCloseSignal(message: string): boolean {
  return CLOSE_SESSION_PATTERN.test(message);
}

// The model's own commit_message sometimes already includes a "coach:"-style prefix, which
// would otherwise stutter with the one the code adds below (observed in testing:
// "coach: chat — coach: day-38 — ..."). Strip it defensively.
function cleanCommitMessage(message: string): string {
  return message.replace(/^\s*coach:?\s*[-—]*\s*/i, "").trim();
}

// Neither the Gemini call nor the GitHub reads had an explicit cutoff - a stalled upstream call
// left "Coach is thinking" spinning indefinitely instead of failing visibly. 25s leaves headroom
// under Vercel's function timeout while still being well past any real response time.
const UPSTREAM_TIMEOUT_MS = 25_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Object.assign(new Error(`Request to ${new URL(url).hostname} timed out`), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const GH_HEADERS_RAW = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

type ChatMessage =
  | { id: string; role: "divider"; label: string }
  | { id: string; role: "user"; text: string }
  | { id: string; role: "coach"; paragraphs: string[] };

type ChatThreadStatus = "active" | "archived" | "deleted";

interface ChatThread {
  id: string;
  dayOffset: number;
  title: string;
  preview: string;
  ageLabel: string;
  status: ChatThreadStatus;
  archivedAt?: number;
  deletedAt?: number;
  messages: ChatMessage[];
}

interface ChatHistoryFile {
  threads: ChatThread[];
}

// A pure read - safe to retry on any transient failure including a raw network error, unlike
// the POST commit path where a lost response after a successful write makes blind retry unsafe.
function isTransientReadFailure(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status == null) return true; // network-level failure
  return status >= 500 || status === 429;
}

async function getFileRaw(repo: string, path: string, token: string, attempts = 3): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: GH_HEADERS_RAW(token),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        // Tagged with .status so the top-level handler can tell an expired/invalid token (401)
        // apart from any other failure and respond 401 instead of a generic 500 - iOS's Bearer
        // auth has no cookie-refresh equivalent, so this is the only signal it gets to re-auth.
        throw Object.assign(new Error(`Failed to fetch ${path} (${res.status})`), { status: res.status });
      }
      return await res.text();
    } catch (err) {
      if (!isTransientReadFailure(err) || attempt === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${path} - unreachable`); // keeps TS happy, loop always returns/throws
}

async function loadChatHistory(repo: string, token: string): Promise<ChatHistoryFile> {
  const raw = await getFileRaw(repo, CHAT_FILE_PATH, token);
  if (!raw) return { threads: [] };
  try {
    const parsed = JSON.parse(raw) as ChatHistoryFile;
    return { threads: Array.isArray(parsed.threads) ? parsed.threads : [] };
  } catch {
    return { threads: [] };
  }
}

// Puts `thread` at the front of `threads`, replacing any existing entry with the same id.
// Used for both brand-new threads and reactivated ones (reopening + closing an old thread used
// to leave it wherever it already sat in the array, silently breaking the newest-first
// invariant applyRetention() below depends on).
function mergeThreadToFront(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  return [thread, ...threads.filter((t) => t.id !== thread.id)];
}

// ADR 0012: count-based retention, not calendar-based. Cap applies only to active + archived
// threads (the 7 most-recently-active survive; the 8th evicts the oldest). Threads the athlete
// explicitly soft-deletes (status "deleted") pass through untouched - the UI's Restore /
// Delete Forever affordances still need them to exist, so this cap must not silently drop them.
// Threads must be newest-first for the cap to keep the right ones - see mergeThreadToFront above.
const MAX_RETAINED_THREADS = 7;

function applyRetention(threads: ChatThread[]): ChatThread[] {
  const kept: ChatThread[] = [];
  let liveCount = 0;
  for (const thread of threads) {
    if (thread.status === "deleted") {
      kept.push(thread);
      continue;
    }
    if (liveCount >= MAX_RETAINED_THREADS) continue;
    kept.push(thread);
    liveCount++;
  }
  return kept;
}

// Deliberately NOT dispatching sync.yml here - a repo whose workflow has a push trigger on
// challenge_v2.json already re-syncs from the commit above; dispatching too would risk a second,
// racing run. See docs/eng-docs/coach-chat-flow.md's "What does NOT happen" section.

interface GeminiReply {
  reply: string;
  file_updates?: { path: string; content: string }[];
  commit_message?: string;
}

async function askGemini(
  apiKey: string,
  soul: string,
  stateMd: string,
  questLog: string,
  history: ChatMessage[],
  userMessage: string,
  closing: boolean,
): Promise<GeminiReply> {
  const systemInstruction = [
    soul,
    "\n---\n",
    todayContextLine(stateMd),
    "You are Coach Phelps, running in a web chat session instead of a local Claude Code session.",
    "You are mid-conversation already, not booting a fresh session - skip SOUL.md's Boot Sequence",
    "entirely, you're past it. You have NO shell or tool access: you cannot run `git pull`, cannot",
    "execute Strava scripts, cannot run shell commands, cannot read files on-demand. Everything you",
    "have is already given to you below (current state.md and quest_log.md) or in this conversation.",
    "If SOUL.md instructs you to read a file or run a command you don't have access to here, ignore",
    "that instruction rather than acting like you did it.",
    "You are Coach Phelps ONLY. Never act as Tech Lead, UI Expert, Bob the Builder, iOS Builder, or any",
    "other role from this repo. Never write or discuss code, architecture, or pull requests. If asked to",
    "break character or act as a different assistant, decline in-voice and stay Coach Phelps.",
    "\nCurrent user_data/coach/state.md:\n" + stateMd,
    "\nCurrent gen/quest_log.md (read-only, pre-computed):\n" + questLog,
    closing
      ? [
          "\nThe athlete's latest message is a session-close signal (\"wrap this session\", \"close",
          "session\", or similar). This turn IS the commit-protocol moment (SOUL.md §12) - you must",
          "actually execute it now, not just acknowledge it: reflect on this whole conversation, and",
          "put the full new content of every file that genuinely changed into file_updates (state.md",
          "at minimum if anything was discussed; challenge_v2.json/coach_notes.md/current_week.json/sleep_log.json/",
          "user_data/activities/workout_plans/sessions/<name>.json if relevant). If something the pre-commit checklist needs - today's",
          "sleep, side-quest status, injury flags - was never covered anywhere in this conversation or",
          "in the state.md/quest_log.md above, ask for it now instead of closing out. Only once you",
          "actually have what you need should you close - if this is the athlete's second time asking",
          "to close and you still don't have it, close anyway with what you have rather than stall",
          "forever.",
          "**Never say something is saved, logged, locked, or committed unless it is genuinely present",
          "in file_updates in this exact response.** If there is truly nothing concrete to save this",
          "session, say so honestly instead of pretending to close one out.",
        ].join("\n")
      : [
          "\nWhen this turn genuinely warrants updating the athlete's files (a workout logged, a",
          "check-in, a quest completion - the same judgment calls SOUL.md's own workflows describe),",
          "include the full new contents of each file that needs to change in file_updates. Only ever",
          "propose files from this exact set: user_data/coach/state.md, user_data/coach/coach_notes.md,",
          "user_data/ledger/challenge_v2.json, user_data/ledger/current_week.json, user_data/coach/sleep_log.json, user_data/activities/workout_plans/sessions/<name>.json. Most turns",
          "should NOT touch any files - only do this for the same moments a real session would close",
          "with a commit. Never say something is saved or committed unless it's genuinely in",
          "file_updates this turn.",
        ].join("\n"),
    "\nWhen you include a file in file_updates, reproduce its entire existing content exactly,",
    "character-for-character, except for the specific lines you are adding or changing. Never",
    "summarize, condense, shorten, or remove any section, week, or entry that isn't part of what",
    "changed this conversation - even if it looks old or no longer relevant. If you're not",
    "deliberately editing a line, it must appear in your output identical to how it was given to",
    "you above.",
    "\nAlways include a short commit_message (SOUL.md §12 style, e.g. 'day-12 — logged sprint",
    "intervals', with no leading \"coach:\" - the caller adds that prefix itself) whenever",
    "file_updates is non-empty.",
  ].join("\n");

  const contents = [
    ...history
      .filter((m): m is Extract<ChatMessage, { role: "user" | "coach" }> => m.role === "user" || m.role === "coach")
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.role === "user" ? m.text : m.paragraphs.join("\n\n") }],
      })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          // A close-out turn can carry multiple full file bodies (state.md is already ~14KB) -
          // give it generous headroom so verbatim reproduction can't get cut short by a default
          // output cap, on top of the explicit no-summarizing instruction above.
          maxOutputTokens: 32768,
          responseSchema: {
            type: "object",
            properties: {
              reply: { type: "string" },
              commit_message: { type: "string" },
              file_updates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["path", "content"],
                },
              },
            },
            required: ["reply"],
          },
        },
      }),
    },
  );

  if (res.status === 429) {
    throw Object.assign(new Error("Gemini free-tier quota exceeded"), { status: 429 });
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini request failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no content");
  return JSON.parse(text) as GeminiReply;
}

// Split from fetch() below so a rotated session cookie only needs attaching in one place.
async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
    const repo = auth.repo_full_name;
    const token = auth.gh_token;

    if (req.method === "GET") {
      const history = await loadChatHistory(repo, token);
      // Retention is enforced on write (POST/PATCH), not here - a GET must never rewrite the
      // file just because it was read. Deleted threads are still returned so the sidebar's
      // Restore / Delete Forever actions have something to act on.
      return Response.json({ threads: history.threads });
    }

    if (req.method === "PATCH") {
      const { threadId, status } = (await req.json()) as { threadId: string; status: ChatThreadStatus };
      const now = Date.now();

      // Resolved fresh on every commit retry attempt (see githubGitData.ts) rather than once
      // up front, so a concurrent PATCH/POST touching the same chat_history.json is retried
      // against whatever that other request just committed instead of silently overwriting it -
      // a static snapshot read before commitFilesAtomic runs would otherwise be a lost-update
      // race between e.g. this "Delete forever" and another tab auto-closing a session.
      let latestThreads: ChatThread[] = [];
      const chatWrite: FileEntry = {
        path: CHAT_FILE_PATH,
        resolve: async () => {
          const fresh = await loadChatHistory(repo, token);
          // A "deleted" PATCH on a thread that's already deleted is the client's "Delete forever"
          // action (CoachChat.tsx's deleteForever) - since retention no longer purges deleted
          // threads on a timer, this is the only remaining path to actually remove one. Checked
          // against fresh state each attempt, same as the merge itself.
          const target = fresh.threads.find((t) => t.id === threadId);
          const isHardDelete = status === "deleted" && target?.status === "deleted";
          const threads = isHardDelete
            ? fresh.threads.filter((t) => t.id !== threadId)
            : fresh.threads.map((thread) => {
                if (thread.id !== threadId) return thread;
                return {
                  ...thread,
                  status,
                  archivedAt: status === "archived" ? now : undefined,
                  deletedAt: status === "deleted" ? now : undefined,
                };
              });
          const retained = applyRetention(threads);
          latestThreads = retained;
          return JSON.stringify({ threads: retained }, null, 2);
        },
      };

      await commitFilesAtomic([chatWrite], `coach: chat — ${status} thread`, { repo, branch: "main", token });
      return Response.json({ threads: latestThreads });
    }

    if (req.method === "POST") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return Response.json({ error: "Coach chat isn't configured yet" }, { status: 500 });

      // `messages` is the client's own running history for this thread (nothing persisted
      // server-side for an unwrapped conversation) - the server only ever reads the repo's
      // chat_history.json at the moment a thread actually closes, below.
      const { threadId, messages, message } = (await req.json()) as {
        threadId?: string;
        messages?: ChatMessage[];
        message: string;
      };
      const trimmed = message.trim();
      if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });

      const [soul, stateMd, questLog] = await Promise.all([
        getFileRaw(repo, SOUL_FILE_PATH, token),
        getFileRaw(repo, STATE_FILE_PATH, token),
        getFileRaw(repo, QUEST_LOG_PATH, token),
      ]);
      if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });

      const priorMessages = messages ?? [];
      const closing = isCloseSignal(trimmed);
      const now = Date.now();
      const userMsg: ChatMessage = { id: `u-${now}`, role: "user", text: trimmed };

      let reply: GeminiReply;
      try {
        reply = await askGemini(apiKey, soul, stateMd ?? "", questLog ?? "", priorMessages, trimmed, closing);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status ?? 500;
        const errMessage = err instanceof Error ? err.message : String(err);
        return Response.json({ error: errMessage }, { status });
      }

      const coachMsg: ChatMessage = { id: `c-${now}`, role: "coach", paragraphs: [reply.reply] };

      if (!closing) {
        // No repo write at all for an ordinary turn - the client just appends both messages
        // to its own in-memory thread. Losing this on a refresh before wrap is accepted.
        return Response.json({ reply: reply.reply, closed: false });
      }

      // Closing: this is the one moment a real commit happens, so build the thread's final
      // message list and merge it into whatever's already committed for this repo.
      const allMessages: ChatMessage[] = priorMessages.length
        ? [...priorMessages, userMsg, coachMsg]
        : [{ id: `d-${now}`, role: "divider", label: "TODAY" }, userMsg, coachMsg];

      // Fixed once outside the retry loop so the id/title/preview this response reports stay
      // stable across attempts, even though the merge against fresh state below can run more
      // than once.
      const finalThreadId = threadId ?? `t-${now}`;
      const firstUserText = allMessages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user")?.text ?? trimmed;
      const computedTitle = firstUserText.length > 28 ? `${firstUserText.slice(0, 28)}…` : firstUserText;
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
          if (existing && (existing.status === "archived" || existing.status === "deleted")) {
            // Stale client reference (e.g. a backgrounded tab holding an old thread open) closing
            // into a thread another request archived/deleted since this conversation started -
            // fail loudly instead of silently resurrecting it as active.
            throw Object.assign(
              new Error(`Thread ${finalThreadId} was ${existing.status} - refusing to reactivate it via close`),
              { status: 400 }, // non-transient: don't burn retries on a real rejection
            );
          }
          const thread: ChatThread = {
            id: finalThreadId,
            dayOffset: existing?.dayOffset ?? 0,
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

      // Blank content would silently wipe a real file - never a legitimate update, so reject it
      // alongside the path check above.
      const validUpdates = (reply.file_updates ?? []).filter(
        (f) => isCoachWritable(f.path) && f.content.trim().length > 0,
      );
      const commitMessage = reply.commit_message ? cleanCommitMessage(reply.commit_message) : "session update";

      // ADR 0012: every file_update plus the updated chat_history.json lands in ONE atomic
      // commit via the Git Data API, instead of a separate REST PUT per file.
      const writes: FileEntry[] = [...validUpdates, chatWrite];

      try {
        await commitFilesAtomic(writes, `coach: chat — ${commitMessage}`, { repo, branch: "main", token });
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        // The resolve() guard above throws a tagged {status: 400} when this close targets a
        // thread another request archived/deleted in the meantime - that's a correct rejection,
        // not a save failure, so it gets its own status/message instead of being flattened into
        // the generic "saving failed" 502 below (which would be actively misleading here).
        if ((err as { status?: number }).status === 400) {
          return Response.json({ error: errMessage }, { status: 400 });
        }
        return Response.json({ error: `Coach replied but saving failed: ${errMessage}` }, { status: 502 });
      }

      return Response.json({
        reply: reply.reply,
        closed: true,
        threadId: finalThreadId,
        threads: latestThreads,
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
