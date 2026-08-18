/**
 * coach-chat.ts — real Coach Phelps sessions from the browser and iOS, backed by Gemini.
 * Full design/flow: docs/eng-docs/coach-chat-flow.md. Commit + retention: ADR 0012. This file is
 * the HTTP handler only - prompt construction, Gemini transport, thread persistence, write
 * authority, day math, and close-signal detection live under ui/api/coach-chat/_lib/.
 *
 * GET                        → load committed threads
 * POST {action: "greet"}     → Coach speaks first (A4), no athlete message, no repo write
 * POST {threadId?, messages, message} → send a message, get a reply. No repo write unless it
 *                               closes the session, in which case the whole thread (+ coach_note,
 *                               if any) commits in one batch.
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
  serializeChatHistory,
  type ChatMessage,
  type ChatThread,
} from "./coach-chat/_lib/chatThreads.js";
import { loadClosingFileContext, injectCoachSinceIfNeeded, type ClosingFileContext } from "./coach-chat/_lib/coachWrites.js";
import { applyCoachNote, applyMemoryUpdate, applyInjuryEvent, applyQuestEvent, applyProfileUpdate } from "./coach-chat/_lib/coachIntents.js";
import {
  generateInitialTemplates,
  applyTemplateEdit,
  validTemplateIdsFromManifest,
  templatePath,
  TEMPLATES_MANIFEST_PATH,
} from "./coach-chat/_lib/coachWorkoutFiles.js";
import { MEMORY_PATH, INJURIES_PATH, COACH_LOG_PATH, PROFILE_PATH } from "./coach-chat/_lib/coachMemoryFiles.js";
import { PROGRESS_PATH } from "./coach-chat/_lib/coachQuestFiles.js";
import { renderCoachContext, renderQuestContext } from "./coach-chat/_lib/coachContext.js";
import { askGemini } from "./coach-chat/_lib/geminiClient.js";
import {
  combineExtraContext,
  injuryFlagsContext,
  activeQuestsContext,
  activeTemplatesContext,
  firstSessionContext,
  onboardingHintsContext,
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
  const { soul, profile, memory, injuries, coachLog, seasons, quests, progress, progressions } = context;
  if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });
  const timezone = profile?.timezone?.trim() || "UTC";
  const athleteContext = renderCoachContext({ profile, memory, injuries, coachLog });
  const questContext = renderQuestContext({ seasons, quests, progress, progressions, today: todayDateString(timezone, new Date()) });

  let reply: GeminiReply;
  try {
    reply = await askGemini(
      apiKey,
      soul,
      athleteContext,
      questContext,
      [],
      "",
      "greeting",
      combineExtraContext(
        firstSessionContext(isAthleteProfileComplete(profile, memory), FIRST_SESSION_PROTOCOL),
        onboardingHintsContext(onboardingHints),
        injuryFlagsContext(injuries),
        activeQuestsContext(quests),
      ),
      undefined,
      timezone,
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
    threads: withComputedDayOffsets(history.threads, timezone),
    repoSha,
  });
}

// Split from fetch() below so a rotated session cookie only needs attaching in one place.
async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
    const repo = auth.repo_full_name;
    const token = auth.gh_token;

    if (req.method === "GET") {
      const [history, context] = await Promise.all([loadChatHistory(repo, token), loadCoachContext(repo, token)]);
      // Retention is enforced on write, not here - a GET must never rewrite the file just
      // because it was read.
      const timezone = context.profile?.timezone?.trim() || "UTC";
      return Response.json({ threads: withComputedDayOffsets(history.threads, timezone) });
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
      const { soul, profile, memory, injuries, coachLog, seasons, quests, progress, progressions } = await loadCoachContext(repo, token, { fresh: stale });
      if (!soul) return Response.json({ error: "SOUL.md not found in your repo" }, { status: 400 });
      const timezone = profile?.timezone?.trim() || "UTC";
      const athleteContext = renderCoachContext({ profile, memory, injuries, coachLog });
      const questContext = renderQuestContext({ seasons, quests, progress, progressions, today: todayDateString(timezone, new Date()) });

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

      // §3: template_edit is only relevant on a closing turn (same as the other action fields),
      // so the manifest is only fetched lazily here rather than folded into every turn's
      // loadCoachContext read - a missing/unparseable manifest just means no templates are
      // editable via chat yet for this athlete (validTemplateIdsFromManifest's own defensive
      // default), never thrown.
      let validTemplateIds: ReadonlySet<string> = new Set();
      if (closeIntent) {
        const manifestRaw = await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token).catch(() => null);
        validTemplateIds = validTemplateIdsFromManifest(manifestRaw);
      }

      let reply: GeminiReply;
      try {
        reply = await askGemini(
          apiKey,
          soul,
          athleteContext,
          questContext,
          priorMessages,
          trimmed,
          closeIntent ? "closing" : "ordinary",
          // First Session spans several turns, so this has to fire on ordinary turns too -
          // greet-only would drop the protocol the moment the athlete answered the first question.
          combineExtraContext(
            firstSessionContext(isAthleteProfileComplete(profile, memory), FIRST_SESSION_PROTOCOL),
            injuryFlagsContext(injuries),
            activeQuestsContext(quests),
            activeTemplatesContext(validTemplateIds),
          ),
          traceId,
          timezone,
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
        : [{ id: `d-${now}`, role: "divider", label: todayDividerLabel(timezone) }, userMsg, coachMsg];

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
          // No "deleted" check here anymore - part3-rollout dropped status from the persisted
          // shape entirely (ADR 0012 amendment: a deleted thread is filtered out of the array on
          // write, never soft-marked, so "deleted" could never actually be found on disk).
          const thread: ChatThread = {
            id: finalThreadId,
            createdAt: existing?.createdAt ?? now,
            title: existing?.title ?? computedTitle,
            preview: previewText,
            messages: allMessages,
          };
          const retained = applyRetention(mergeThreadToFront(fresh.threads, thread));
          latestThreads = retained;
          return serializeChatHistory(retained, new Date().toISOString(), traceId);
        },
      };

      // Only included in `writes` below when non-empty. Fetches coach_log.json fresh at commit
      // time, same pattern as chatWrite above. coach_log.json is the single merged continuity
      // log - it absorbed what used to be a separate coach_notes.md append plus a separate
      // rolling_state.json array write.
      const trimmedCoachNote = reply.coach_note?.trim();
      const coachNoteWrite: FileEntry | undefined = trimmedCoachNote
        ? {
            path: COACH_LOG_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, COACH_LOG_PATH, token);
              return applyCoachNote(fresh, trimmedCoachNote, todayDateString(timezone, new Date()), traceId, new Date());
            },
          }
        : undefined;

      // Step 4a: reported only when the athlete's memory.json actually changed something this
      // close - most closes carry no memory_update at all. Fetched fresh at commit time, same
      // pattern as coachNoteWrite above.
      const memoryUpdate = reply.memory_update;
      const memoryUpdateWrite: FileEntry | undefined = memoryUpdate?.label && memoryUpdate.text?.trim()
        ? {
            path: MEMORY_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, MEMORY_PATH, token);
              return applyMemoryUpdate(
                fresh,
                memoryUpdate.label,
                memoryUpdate.text,
                todayDateString(timezone, new Date()),
                traceId,
              );
            },
          }
        : undefined;

      // Step 4b: reported only when the athlete opened/updated/resolved an injury flag this
      // close. A new flag requires text (enforced here, before the write ever hits
      // applyInjuryEvent) since a flag_id-less event with no text has nothing to record.
      const injuryEvent = reply.injury_event;
      const injuryEventValid =
        injuryEvent?.status != null &&
        (injuryEvent.flag_id != null || (injuryEvent.text?.trim().length ?? 0) > 0);
      const injuryEventWrite: FileEntry | undefined = injuryEventValid
        ? {
            path: INJURIES_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, INJURIES_PATH, token);
              return applyInjuryEvent(fresh, injuryEvent!, todayDateString(timezone, new Date()));
            },
          }
        : undefined;

      // Part 2 ledger split, step 3a: reported only when the athlete logged one or more quest
      // completions/misses/excuses this close (issue #410: quest_event is now an array so a turn
      // reporting several at once captures all of them). currentSeasonId comes from the pre-turn
      // seasons.json read (not re-fetched at commit time) - a season change mid-conversation is
      // not a case worth guarding against here, same trust level as the rest of this turn's
      // context.
      const questEvents = reply.quest_event ?? [];
      const currentSeasonId = seasons?.current_season_id ?? "";
      // Same real ids injected into the prompt (activeQuestsContext) that Gemini was told to use
      // verbatim - applyQuestEvent throws on anything outside this set. Found in review: this
      // used to include every quest regardless of status, but activeQuestsContext only ever
      // shows status:"active" side quests (plus the main quest, which has no status to filter
      // on) - a graduated/retired quest's id was accepted even though Gemini was never told about
      // it. Filter to match activeQuestsContext exactly, not just "same variable name, different
      // scope."
      const validQuestIds = new Set<string>(
        [quests?.main_quest?.id, ...(quests?.quests ?? []).filter((q) => q.status === "active").map((q) => q.id)].filter((id): id is string =>
          Boolean(id),
        ),
      );
      const questEventWrite: FileEntry | undefined = questEvents.length > 0
        ? {
            path: PROGRESS_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, PROGRESS_PATH, token);
              return applyQuestEvent(
                fresh,
                questEvents,
                todayDateString(timezone, new Date()),
                currentSeasonId,
                traceId,
                new Date(),
                validQuestIds,
              );
            },
          }
        : undefined;

      // Part 2 ledger split, step 3b: reported only when the athlete gave a new profile basic
      // this close. Fetched fresh at commit time, same pattern as the other optional writes.
      const profileUpdate = reply.profile_update;
      const profileUpdateWrite: FileEntry | undefined = profileUpdate?.field && profileUpdate.value != null
        ? {
            path: PROFILE_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, PROFILE_PATH, token);
              return applyProfileUpdate(fresh, profileUpdate);
            },
          }
        : undefined;

      // §3: reported only when the athlete asked to change one of their own existing templates
      // this close. template_id is re-validated at commit time against validTemplateIds (the
      // same set Gemini was shown via activeTemplatesContext) inside applyTemplateEdit itself -
      // guard condition here just checks both fields are present. resolve() re-fetches the
      // template's current content fresh at commit time, same stale-read-avoidance pattern as
      // coachNoteWrite/memoryUpdateWrite/etc above.
      const templateEdit = reply.template_edit;
      const templateEditWrite: FileEntry | undefined = templateEdit?.template_id && templateEdit.instruction?.trim()
        ? {
            path: templatePath(templateEdit.template_id),
            resolve: async () => {
              const fresh = await getFileRaw(repo, templatePath(templateEdit.template_id), token);
              return applyTemplateEdit(fresh, templateEdit, validTemplateIds, traceId, apiKey);
            },
          }
        : undefined;

      // B2/ADR 0018: profile.json isn't edited here, so both sides of this transition check stay
      // the pre-turn value until something actually edits the Athlete Profile section (see BACKLOG.md #1).
      const wasProfileComplete = isAthleteProfileComplete(profile, memory);
      const profileComplete = isAthleteProfileComplete(profile, memory);
      const validUpdates = injectCoachSinceIfNeeded([], closingFiles, wasProfileComplete, profileComplete, timezone);

      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with no coach_note.", { athleteMessage: trimmed, traceId });
      }

      // ADR 0012: chat_history.json plus coach_log.json (when reported), plus a coach_since stamp
      // when needed, land in ONE atomic commit.
      const optionalWrites: FileEntry[] = [];
      if (coachNoteWrite) optionalWrites.push(coachNoteWrite);
      if (memoryUpdateWrite) optionalWrites.push(memoryUpdateWrite);
      if (injuryEventWrite) optionalWrites.push(injuryEventWrite);
      if (questEventWrite) optionalWrites.push(questEventWrite);
      if (profileUpdateWrite) optionalWrites.push(profileUpdateWrite);
      if (templateEditWrite) optionalWrites.push(templateEditWrite);
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

      // Part 5 §2: post-first-session template generation, only on the false->true
      // profileComplete transition (same trigger as injectCoachSinceIfNeeded above), and only if
      // this hasn't already run for this athlete (write-once, checked via the manifest
      // coachWorkoutFiles.ts stamps alongside the templates it writes). A second, separate
      // commit, deliberately best-effort: a failure here must never fail the athlete's response -
      // template generation is a nice-to-have follow-up to onboarding, not a hard requirement.
      if (!wasProfileComplete && profileComplete && profile && memory && injuries) {
        try {
          const existingManifest = await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token);
          if (existingManifest == null) {
            const { templates } = await generateInitialTemplates(
              profile,
              memory,
              injuries,
              timezone,
              traceId,
              apiKey,
            );
            await commitFilesAtomic(templates, "coach: initial workout templates generated", {
              repo,
              branch: resolveCoachChatBranch(),
              token,
            });
            console.log("[coach-chat] initial workout templates committed", { traceId, count: templates.length });
          }
        } catch (err) {
          console.error("[coach-chat] initial workout template generation failed - continuing without it:", err, { traceId });
        }
      }

      return Response.json({
        reply: reply.reply,
        closed: true,
        threadId: finalThreadId,
        threads: withComputedDayOffsets(latestThreads, timezone),
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
