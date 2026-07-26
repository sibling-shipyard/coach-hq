/**
 * coach-chat.ts — real Coach Phelps sessions from the browser, backed by Gemini.
 *
 * Mirrors a local Claude Code coaching session: reads the same boot context
 * SOUL.md's own boot sequence reads (SOUL.md, training/coach/state.md,
 * training/activities/quest_log.md), asks Gemini to reply as Coach Phelps, and applies
 * the same commit authority SOUL.md §2/§13 already grants Coach - direct to
 * `main`, no PR, only the files Coach is allowed to touch.
 *
 * Persistence mirrors how a real Claude Code coaching session actually works:
 * nothing is written to the repo mid-conversation. The client holds the
 * active thread in memory and sends the full running message list with every
 * POST; the server stays stateless per turn until the athlete signals they're
 * closing the session ("wrap this session", "close session", etc.), at which
 * point it runs the real commit protocol (SOUL.md §13) once, in one shot -
 * same as a real session only ever committing at close, not per message.
 * Losing an unwrapped conversation on a refresh is an accepted trade-off, not
 * a bug: no separate database, the repo is the only durable store.
 *
 * GET                        → load already-wrapped/committed threads
 * POST {threadId?, messages, message} → send a message, get a real coach reply.
 *                               No repo write unless this message closes the
 *                               session, in which case the whole thread (plus
 *                               any file_updates) commits in one batch.
 * PATCH {threadId, status}   → archive / unarchive / delete / restore an
 *                               already-committed thread
 */
import { decryptSession, parseCookies, SESSION_COOKIE } from "./_lib/session.js";

const CHAT_FILE_PATH = "training/chat_history.json";
const SOUL_FILE_PATH = "SOUL.md";
const STATE_FILE_PATH = "training/coach/state.md";
const QUEST_LOG_PATH = "training/activities/quest_log.md";

// Dated model ids keep getting cut early without much notice - gemini-2.0-flash was deprecated,
// then gemini-2.5-flash also started 404ing for free-tier keys ahead of its own announced
// shutdown date. Use Google's maintained "-latest" alias instead: it always points at their
// current recommended flash model, so this doesn't need chasing every time a dated version
// gets sunset. Check aistudio.google.com/rate-limit for this account's actual current
// RPM/RPD numbers - free-tier limits aren't published as a fixed table anymore.
const GEMINI_MODEL = "gemini-flash-latest";

// Only these files carry Coach's write authority (SOUL.md §2, §13) - anything a Gemini
// response proposes outside this set is dropped, even though the prompt already tells it
// not to propose others. Defense in depth, not trust in the model's instruction-following.
const COACH_WRITABLE_FILES = new Set([
  "training/coach/state.md",
  "training/coach/coach_notes.md",
  "training/ledger/challenge_v2.json",
  "training/activities/sleep_log.json",
]);
function isCoachWritable(path: string): boolean {
  return COACH_WRITABLE_FILES.has(path) || path.startsWith("sessions/");
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

const GH_HEADERS_JSON = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});
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

async function getFileRaw(repo: string, path: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: GH_HEADERS_RAW(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return res.text();
}

async function getFileSha(repo: string, path: string, token: string): Promise<string | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    headers: GH_HEADERS_JSON(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to look up sha for ${path} (${res.status})`);
  const body = (await res.json()) as { sha: string };
  return body.sha;
}

async function putFile(
  repo: string,
  path: string,
  token: string,
  content: string,
  message: string,
): Promise<void> {
  const sha = await getFileSha(repo, path, token);
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...GH_HEADERS_JSON(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: "main",
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to write ${path} (${res.status}): ${detail}`);
  }
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

function purgeExpired(threads: ChatThread[], now = Date.now()): ChatThread[] {
  const ARCHIVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
  const DELETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  return threads.filter((thread) => {
    if (thread.status === "deleted") {
      return !(thread.deletedAt && now - thread.deletedAt >= DELETED_RETENTION_MS);
    }
    if (thread.status === "archived") {
      return !(thread.archivedAt && now - thread.archivedAt >= ARCHIVED_RETENTION_MS);
    }
    return true;
  });
}

