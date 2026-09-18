import {
  getFileRaw,
  getHeadShaOrNull,
  isFirstSessionRitualDone,
  listDirectory,
  loadCoachContext,
} from "./decide/coachChatFiles.js";
import { withComputedDayOffsets, todayDateString } from "./decide/coachDay.js";
import { loadTodayActivityNotes } from "./decide/todayActivityNotes.js";
import { loadChatHistory, pruneForResponse, type ChatMessage } from "./chatThreads.js";
import { type ClosingFileContext } from "./decide/coachSinceStamp.js";
import { renderCoachContext, renderQuestContext } from "./decide/coachContext.js";
import { captureServerException } from "../../_lib/sentry.js";
import { type OnboardingHints } from "./llm/coachPromptText.js";
import { capText } from "./_generated/text-caps.bundle.js";
import type { CoachLogJson } from "./decide/coachMemoryFiles.js";

import {
  ACTIVITIES_HIST_DIR,
  parseActivityIds,
  type ActivitySyncRequest,
} from "./decide/activitySync.js";

interface PostBody {
  threadId?: string;
  messages?: ChatMessage[];
  message?: string;
  action?: "greet" | "activity_sync";
  activity_ids?: unknown;
  knownSha?: string;
  onboardingHints?: OnboardingHints;
}

export interface GreetRequest {
  action: "greet";
  onboardingHints?: OnboardingHints;
}

export interface TurnRequest {
  threadId?: string;
  priorMessages: ChatMessage[];
  trimmed: string;
  athleteMessage: string;
  knownSha?: string;
}

export interface TurnState extends TurnRequest {
  repo: string;
  token: string;
  apiKey: string;
  currentSha: string | null;
  stale: boolean;
  context: Awaited<ReturnType<typeof loadCoachContext>>;
  timezone: string;
  // Computed once here and reused everywhere this turn needs "today" (athleteContext,
  // questContext, and later buildCoachNoteWrite's day-keyed overwrite) - recomputing it
  // independently at commit time, after an askLlm round trip (or a reprompt's second one),
  // can land on a different day than what Gemini was actually shown if the turn straddles local
  // midnight.
  today: string;
  athleteContext: string;
  questContext: string;
  firstSession: boolean;
  now: number;
  traceId: string;
  userMsg?: Extract<ChatMessage, { role: "user" }>;
  closingFiles?: ClosingFileContext;
  // D1 layer 1 (#736): extracted here, before the askLlm call, instead of only after (as
  // buildTurnWrites did pre-D1) - generationConfigFor needs these to build the request's
  // enum-constrained quest_id/flag_id fields, not just to validate the reply afterward.
  validQuestIds: ReadonlySet<string>;
  validInjuryFlagIds: ReadonlySet<string>;
  // A2 (#727) invariant 7: the subset of validInjuryFlagIds that's currently active - the set
  // workout_create's injury_ack must cover. See AthleteReferenceIds.activeInjuryFlagIds.
  activeInjuryFlagIds: ReadonlySet<string>;
  // Bug 3 (2026-09-10 pro baseline): the most recent real coach_log.json row's
  // pending_clarification, if any is still unresolved - see parsePendingClarification for how
  // it's read back and findUnconfirmedAssumption for how it's enforced.
  pendingClarification: string | null;
}

export async function handleHistory(repo: string, token: string): Promise<Response> {
  const [history, context] = await Promise.all([
    loadChatHistory(repo, token),
    loadCoachContext(repo, token),
  ]);
  const timezone = context.profile?.timezone?.trim() || "UTC";
  return Response.json({
    threads: withComputedDayOffsets(pruneForResponse(history.threads), timezone),
  });
}

