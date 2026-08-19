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
import { applyCoachNote, applyMemoryUpdate, applyInjuryEvent, applyQuestEvent, applyProfileUpdate, applyCoachingStyleUpdate, applySportsUpdate, applySeasonStart, applyQuestCreate } from "./coach-chat/_lib/coachIntents.js";
import {
  generateInitialTemplates,
  applyTemplateEdit,
  applySessionPlan,
  validTemplateIdsFromManifest,
  templatePath,
  sessionPath,
  TEMPLATES_MANIFEST_PATH,
} from "./coach-chat/_lib/coachWorkoutFiles.js";
import { applyWeekPlan, applySessionReconcile, applyPlanEdit, CURRENT_WEEK_PATH } from "./coach-chat/_lib/coachWeekFiles.js";
import { MEMORY_PATH, INJURIES_PATH, COACH_LOG_PATH, PROFILE_PATH, MEMORY_NOTE_LABELS, type ProfileJson, type MemoryJson } from "./coach-chat/_lib/coachMemoryFiles.js";
import { PROGRESS_PATH, SEASONS_PATH, QUESTS_PATH } from "./coach-chat/_lib/coachQuestFiles.js";
import { renderCoachContext, renderQuestContext } from "./coach-chat/_lib/coachContext.js";
import { askGemini } from "./coach-chat/_lib/geminiClient.js";
import { parseJsonOrNull } from "./coach-chat/_lib/coachChatFiles.js";
import {
  combineExtraContext,
  injuryFlagsContext,
  activeQuestsContext,
  activeTemplatesContext,
  activeWeekSessionsContext,
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
      // §5: same lazy, closing-turn-only fetch pattern as the manifest above - current_week.json
      // is only relevant for week_plan/session_reconcile, both closing-only action fields.
      // Malformed/missing content is treated as "no current week yet" (currentWeekRaw stays
      // null), same defensive default as every other read in this pipeline.
      let currentWeekRaw: string | null = null;
      let weekSessionsForContext: { id: string; date: string; title: string; status: string }[] = [];
      if (closeIntent) {
        const manifestRaw = await getFileRaw(repo, TEMPLATES_MANIFEST_PATH, token).catch(() => null);
        validTemplateIds = validTemplateIdsFromManifest(manifestRaw);

        currentWeekRaw = await getFileRaw(repo, CURRENT_WEEK_PATH, token).catch(() => null);
        const parsedWeek = parseJsonOrNull<{ days?: { date: string; sessions?: { id: string; title: string; status: string }[] }[] }>(currentWeekRaw);
        weekSessionsForContext = (parsedWeek?.days ?? []).flatMap((day) =>
          (day.sessions ?? []).map((s) => ({ id: s.id, date: day.date, title: s.title, status: s.status })),
        );
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
            activeWeekSessionsContext(weekSessionsForContext),
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
        // Safe to drop reply.template_edit/session_plan/week_plan/plan_edit/session_reconcile
        // here even though the responseSchema above doesn't itself gate those fields by mode
        // (Gemini could technically emit one on a non-closing turn) - closing is only ever true
        // when closeIntent was, so validTemplateIds/currentWeekRaw were fetched, and none of
        // those fields are read again below this point since we return early.
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
      const hasMemoryUpdate = Boolean(memoryUpdate?.label && memoryUpdate.text?.trim());
      const coachingStyleUpdate = reply.coaching_style_update;
      const sportsUpdate = (reply.sports_update ?? []).filter((s) => s.trim().length > 0);
      const hasSportsUpdate = sportsUpdate.length > 0;

      // memory_update, coaching_style_update, and sports_update all write memory.json, so a turn
      // reporting more than one (e.g. a new fitness_baseline note plus a first-session sports
      // list) is chained in one resolve() against the same fresh read, the same pattern
      // currentWeekWrite below uses for session_reconcile + plan_edit - independent FileEntry
      // writes to the same path would silently drop all but the last (commitFilesAtomic has no
      // per-path merge, last blob for a path wins).
      const memoryFileWrite: FileEntry | undefined =
        hasMemoryUpdate || coachingStyleUpdate || hasSportsUpdate
          ? {
              path: MEMORY_PATH,
              resolve: async () => {
                let working: string | null = await getFileRaw(repo, MEMORY_PATH, token);
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
                  working = applyCoachingStyleUpdate(working, coachingStyleUpdate, todayDateString(timezone, new Date()), traceId);
                }
                if (hasSportsUpdate) {
                  working = applySportsUpdate(working, sportsUpdate, todayDateString(timezone, new Date()), traceId);
                }
                // At least one of hasMemoryUpdate/coachingStyleUpdate/hasSportsUpdate is true (the
                // guard above), so at least one branch ran and working is a real applier output,
                // never null.
                return working as string;
              },
            }
          : undefined;

      // Step 4b: reported only when the athlete opened/updated/resolved one or more injury flags
      // this close. Array (workout-backend-wiring live verification, same fix issue #410 already
      // gave quest_event) - a single object silently dropped every update past the first when an
      // athlete reported more than one injury change in the same message. Each event needs text
      // (a new flag) or a flag_id (an update to an existing one) to have anything to record.
      const injuryEvents = (reply.injury_event ?? []).filter(
        (event) => event.status != null && (event.flag_id != null || (event.text?.trim().length ?? 0) > 0),
      );
      const injuryEventWrite: FileEntry | undefined =
        injuryEvents.length > 0
          ? {
              path: INJURIES_PATH,
              resolve: async () => {
                const fresh = await getFileRaw(repo, INJURIES_PATH, token);
                return applyInjuryEvent(fresh, injuryEvents, todayDateString(timezone, new Date()));
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

      // Part 2 ledger split, step 3b: reported only when the athlete gave one or more new profile
      // basics this close. Array (same fix as injury_event/quest_event above) - a single object
      // silently dropped every field past the first when the athlete reported more than one in
      // the same message. Fetched fresh at commit time, same pattern as the other optional writes.
      const profileUpdates = (reply.profile_update ?? []).filter(
        (update) => update.field != null && update.value != null,
      );
      const profileUpdateWrite: FileEntry | undefined = profileUpdates.length > 0
        ? {
            path: PROFILE_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, PROFILE_PATH, token);
              return applyProfileUpdate(fresh, profileUpdates);
            },
          }
        : undefined;

      // §3: reported only when the athlete asked to permanently change one of their own existing
      // templates this close. Purely mechanical (skip_exercise_nums/skip_phases, no Gemini call
      // inside resolve()) since the free-form content-generation version was dropped after live
      // verification - see coachWorkoutFiles.ts's applyTemplateEdit for why. template_id is
      // re-validated at commit time against validTemplateIds (the same set Gemini was shown via
      // activeTemplatesContext) inside applyTemplateEdit itself - guard condition here just checks
      // the id is present. resolve() re-fetches the template's current content fresh at commit
      // time, same stale-read-avoidance pattern as coachNoteWrite/memoryUpdateWrite/etc above.
      const templateEdit = reply.template_edit;
      const templateEditWrite: FileEntry | undefined = templateEdit?.template_id
        ? {
            path: templatePath(templateEdit.template_id),
            resolve: async () => {
              const fresh = await getFileRaw(repo, templatePath(templateEdit.template_id), token);
              return applyTemplateEdit(fresh, templateEdit, validTemplateIds, traceId);
            },
          }
        : undefined;

      // §4: reported only when Coach is prescribing today's session as a modified version of one
      // of the athlete's own templates this close. session_date is server-computed here
      // (todayDateString), never Gemini-supplied - see coachPrompt.ts's GeminiReply.session_plan
      // comment for the reasoning. template_id is re-validated at commit time against
      // validTemplateIds (same set Gemini was shown via activeTemplatesContext) inside
      // applySessionPlan itself - guard condition here just checks the field is present.
      // resolve() re-fetches the template's current content fresh at commit time, same
      // stale-read-avoidance pattern as templateEditWrite above. No Gemini call inside
      // applySessionPlan - skip_exercise_nums is purely mechanical - so the write path itself
      // (session_date baked into the filename) can be computed up front rather than inside
      // resolve().
      const sessionPlan = reply.session_plan;
      const sessionPlanDate = todayDateString(timezone, new Date());
      const sessionPlanWrite: FileEntry | undefined = sessionPlan?.template_id
        ? {
            path: sessionPath(sessionPlanDate, sessionPlan.template_id),
            resolve: async () => {
              const fresh = await getFileRaw(repo, templatePath(sessionPlan.template_id), token);
              const { content } = applySessionPlan(
                fresh,
                { ...sessionPlan, session_date: sessionPlanDate },
                validTemplateIds,
                traceId,
              );
              return content;
            },
          }
        : undefined;

      // §5: week_plan / session_reconcile both target current_week.json - at most one FileEntry
      // for that path can go in a single commitFilesAtomic call. Gemini isn't prompted to set both
      // in the same turn, and if it ever did, session_reconcile's event(s) necessarily reference
      // session_ids from the PRE-turn week (the "Current week's sessions" context it was shown) -
      // but week_plan's ids are synthesized purely from date + array-index (coachWeekFiles.ts),
      // with no dependence on content. A same-day re-plan can coincidentally regenerate the exact
      // same id string for an entirely different, unrelated session, which would silently
      // misattribute the reconcile event to the wrong session rather than throwing - worse than a
      // crash. Rather than trying to make id-matching safe across a rebuild it can't meaningfully
      // survive (the old session being reconciled no longer conceptually exists once the week is
      // fully replaced), week_plan wins outright and session_reconcile is dropped with a loud
      // warning - a full-week rewrite already supersedes whatever the reconcile was reporting on.
      // Live verification: on a "busy" turn also carrying session_reconcile/plan_edit, Gemini
      // repeatedly hallucinated a placeholder week_plan alongside them (non-empty headline/body
      // like "Plan for week"/"Body", but days: []) - the old guard here only checked
      // Array.isArray(days), so that placeholder still counted as "genuinely requested," wrongly
      // won over the real reconcile/edit data, and then applyWeekPlan's own "exactly 7 days"
      // guard failed the WHOLE commit. Requiring the real day count here means a hallucinated
      // empty week_plan is ignored entirely, falling through to the session_reconcile/plan_edit
      // branch instead of destroying real data.
      const weekPlan = reply.week_plan;
      const weekPlanRequested = Boolean(weekPlan?.headline?.trim() && weekPlan.body?.trim() && weekPlan.days?.length === 7);
      const sessionReconcileEvents = reply.session_reconcile ?? [];
      const planEditEvents = reply.plan_edit ?? [];

      let currentWeekWrite: FileEntry | undefined;
      if (weekPlanRequested) {
        // §5: week_plan - reported only when Coach is genuinely committing the full week now
        // (Weekly Kick-off Ritual). template_id inside each session is re-validated at commit
        // time against validTemplateIds inside applyWeekPlan itself (nulled out, not thrown - see
        // coachWeekFiles.ts's own comment for why this differs from template_edit/session_plan's
        // throw-on-hallucination discipline). No resolve() needed - week_plan is a full rewrite,
        // not a patch onto existing content. If session_reconcile/plan_edit are also set this same
        // turn, both are dropped (see the comment above this block) rather than chained against
        // week_plan's fresh output - week_plan always wins outright.
        if (sessionReconcileEvents.length > 0 || planEditEvents.length > 0) {
          console.warn(
            "[coach-chat] week_plan and session_reconcile/plan_edit both set in the same turn - dropping the latter " +
              "(their ids reference the pre-rebuild week and can't be safely matched against week_plan's fresh ids)",
            { traceId },
          );
        }
        currentWeekWrite = { path: CURRENT_WEEK_PATH, content: applyWeekPlan(weekPlan!, validTemplateIds, timezone, traceId, new Date()) };
      } else if (sessionReconcileEvents.length > 0 || planEditEvents.length > 0) {
        // §5 + follow-up: session_reconcile (outcome + optional relabel) and plan_edit (change a
        // future session's planned content) can both fire in the same turn - the two-fact swap
        // pattern ("did badminton instead of today's plan, and move football to tomorrow").
        // Chained in one resolve() the same way week_plan+session_reconcile used to be: reconcile
        // runs first against fresh content, then plan_edit runs on that same result, so a turn
        // reporting both never risks reading stale disk content between the two. Both ids are
        // re-validated at commit time against whatever current_week.json actually contains
        // (throws on a hallucinated/stale id, same discipline as applyQuestEvent's quest_id
        // guard).
        currentWeekWrite = {
          path: CURRENT_WEEK_PATH,
          resolve: async () => {
            let working: string | null = await getFileRaw(repo, CURRENT_WEEK_PATH, token);
            if (sessionReconcileEvents.length > 0) {
              working = applySessionReconcile(working, sessionReconcileEvents, validTemplateIds, traceId, new Date());
            }
            if (planEditEvents.length > 0) {
              working = applyPlanEdit(working, planEditEvents, validTemplateIds, traceId, new Date());
            }
            // At least one of sessionReconcileEvents/planEditEvents is non-empty (the guard that
            // got us into this branch), so at least one of the two calls above ran - and both
            // applySessionReconcile and applyPlanEdit throw rather than return null when
            // current_week.json can't be read, same "real applier output, never null" shape as
            // memoryFileWrite's working above. working is a real string here.
            return working as string;
          },
        };
      }

      // First Session Protocol only - creates the athlete's first season. season_start/
      // quest_create each touch their own file (seasons.json/quests.json), so each gets its own
      // FileEntry, same pattern as templateEditWrite/sessionPlanWrite above (fetch fresh content
      // at commit time, apply, return).
      const seasonStart = reply.season_start;
      const seasonStartWrite: FileEntry | undefined = seasonStart?.name?.trim()
        ? {
            path: SEASONS_PATH,
            resolve: async () => {
              const fresh = await getFileRaw(repo, SEASONS_PATH, token);
              return applySeasonStart(fresh, seasonStart, traceId, new Date());
            },
          }
        : undefined;

      // First Session Protocol only - creates the athlete's main quest and any habit quests.
      const questCreate = reply.quest_create;
      const questCreateWrite: FileEntry | undefined =
        questCreate?.main_quest || (questCreate?.quests?.length ?? 0) > 0
          ? {
              path: QUESTS_PATH,
              resolve: async () => {
                const fresh = await getFileRaw(repo, QUESTS_PATH, token);
                return applyQuestCreate(fresh, questCreate!, todayDateString(timezone, new Date()), traceId, new Date());
              },
            }
          : undefined;

      // B2/ADR 0018 fix: profile.json isn't re-fetched from the repo here, but this turn's own
      // writes (profileUpdates / sportsUpdate, computed above for the FileEntry resolvers) are
      // projected in-memory onto the pre-turn profile/memory objects so profileComplete reflects
      // what THIS turn just committed, not stale pre-turn state. wasProfileComplete stays the real
      // pre-turn value (unchanged objects) - this is what makes the false->true transition below
      // (coach_since stamping, initial template generation) able to fire at all; previously both
      // sides read the identical pre-turn objects and the transition was permanently dead.
      const wasProfileComplete = isAthleteProfileComplete(profile, memory);
      // profile/memory can be null (a genuinely brand-new athlete, profile.json/memory.json
      // don't exist yet) - project onto a fresh default shape rather than staying null, or a
      // turn that sets both name and sports for the first time (profile_update + sports_update
      // together) would incorrectly still read as incomplete this same turn.
      const projectedName = profileUpdates.find((u) => u.field === "name")?.value ?? profile?.name ?? "";
      const projectedProfile: ProfileJson = {
        version: 1,
        coach_since: profile?.coach_since ?? null,
        name: projectedName,
        dob: profile?.dob ?? null,
        timezone: profile?.timezone ?? "UTC",
        height_cm: profile?.height_cm ?? null,
        weight_kg: profile?.weight_kg ?? null,
      };
      const projectedMemory: MemoryJson = {
        version: 1,
        _meta: memory?._meta ?? { updated_at: "", updated_by: "model", trace_id: "" },
        sports: hasSportsUpdate ? sportsUpdate : memory?.sports ?? [],
        coaching_style: memory?.coaching_style ?? null,
        notes:
          memory?.notes ??
          (Object.fromEntries(
            MEMORY_NOTE_LABELS.map((l) => [l, { text: "", updated_at: "", trace_id: "" }]),
          ) as MemoryJson["notes"]),
      };
      const profileComplete = isAthleteProfileComplete(projectedProfile, projectedMemory);
      const validUpdates = injectCoachSinceIfNeeded([], closingFiles, wasProfileComplete, profileComplete, timezone);

      if (validUpdates.length === 0 && !trimmedCoachNote) {
        console.warn("[coach-chat] close landed with no coach_note.", { athleteMessage: trimmed, traceId });
      }

      // ADR 0012: chat_history.json plus coach_log.json (when reported), plus a coach_since stamp
      // when needed, land in ONE atomic commit.
      const optionalWrites: FileEntry[] = [];
      if (coachNoteWrite) optionalWrites.push(coachNoteWrite);
      if (memoryFileWrite) optionalWrites.push(memoryFileWrite);
      if (injuryEventWrite) optionalWrites.push(injuryEventWrite);
      if (questEventWrite) optionalWrites.push(questEventWrite);
      if (profileUpdateWrite) optionalWrites.push(profileUpdateWrite);
      if (templateEditWrite) optionalWrites.push(templateEditWrite);
      if (sessionPlanWrite) optionalWrites.push(sessionPlanWrite);
      if (currentWeekWrite) optionalWrites.push(currentWeekWrite);
      if (seasonStartWrite) optionalWrites.push(seasonStartWrite);
      if (questCreateWrite) optionalWrites.push(questCreateWrite);
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
