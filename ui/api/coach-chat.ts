/** Hosted Coach Phelps HTTP route. Turn stages live in coach-chat/_lib/coachTurn.ts and activitySyncTurn.ts. */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { commitFilesAtomic, type FileEntry } from "./_lib/githubGitData.js";
import {
  getFileRaw,
  getHeadSha,
  invalidateCoachContext,
  isAthleteProfileComplete,
  isFirstSessionRitualDone,
  loadCoachContext,
  resolveCoachChatBranch,
} from "./coach-chat/_lib/decide/coachChatFiles.js";
import { withComputedDayOffsets, todayDateString } from "./coach-chat/_lib/decide/coachDay.js";
import { loadChatHistory, pruneForResponse } from "./coach-chat/_lib/chatThreads.js";
import { applyProfileUpdate, applySportsUpdate } from "./coach-chat/_lib/decide/coachIntents.js";
import { MEMORY_PATH, PROFILE_PATH } from "./coach-chat/_lib/decide/coachMemoryFiles.js";
import { renderCoachContext, renderQuestContext } from "./coach-chat/_lib/decide/coachContext.js";
import { askGemini, GEMINI_MODEL } from "./coach-chat/_lib/gemini/geminiClient.js";
import { captureGeminiFailure, withProcessingSpan, withSentryRoute } from "./_lib/sentry.js";
import {
  combineExtraContext,
  firstSessionContext,
  onboardingHintsContext,
  type OnboardingHints,
} from "./coach-chat/_lib/gemini/coachPromptText.js";
import type { GeminiReply } from "./coach-chat/_lib/gemini/coachReplySchema.js";
import { FIRST_SESSION_PROTOCOL } from "./_generated/soul.js";
import { onboardingChanges } from "./coach-chat/_lib/decide/onboardingWrites.js";
import {
  buildTurnWrites,
  commitTurn,
  handleHistory,
  isActivitySyncRequest,
  isGreetRequest,
  loadTurnState,
  parseTurnRequest,
  requestCoachReply,
} from "./coach-chat/_lib/coachTurn.js";
import { handleActivitySync } from "./coach-chat/_lib/commit/activitySyncTurn.js";

async function handleGreet(
  repo: string,
  token: string,
  apiKey: string,
  onboardingHints?: OnboardingHints,
): Promise<Response> {
  const [history, context] = await Promise.all([
    loadChatHistory(repo, token),
    loadCoachContext(repo, token),
  ]);
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
  if (!soul) return Response.json({ error: "Coach SOUL bundle is unavailable" }, { status: 500 });
  const timezone = profile?.timezone?.trim() || "UTC";

  const { name: hintedName, sports: hintedSports } = onboardingChanges(
    onboardingHints,
    profile,
    memory,
  );
  const traceId = `onboard-${Date.now().toString(36)}`;
  const onboardingWrites: FileEntry[] = [];
  if (hintedName) {
    onboardingWrites.push({
      path: PROFILE_PATH,
      resolve: async () =>
        applyProfileUpdate(await getFileRaw(repo, PROFILE_PATH, token), [
          { field: "name", value: hintedName },
        ]),
    });
  }
  if (hintedSports) {
    onboardingWrites.push({
      path: MEMORY_PATH,
      resolve: async () =>
        applySportsUpdate(
          await getFileRaw(repo, MEMORY_PATH, token),
          hintedSports,
          todayDateString(timezone, new Date()),
          traceId,
        ),
    });
  }
  if (onboardingWrites.length > 0) {
    await commitFilesAtomic(onboardingWrites, "coach: native onboarding details recorded", {
      repo,
      branch: resolveCoachChatBranch(),
      token,
    });
    invalidateCoachContext(repo);
  }

  const athleteContext = renderCoachContext({
    profile,
    memory,
    injuries,
    coachLog,
    athleteInsights,
    today: todayDateString(timezone, new Date()),
  });
  const questContext = renderQuestContext({
    seasons,
    quests,
    progress,
    progressions,
    today: todayDateString(timezone, new Date()),
  });
  const firstSession = !isFirstSessionRitualDone(profile, memory, seasons, quests);
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
      firstSession,
      combineExtraContext(
        firstSessionContext(firstSession, FIRST_SESSION_PROTOCOL),
        onboardingHintsContext(onboardingHints),
      ),
      undefined,
      timezone,
    );
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] greet askGemini failed:", err);
    await captureGeminiFailure(err, {
      model: GEMINI_MODEL,
      upstreamStatus: status,
      turnMode: "greeting",
      // Coach opens a greeting turn, so there is no athlete text to record.
      athleteMessage: "",
    });
    return Response.json({ error: message }, { status });
  }

  const now = Date.now();
  const repoSha = await getHeadSha(repo, token).catch(() => null);
  const freshContext =
    onboardingWrites.length > 0 ? await loadCoachContext(repo, token, { fresh: true }) : context;
  return Response.json({
    reply: reply.reply,
    threadId: `t-${now}`,
    threads: withComputedDayOffsets(pruneForResponse(history.threads), timezone),
    repoSha,
    profileComplete: isAthleteProfileComplete(
      freshContext.profile,
      freshContext.memory,
      freshContext.seasons,
    ),
  });
}

export async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
  const repo = auth.repo_full_name;
  const token = auth.gh_token;
  if (req.method === "GET") return handleHistory(repo, token);
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Coach chat isn't configured yet" }, { status: 500 });
  const parsed = await parseTurnRequest(req);
  if (parsed instanceof Response) return parsed;
  if (isGreetRequest(parsed)) return handleGreet(repo, token, apiKey, parsed.onboardingHints);
  if (isActivitySyncRequest(parsed)) return handleActivitySync(repo, token, apiKey, parsed);

  const state = await withProcessingSpan("load_turn_state", () =>
    loadTurnState(parsed, repo, token, apiKey),
  );
  if (state instanceof Response) return state;
  const replied = await requestCoachReply(state);
  if (replied instanceof Response) return replied;
  const turn = await withProcessingSpan("build_turn_writes", () => buildTurnWrites(replied));
  return commitTurn(turn);
}

export default {
  async fetch(req: Request): Promise<Response> {
    return withSentryRoute(req, async ({ captureException, setAthleteScope }) => {
      const resolved = await resolveRepoAuth(req);
      if (resolved instanceof Response) return resolved;
      setAthleteScope(resolved.repo_full_name);
      try {
        return withSessionCookie(await handle(req, resolved), resolved.setCookie);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Coach chat failed";
        const status = (err as { status?: number }).status === 401 ? 401 : 500;
        console.error("[coach-chat]", err);
        await captureException(err);
        return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
      }
    });
  },
};
