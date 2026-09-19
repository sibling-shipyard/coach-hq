import { commitFilesAtomic, type FileEntry } from "../../_lib/githubGitData.js";
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import {
  getFileRaw,
  invalidateCoachContext,
  resolveCoachChatBranch,
} from "./decide/coachChatFiles.js";
import { withComputedDayOffsets, todayDateString } from "./decide/coachDay.js";
import { pruneForResponse } from "./chatThreads.js";
import {
  validTemplateIdsFromManifest,
  TEMPLATES_MANIFEST_PATH,
  TEMPLATES_PATH_PREFIX,
} from "./decide/coachWorkoutFiles.js";
import {
  buildBenchmarkSpec,
  repairBenchmarkSpecForInvariants,
  buildFallbackBenchmarkSpec,
  seedBenchmarkProgressions,
  inferTrainingAvailability,
  BENCHMARK_ROUTINE_ID,
} from "./decide/coachFirstSessionBenchmark.js";
import { compileFirstWeek } from "./decide/firstWeekCompile.js";
import { PROGRESSIONS_PATH } from "./decide/coachQuestFiles.js";
import { PROFILE_PATH, MEMORY_PATH } from "./decide/coachMemoryFiles.js";
import {
  captureServerException,
  captureServerMessage,
  captureValidationFailure,
} from "../../_lib/sentry.js";
import { type DroppedAction } from "./decide/turnWrites/validateActions.js";
import { CURRENT_WEEK_PATH, applyWeekUpdate } from "./decide/coachWeekFiles.js";
import { applyTrainingAvailabilityUpdate } from "./decide/coachProfileIntents.js";
import { buildWorkoutCreateAndRemoveWrites } from "./decide/turnWrites/workoutWrite.js";
import type { TurnWrites } from "./buildTurnWrites.js";
import { usageResponseInit } from "./requestCoachReply.js";
import { flushSilentFixups } from "./decide/silentFixups.js";

// Review finding (P2, #727 hardening): factored out of two near-identical read/merge-patch call
// sites that both cleared this same field (the standalone stale-marker path below, and the
// success-path clear inline in generateFirstSessionWorkoutsAfterCompletion) - same fresh-read,
// same patch shape, same warning on failure. Returns the FileEntry to commit, or null if there was
// nothing to write (no profile content, or the patch itself failed) - callers decide whether to
// commit it standalone or append it to a batch already in flight.
async function buildClearPendingWrite(turn: TurnWrites): Promise<FileEntry | null> {
  const freshProfileContent = await getFileRaw(turn.repo, PROFILE_PATH, turn.token);
  if (!freshProfileContent) return null;
  const cleared = applyJsonMergePatch(
    freshProfileContent,
    // Resets the attempt counter too, not just pending - if pending ever legitimately gets set
    // true again later (a fresh signup edge case, not the retry loop this counts), it should start
    // counting from zero rather than carrying over a stale count from an unrelated earlier attempt.
    JSON.stringify({ first_session_benchmark_pending: false, first_session_benchmark_attempts: 0 }),
  );
  if (!cleared.ok) {
    console.warn(`[coach-chat] could not clear first_session_benchmark_pending: ${cleared.error}`, {
      traceId: turn.traceId,
    });
    return null;
  }
  return { path: PROFILE_PATH, content: cleared.content };
}

// Standalone commit for the case generateFirstSessionWorkoutsAfterCompletion finds the benchmark
// already in the manifest but the marker still pending - a prior turn's own clear (below, folded
// into that turn's benchmark commit) must have dropped. There's no other write to piggyback on
// here, unlike the main path, so this is its own small commit rather than appended to `writes`.
async function clearFirstSessionBenchmarkPending(turn: TurnWrites): Promise<void> {
  const write = await buildClearPendingWrite(turn);
  if (!write) return;
  await commitFilesAtomic([write], "coach: clear stale first_session_benchmark_pending marker", {
    repo: turn.repo,
    branch: resolveCoachChatBranch(),
    token: turn.token,
  });
}

// Review finding (P1, #727 hardening): without a cap, a real failure unrelated to spec validity
// (a commit error, a transient GitHub API failure) left first_session_benchmark_pending stuck true
// forever - every future turn re-ran the full generation attempt with no backoff. 3 attempts is
// generous given the fallback spec is structurally safe from every invariant this pipeline checks;
// past this, whatever's failing is not something a 4th identical attempt will fix.
const FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS = 3;