// Deliberately NOT dispatching sync.yml here. Checked both real personal repos: Akash's
// sync.yml already runs automatically on a `push` to main touching
// training/ledger/challenge_v2.json (added for his iOS app's direct commits) - and our own
// challenge_v2.json commit via the Contents API above IS exactly that push, so his repo
// already re-syncs on its own. A manual workflow_dispatch here would fire a second,
// redundant run of the same workflow for him (extra Strava-step attempt, a real chance of
// the two runs' git pushes racing and one failing). Skanda's sync.yml is workflow_dispatch-only
// with no push trigger, so training/activities/quest_log.md just stays slightly stale after a chat-
// triggered quest update until he next hits Sync himself - same as any other out-of-band
// change to challenge_v2.json today. Simpler and fully transparent beats correct-but-clever.

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
    "\nCurrent training/coach/state.md:\n" + stateMd,
    "\nCurrent training/activities/quest_log.md (read-only, pre-computed):\n" + questLog,
    closing
      ? [
          "\nThe athlete's latest message is a session-close signal (\"wrap this session\", \"close",
          "session\", or similar). This turn IS the commit-protocol moment (SOUL.md §13) - you must",
          "actually execute it now, not just acknowledge it: reflect on this whole conversation, and",
          "put the full new content of every file that genuinely changed into file_updates (state.md",
          "at minimum if anything was discussed; challenge_v2.json/coach_notes.md/sleep_log.json/",
          "sessions/<name>.json if relevant). If something the pre-commit checklist needs - today's",
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
          "propose files from this exact set: training/coach/state.md, training/coach/coach_notes.md,",
          "training/ledger/challenge_v2.json, training/activities/sleep_log.json, sessions/<name>.json. Most turns",
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
    "\nAlways include a short commit_message (SOUL.md §13 style, e.g. 'day-12 — logged sprint",
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

  const res = await fetch(
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

export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const session = await decryptSession(raw);
    if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const repo = session.repo_full_name;
    if (!repo) {
      return Response.json({ error: "No repo resolved yet - visit /api/list-my-repos first" }, { status: 400 });
    }
    const token = session.gh_token;

    if (req.method === "GET") {
      const history = await loadChatHistory(repo, token);
      const threads = purgeExpired(history.threads);
      return Response.json({ threads });
    }

    if (req.method === "PATCH") {
      const { threadId, status } = (await req.json()) as { threadId: string; status: ChatThreadStatus };
      const history = await loadChatHistory(repo, token);
      const now = Date.now();
      const threads = history.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          status,
          archivedAt: status === "archived" ? now : undefined,
          deletedAt: status === "deleted" ? now : undefined,
        };
      });
      const filtered = purgeExpired(threads);
      await putFile(
        repo,
        CHAT_FILE_PATH,
        token,
        JSON.stringify({ threads: filtered }, null, 2),
        `coach: chat — ${status} thread`,
      );
      return Response.json({ threads: filtered });
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

      const history = await loadChatHistory(repo, token);
      let thread = history.threads.find((t) => t.id === threadId);
      if (!thread) {
        const firstUserText = allMessages.find((m): m is Extract<ChatMessage, { role: "user" }> => m.role === "user")?.text ?? trimmed;
        thread = {
          id: threadId ?? `t-${now}`,
          dayOffset: 0,
          title: firstUserText.length > 28 ? `${firstUserText.slice(0, 28)}…` : firstUserText,
          preview: reply.reply.slice(0, 80),
          ageLabel: "NOW",
          status: "active",
          messages: [],
        };
        history.threads.unshift(thread);
      }
      thread.messages = allMessages;
      thread.preview = reply.reply.slice(0, 80);
      thread.ageLabel = "NOW";
      thread.status = "active";
      thread.archivedAt = undefined;
      thread.deletedAt = undefined;

      const validUpdates = (reply.file_updates ?? []).filter((f) => isCoachWritable(f.path));
      const commitMessage = reply.commit_message ? cleanCommitMessage(reply.commit_message) : "session update";

      try {
        for (const update of validUpdates) {
          await putFile(repo, update.path, token, update.content, `coach: chat — ${commitMessage}`);
        }
        await putFile(
          repo,
          CHAT_FILE_PATH,
          token,
          JSON.stringify({ threads: purgeExpired(history.threads) }, null, 2),
          `coach: chat — ${commitMessage}`,
        );
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        return Response.json({ error: `Coach replied but saving failed: ${errMessage}` }, { status: 502 });
      }

      return Response.json({
        reply: reply.reply,
        closed: true,
        threadId: thread.id,
        threads: purgeExpired(history.threads),
      });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  },
};