export async function parseTurnRequest(
  req: Request,
): Promise<Response | GreetRequest | TurnRequest | ActivitySyncRequest> {
  const body = (await req.json()) as PostBody;
  if (body.action === "greet") return { action: "greet", onboardingHints: body.onboardingHints };
  if (body.action === "activity_sync") {
    const parsedIds = parseActivityIds(body.activity_ids);
    if (!parsedIds.ok) return Response.json({ error: parsedIds.error }, { status: 400 });
    return {
      action: "activity_sync",
      activity_ids: parsedIds.activityIds,
      knownSha: body.knownSha,
    };
  }

  const trimmed = (body.message ?? "").trim();
  if (!trimmed) return Response.json({ error: "Message required" }, { status: 400 });
  return {
    threadId: body.threadId,
    priorMessages: body.messages ?? [],
    trimmed,
    athleteMessage: trimmed,
    knownSha: body.knownSha,
  };
}

export function isGreetRequest(
  value: GreetRequest | TurnRequest | ActivitySyncRequest,
): value is GreetRequest {
  return "action" in value && value.action === "greet";
}

export function isActivitySyncRequest(
  value: GreetRequest | TurnRequest | ActivitySyncRequest,
): value is ActivitySyncRequest {
  return "action" in value && value.action === "activity_sync";
}

// Bug 3 (2026-09-10 pro baseline): pending_clarification is persisted inside the same day-keyed
// coach_log.json row coach_note already writes to (buildCoachNoteWrite), wrapped in a recognizable
// marker so it survives the round trip through free text without needing a schema change to
// coach_log.json itself. Only the most recent row is checked - an older unresolved question that's
// since been superseded (a new day's row written, with or without its own marker) shouldn't keep
// blocking forever. See formatPendingClarificationMarker for the write side.
const PENDING_CLARIFICATION_MARKER = "[Pending clarification:";

function parsePendingClarification(coachLog: CoachLogJson | null | undefined): string | null {
  const rows = coachLog?.rows ?? [];
  if (rows.length === 0) return null;
  const latestText = rows[rows.length - 1]?.text ?? "";
  const start = latestText.indexOf(PENDING_CLARIFICATION_MARKER);
  if (start === -1) return null;
  const afterMarker = latestText.slice(start + PENDING_CLARIFICATION_MARKER.length);
  // The marker always sits on its own line (joined first, with "\n" separating it from anything
  // after) and always closes with "]" as that line's very last character - taking the line's LAST
  // "]" rather than its first is what lets a question that legitimately contains one ("should I
  // do a [tempo] run?") come through intact instead of truncating at the wrong bracket.
  const newlineIndex = afterMarker.indexOf("\n");
  const markerLine = newlineIndex === -1 ? afterMarker : afterMarker.slice(0, newlineIndex);
  const end = markerLine.lastIndexOf("]");
  if (end === -1) return null;
  const question = markerLine.slice(0, end).trim();
  return question.length > 0 ? question : null;
}

// Bounded well under COACH_LOG_TEXT_CAP so the marker's own contribution to buildCoachNoteWrite's
// budget is small and predictable - a real open question is a short sentence, never anywhere near
// this, and capText's own truncation marker text is reserved for the free-text note portion, not
// this one.
const PENDING_CLARIFICATION_TEXT_CAP = 200;

// Write side of parsePendingClarification above - wraps the model's self-reported open question
// in the same recognizable marker. Undefined (folds into nothing) when the reply didn't leave one
// open, same "no empty line added" discipline as formatDroppedActionsNote.
// Exported so buildTurnWrites.ts (decide→write assembly) can call this same write-side helper.
export function formatPendingClarificationMarker(
  pendingClarification: string | undefined,
): string | undefined {
  const trimmed = pendingClarification?.trim();
  if (!trimmed) return undefined;
  return `${PENDING_CLARIFICATION_MARKER} ${capText(trimmed, PENDING_CLARIFICATION_TEXT_CAP)}]`;
}