// Writes one benchmark routine (coachFirstSessionBenchmark.ts's buildBenchmarkSpec, compiled
// through the same applyWorkoutCreate/buildWorkoutCreateAndRemoveWrites path an ordinary
// workout_create turn uses), seeds one progression per benchmarked pattern, derives the structured
// training_availability field from memory's existing intake prose, and compiles a real first week
// (firstWeekCompile.ts) that places the benchmark and anchor sessions on the athlete's stated
// training days. All one commit, and never allowed to block or fail the athlete's reply - none of
// this is on the critical path of the turn's own response, so a failure here only logs and moves
// on.
//
// Gated on first_session_benchmark_pending (profile.json), not on the wasProfileComplete
// transition alone (#727 retry fix). isAthleteProfileComplete (coachChatFiles.ts) is a
// field-presence check recomputed every turn from current profile/memory/seasons content, so it
// stays true forever once an athlete's profile is complete - a live-verified regression (#727
// review) found that gating on "profileComplete is true" alone made this fire, and commit a
// synthetic first week, on every single ordinary turn from any already-established athlete, since
// it has no reason to ever get the benchmark's id into its manifest otherwise. The pending marker
// (coachSinceStamp.ts's injectCoachSinceIfNeeded, set in the same merge patch as coach_since on
// the real false->true transition) is the durable version of that same one-shot signal: an
// already-established athlete never gets it set, so this still never fires for them, but a
// genuinely new signup whose first attempt threw stays pending and gets retried on the very next
// turn instead of being stuck forever. Cleared below only once a benchmark actually commits.
// ALSO gated on the benchmark's own routine id being absent from the manifest, not on the
// manifest merely existing - carve-skeleton now seeds a manifest with two starter templates at
// carve time (A4), so "does a manifest exist" was always true and this never ran for a freshly
// carved repo either (the original P0, #727 review).
export async function generateFirstSessionWorkoutsAfterCompletion(turn: TurnWrites): Promise<void> {
  const firstSessionTransition = !turn.wasProfileComplete && turn.profileComplete;
  const pendingFromEarlierAttempt = turn.context.profile?.first_session_benchmark_pending === true;
  if (!turn.profileComplete || (!firstSessionTransition && !pendingFromEarlierAttempt)) return;
  const attemptsSoFar = turn.context.profile?.first_session_benchmark_attempts ?? 0;
  if (attemptsSoFar >= FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS) {
    console.error(
      `[coach-chat] first session benchmark generation gave up after ${attemptsSoFar} failed` +
        " attempts - clearing pending instead of retrying again",
      { traceId: turn.traceId },
    );
    // Terminal give-up only — retry attempts already capture at B8 (`captureServerException`
    // below). One tagged message so triage can tell "permanently dead for this athlete" from
    // the three prior transient-looking failures.
    await captureServerMessage(
      `First session benchmark gave up after ${attemptsSoFar} failed attempts`,
      {
        level: "error",
        tags: {
          outcome: "gave_up",
          attempts: attemptsSoFar,
          ...(turn.traceId ? { vercel_trace_id: turn.traceId } : {}),
        },
      },
    );
    const write = await buildClearPendingWrite(turn);
    if (write) {
      await commitFilesAtomic(
        [write],
        "coach: give up on first session benchmark after repeated failures",
        { repo: turn.repo, branch: resolveCoachChatBranch(), token: turn.token },
      );
    }
    return;
  }
  try {
    const manifestContent = await getFileRaw(turn.repo, TEMPLATES_MANIFEST_PATH, turn.token);
    const existingRoutineIds = validTemplateIdsFromManifest(manifestContent);
    if (existingRoutineIds.has(BENCHMARK_ROUTINE_ID)) {
      // The benchmark already landed on some earlier turn, but pending is still true - the
      // profile write that was supposed to clear it alongside that commit must have dropped
      // (stale getFileRaw, a bad merge patch). Without this, every future turn would keep
      // re-fetching the manifest and bailing right here, never reaching the clear below.
      if (pendingFromEarlierAttempt) await clearFirstSessionBenchmarkPending(turn);
      return;
    }

    const memory = turn.projectedMemory;
    const injuries = turn.context.injuries ?? { flags: [] };
    const activeInjuryFlagIds = new Set(
      injuries.flags.filter((f) => f.status === "active").map((f) => f.id),
    );
    const progressions = turn.context.progressions ?? null;

    // Fix 1: repair the generated spec against the two invariants that depend on repo state
    // buildBenchmarkSpec doesn't see fresh at call time (dose vs. a since-updated progression,
    // an injury flag the caller knows about that the spec didn't). Fix 2: if a repaired spec
    // still somehow trips an invariant, fall back to one fixed bodyweight movement structurally
    // incapable of tripping any of them, so a benchmark + first week always commits.
    const generatedSpec = repairBenchmarkSpecForInvariants(
      buildBenchmarkSpec(memory, injuries),
      progressions,
      activeInjuryFlagIds,
    );
    let { writes: benchmarkWrites, dropped } = buildWorkoutCreateAndRemoveWrites(
      turn.traceId,
      generatedSpec,
      undefined,
      existingRoutineIds,
      activeInjuryFlagIds,
      progressions,
    );
    let spec = generatedSpec;
    if (dropped.length > 0 || benchmarkWrites.length === 0) {
      console.error(
        "[coach-chat] repaired first session benchmark spec still invalid - falling back:",
        dropped.map((d) => d.reason).join("; ") || "workout_create produced no writes",
        { traceId: turn.traceId },
      );
      const fallbackSpec = buildFallbackBenchmarkSpec(activeInjuryFlagIds);
      const fallbackResult = buildWorkoutCreateAndRemoveWrites(
        turn.traceId,
        fallbackSpec,
        undefined,
        existingRoutineIds,
        activeInjuryFlagIds,
        null,
      );
      if (fallbackResult.dropped.length > 0 || fallbackResult.writes.length === 0) {
        throw new Error(
          fallbackResult.dropped.map((d) => d.reason).join("; ") ||
            "fallback workout_create produced no writes",
        );
      }
      spec = fallbackSpec;
      benchmarkWrites = fallbackResult.writes;
    }
    const benchmarkRoutineId = benchmarkWrites[0].path
      .slice(TEMPLATES_PATH_PREFIX.length)
      .replace(/\.json$/, "");

    const nowIso = new Date().toISOString();
    const { content: progressionsContent } = seedBenchmarkProgressions(
      progressions,
      spec,
      nowIso,
      turn.traceId,
    );

    const trainingAvailability = inferTrainingAvailability(memory, [
      ...(turn.context.coachLog?.rows ?? []),
      ...(turn.trimmedCoachNote ? [{ text: turn.trimmedCoachNote }] : []),
    ]);
    const memoryWrite: FileEntry = {
      path: MEMORY_PATH,
      content: applyTrainingAvailabilityUpdate(
        JSON.stringify(memory),
        trainingAvailability,
        todayDateString(turn.timezone, new Date()),
        turn.traceId,
      ),
    };

    const weekUpdate = compileFirstWeek({
      today: turn.today,
      availability: trainingAvailability,
      benchmarkRoutineId,
      benchmarkTitle: spec.title,
      sports: memory.sports ?? [],
    });
    const weekContent = applyWeekUpdate(
      null,
      weekUpdate,
      new Set([benchmarkRoutineId]),
      turn.timezone,
      turn.traceId,
      new Date(),
    );

    const writes: FileEntry[] = [
      ...benchmarkWrites,
      { path: PROGRESSIONS_PATH, content: progressionsContent },
      memoryWrite,
      { path: CURRENT_WEEK_PATH, content: weekContent },
    ];

    // Clear first_session_benchmark_pending (and the attempt counter) in the same atomic commit
    // as the benchmark itself - the marker only exists to make a failed attempt retryable, so it
    // must come off exactly when (and only when) a benchmark actually lands, never before. Reading
    // fresh here (not turn.context.profile, loaded at the top of the turn) picks up the
    // pending:true this same turn's own commitTurn facts-commit may have just written on a real
    // transition turn.
    const clearPendingWrite = await buildClearPendingWrite(turn);
    if (clearPendingWrite) writes.push(clearPendingWrite);

    await commitFilesAtomic(writes, "coach: first session benchmark and first week", {
      repo: turn.repo,
      branch: resolveCoachChatBranch(),
      token: turn.token,
    });
    console.log("[coach-chat] first session benchmark and first week committed", {
      traceId: turn.traceId,
      benchmarkRoutineId,
      files: writes.length,
    });
  } catch (err) {
    console.error(
      "[coach-chat] first session benchmark generation failed - continuing without it:",
      err,
      {
        traceId: turn.traceId,
      },
    );
    // Once per failure cycle (not per inner attempt) — soft-continue without the benchmark, but
    // the operator still needs the signal (B8).
    await captureServerException(err);
    // Review finding (P1, #727 hardening): records the failed attempt so the cap check at the top
    // of this function can eventually give up instead of retrying forever - see
    // FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS. Its own failure (a bad read, a bad patch, a commit
    // error) only logs - this is already inside the outermost catch, so there's nothing further to
    // fall back to, and the athlete's turn must still complete either way.
    try {
      const freshProfileContent = await getFileRaw(turn.repo, PROFILE_PATH, turn.token);
      if (freshProfileContent) {
        const incremented = applyJsonMergePatch(
          freshProfileContent,
          JSON.stringify({ first_session_benchmark_attempts: attemptsSoFar + 1 }),
        );
        if (incremented.ok) {
          await commitFilesAtomic(
            [{ path: PROFILE_PATH, content: incremented.content }],
            "coach: record failed first session benchmark attempt",
            { repo: turn.repo, branch: resolveCoachChatBranch(), token: turn.token },
          );
        } else {
          console.warn(
            `[coach-chat] could not record failed first session benchmark attempt: ${incremented.error}`,
            { traceId: turn.traceId },
          );
        }
      }
    } catch (attemptErr) {
      console.error(
        "[coach-chat] could not record failed first session benchmark attempt:",
        attemptErr,
        { traceId: turn.traceId },
      );
    }
  }
}

// One commit path for every turn - it always writes the full set (data-fact fields per A1/B3,
// session-artifact fields alongside them) and always returns the same response shape.
//
// D1 layer 3 (#736): chat history commits independently of the structured-fact writes - what was
// said is never at risk from a bad structured field, they're unrelated data. Facts are attempted
// first (already pre-validated by buildTurnWrites - see droppedActions); a facts-commit failure
// is captured and folded into droppedActions rather than losing the athlete's message too. The
// chat commit is the one true risk point left: if that fails, the response carries Gemini's
// already-generated reply text alongside the error, instead of discarding it.
export async function commitTurn(turn: TurnWrites): Promise<Response> {
  const factWrites = [...turn.validUpdates, ...turn.optionalWrites];
  const commitFailureDrops: DroppedAction[] = [];
  if (factWrites.length > 0) {
    try {
      await commitFilesAtomic(
        factWrites,
        `coach: chat — ${turn.computedTitle || "session update"}`,
        {
          repo: turn.repo,
          branch: resolveCoachChatBranch(),
          token: turn.token,
        },
      );
      invalidateCoachContext(turn.repo);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[coach-chat] facts commitFilesAtomic failed:", err, {
        traceId: turn.traceId,
      });
      await captureValidationFailure(err, {
        traceId: turn.traceId,
        field: "facts_commit",
        reason: message,
      });
      for (const write of factWrites) {
        commitFailureDrops.push({
          field: write.path,
          reason: `save failed: ${message}`,
          kind: "commit_failure",
        });
      }
    }
  }

  // The facts commit above is where every write's resolve() runs, so any silent fixup an applier
  // recorded (unmatched skip_phases, nulled template_id, ...) is complete by now.
  await flushSilentFixups(turn.traceId);

  let repoSha: string;
  try {
    const result = await commitFilesAtomic([turn.chatWrite], "coach: chat message recorded", {
      repo: turn.repo,
      branch: resolveCoachChatBranch(),
      token: turn.token,
    });
    repoSha = result.commitSha;
    invalidateCoachContext(turn.repo);
    console.log(
      "[coach-chat] turn committed",
      JSON.stringify({
        traceId: turn.traceId,
        threadId: turn.finalThreadId,
        repo: turn.repo,
        committed: [...factWrites.map((write) => write.path), turn.chatWrite.path],
        // Two different counters, kept distinct on purpose (OpenRouter K1 retest finding): a
        // reader who sees a bare "droppedFacts: 0" here has no way to tell that from a turn that
        // actually dropped an action for a bad reference - droppedActionsValidation is what
        // counts that (buildTurnWrites' reference-validation drops), droppedFactsCommitFailures
        // is the late-write-failure count this function itself tracks.
        droppedFactsCommitFailures: commitFailureDrops.length,
        droppedActionsValidation: turn.droppedActions?.length ?? 0,
        ms: Date.now() - turn.now,
      }),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[coach-chat] chat commitFilesAtomic failed:", err, {
      traceId: turn.traceId,
    });
    // Response-built 502 — withSentryRoute only captures throws, so capture here (B1).
    await captureServerException(err);
    // Gemini already ran and was billed by this point regardless of whether the commit itself
    // succeeds - drop the usage header here too and a harness reading it sees $0 for a turn that
    // really cost money (review finding).
    return Response.json(
      {
        error: `Coach replied but saving failed: ${message}`,
        traceId: turn.traceId,
        reply: turn.finalReplyText,
      },
      usageResponseInit(turn.usage, { status: 502 }),
    );
  }

  await generateFirstSessionWorkoutsAfterCompletion(turn);
  return Response.json(
    {
      reply: turn.finalReplyText,
      threadId: turn.finalThreadId,
      threads: withComputedDayOffsets(pruneForResponse(turn.latestThreads), turn.timezone),
      repoSha,
      stale: turn.stale,
      profileComplete: turn.profileComplete,
      traceId: turn.traceId,
      droppedActions: [...(turn.droppedActions ?? []), ...commitFailureDrops],
    },
    usageResponseInit(turn.usage),
  );
}