export async function loadTurnState(
  request: TurnRequest,
  repo: string,
  token: string,
  apiKey: string,
): Promise<Response | TurnState> {
  const currentSha = await getHeadShaOrNull(repo, token);
  const stale = request.knownSha != null && currentSha != null && request.knownSha !== currentSha;
  const context = await loadCoachContext(repo, token, {
    fresh: stale,
    ref: currentSha ?? undefined,
  });
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
  if (!soul) {
    await captureServerException(new Error("Coach SOUL bundle is unavailable"));
    return Response.json({ error: "Coach SOUL bundle is unavailable" }, { status: 500 });
  }

  const timezone = profile?.timezone?.trim() || "UTC";
  const firstSession = !isFirstSessionRitualDone(profile, memory, seasons, quests);
  const now = Date.now();
  const traceId = Math.random().toString(36).slice(2, 10);
  const today = todayDateString(timezone, new Date());
  // D1 layer 1 (#736): the athlete's real current quest/injury ids, extracted before the Gemini
  // call so generationConfigFor can enum-constrain quest_event.quest_id/injury_event.flag_id to
  // real values, not just validate the reply after the fact.
  const validQuestIds = new Set<string>(
    [
      quests?.main_quest?.id,
      ...(quests?.quests ?? [])
        .filter((quest) => quest.status === "active")
        .map((quest) => quest.id),
    ].filter((id): id is string => Boolean(id)),
  );
  const validInjuryFlagIds = new Set<string>(
    (injuries?.flags ?? []).map((flag) => flag.id).filter((id): id is string => Boolean(id)),
  );
  // A2 (#727) invariant 7: active-only subset, same filter activeInjuryFlagsSection
  // (coachContext.ts) already uses to build the athlete-context section Gemini reads flag ids
  // from.
  const activeInjuryFlagIds = new Set<string>(
    (injuries?.flags ?? [])
      .filter((flag) => flag.status === "active")
      .map((flag) => flag.id)
      .filter((id): id is string => Boolean(id)),
  );
  // #1147: strict no-op unless priorMessages actually carries a synced_activity_list attachment
  // with a today-dated row - loadTodayActivityNotes returns [] before ever calling
  // listActivityFiles in that case, so an ordinary (non-sync) thread costs nothing extra here.
  // Re-read fresh every turn, on purpose - never cached across the conversation - so a note the
  // athlete writes mid-thread shows up starting the very next reply.
  //
  // Both deps below are soft reads (ADR 0032, #1078): a GitHub fault or a bad response here has
  // nothing to do with whether an activity note exists, so it must fail open - degrade to "no
  // note" - rather than break the whole reply turn. Same contract as getHeadShaOrNull and every
  // other soft read in this file (404 quiet; any other fault captures once then degrades).
  // Inlined at each site, same discipline as the TEMPLATES_MANIFEST/CURRENT_WEEK soft reads below
  // - do not add a shared getFileRawOrNull/listDirectoryOrNull.
  const todayActivityNotes = await loadTodayActivityNotes(request.priorMessages, today, {
    listActivityFiles: async () => {
      try {
        const listing = await listDirectory(repo, ACTIVITIES_HIST_DIR, token);
        return (listing ?? [])
          .filter((entry) => entry.type === "file")
          .map((entry) => ({ name: entry.name, path: entry.path }));
      } catch (err: unknown) {
        // listDirectory already resolves a 404 to null internally - anything that reaches this
        // catch is a real fault (5xx, network, auth), never a missing-directory quiet case.
        await captureServerException(err);
        return [];
      }
    },
    readFile: async (path) => {
      try {
        return await getFileRaw(repo, path, token);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        if (status === 404) return null;
        await captureServerException(err);
        return null;
      }
    },
  });

  return {
    ...request,
    repo,
    token,
    apiKey,
    currentSha,
    stale,
    context,
    timezone,
    today,
    athleteContext: renderCoachContext({
      profile,
      memory,
      injuries,
      coachLog,
      athleteInsights,
      today,
      todayActivityNotes,
    }),
    questContext: renderQuestContext({
      seasons,
      quests,
      progress,
      progressions,
      today,
    }),
    firstSession,
    now,
    traceId,
    userMsg: request.trimmed ? { id: `u-${now}`, role: "user", text: request.trimmed } : undefined,
    validQuestIds,
    validInjuryFlagIds,
    activeInjuryFlagIds,
    pendingClarification: parsePendingClarification(coachLog),
  };
}
