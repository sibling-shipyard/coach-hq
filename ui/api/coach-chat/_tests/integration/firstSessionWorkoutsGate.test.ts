import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a live-verified bug (#727 review, manual OpenRouter test against a
// real athlete repo): generateFirstSessionWorkoutsAfterCompletion must never fire for an
// already-established athlete, only on the genuine false->true profileComplete transition.

const { commitFilesAtomic, captureServerException, captureServerMessage } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (_writes: { path: string; content?: string }[]) => ({
    commitSha: "commit-sha",
  })),
  captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
  captureServerMessage: vi.fn(async (_message: string, _options?: unknown) => ({ sent: true })),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
vi.mock("../../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../_lib/sentry.js")>();
  return { ...original, captureServerException, captureServerMessage };
});

// A manifest that does NOT list the benchmark id - the exact real-world state of every
// established athlete repo, since the benchmark concept never touched them. PROFILE_PATH
// resolves to null by default (baseTurn's inline context.profile is what the gate itself reads -
// this mock only feeds the manifest lookup and the post-commit pending-marker clear read).
const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async (_repo: string, path: string) =>
    path.endsWith("_manifest.json")
      ? JSON.stringify({ template_ids: ["foundation", "strength_a"] })
      : null,
  ),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw };
});

// Captured from importOriginal, not re-imported through the mocked path below - importing
// buildBenchmarkSpec "normally" from this same module would resolve to the mock itself, and
// mockImplementation(itself) recurses until the stack blows. Boxed in an object (not a bare
// `let`) so the vi.mock factory below - hoisted above this file's own top-level statements - can
// still close over it without a temporal-dead-zone error.
const { buildBenchmarkSpec, originalHolder } = vi.hoisted(() => ({
  buildBenchmarkSpec: vi.fn(),
  originalHolder: {} as { fn?: (...args: unknown[]) => unknown },
}));
vi.mock("../../_lib/decide/coachFirstSessionBenchmark.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../_lib/decide/coachFirstSessionBenchmark.js")>();
  originalHolder.fn = original.buildBenchmarkSpec as (...args: unknown[]) => unknown;
  return { ...original, buildBenchmarkSpec };
});

import { generateFirstSessionWorkoutsAfterCompletion } from "../../_lib/coachTurn.js";
import { loadExerciseCatalog } from "../../_lib/decide/coachFirstSessionBenchmark.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    repo: "owner/repo",
    token: "token",
    traceId: "trace-1",
    timezone: "UTC",
    today: "2026-09-12",
    context: { injuries: { flags: [] }, progressions: null },
    projectedMemory: {
      version: 1,
      _meta: { updated_at: "t", updated_by: "model", trace_id: "t1" },
      sports: ["Badminton"],
      coaching_style: "accountability",
      training_availability: null,
      notes: {
        fitness_baseline: { text: "", updated_at: "", trace_id: "" },
        coaching_priorities: { text: "", updated_at: "", trace_id: "" },
        "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
        "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
        "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
        equipment: { text: "", updated_at: "", trace_id: "" },
      },
    },
    wasProfileComplete: true,
    profileComplete: true,
    ...overrides,
  };
}

describe("generateFirstSessionWorkoutsAfterCompletion gate", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    captureServerException.mockClear();
    captureServerMessage.mockClear();
    getFileRaw.mockClear();
    buildBenchmarkSpec.mockReset();
    buildBenchmarkSpec.mockImplementation(originalHolder.fn!);
    // baseTurn's today ("2026-09-12") only agrees with reality on the day this test happens to
    // run. generateFirstSessionWorkoutsAfterCompletion calls real `new Date()` internally
    // (applyFullWeekKickoff's coach_read.valid_from) independently of turn.today, which
    // compileFirstWeek uses for the compiled week's own end_date - the two silently drift apart
    // as real time passes, eventually inverting valid_from > valid_until and throwing. Pin the
    // system clock to the fixture's own date so this test's outcome doesn't depend on when it's
    // run.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("regression: never fires for an already-established athlete, even with no benchmark id in the manifest", async () => {
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: true, profileComplete: true }) as never,
    );
    expect(commitFilesAtomic).not.toHaveBeenCalled();
    // Short-circuits on the wasProfileComplete check itself - never even reads the manifest.
    expect(getFileRaw).not.toHaveBeenCalled();
  });

  it("fires on the real false->true transition when the benchmark hasn't been written yet", async () => {
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: false, profileComplete: true }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
  });

  it("does nothing when profile isn't complete yet", async () => {
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: false, profileComplete: false }) as never,
    );
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  // #727 retry fix, fix 3: a prior turn's attempt threw (so first_session_benchmark_pending
  // stayed true) and the athlete has since sent another message - wasProfileComplete is now
  // true too (it's monotonic), so the old gate would never fire again. The marker on
  // turn.context.profile is what makes this retryable.
  it("retries on a later turn when first_session_benchmark_pending is still true, even though wasProfileComplete is also true by then", async () => {
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({
        wasProfileComplete: true,
        profileComplete: true,
        context: {
          injuries: { flags: [] },
          progressions: null,
          profile: { first_session_benchmark_pending: true },
        },
      }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
  });

  // P1 fix (#727 review): the benchmark already landed on some earlier turn (it's in the
  // manifest) but pending never got cleared - the profile write that should have cleared it
  // alongside that commit must have dropped. Without this, every future turn would keep
  // re-fetching the manifest and bailing at the existingRoutineIds check, never reaching a clear.
  it("clears a stale pending marker via its own commit when the benchmark is already in the manifest", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path.endsWith("_manifest.json")) {
        return JSON.stringify({ template_ids: ["foundation", "first_session_benchmark"] });
      }
      if (path.endsWith("profile.json")) {
        return JSON.stringify({ version: 1, name: "A", first_session_benchmark_pending: true });
      }
      return null;
    });
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({
        wasProfileComplete: true,
        profileComplete: true,
        context: {
          injuries: { flags: [] },
          progressions: null,
          profile: { first_session_benchmark_pending: true },
        },
      }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    const writes = commitFilesAtomic.mock.calls[0][0];
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].content!).first_session_benchmark_pending).toBe(false);
  });

  it("does nothing at all when the benchmark is already in the manifest and pending is already clear", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.endsWith("_manifest.json")
        ? JSON.stringify({ template_ids: ["foundation", "first_session_benchmark"] })
        : null,
    );
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: false, profileComplete: true }) as never,
    );
    expect(commitFilesAtomic).not.toHaveBeenCalled();
  });

  it("clears first_session_benchmark_pending in the same commit once the benchmark actually lands", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path.endsWith("_manifest.json")) {
        return JSON.stringify({ template_ids: ["foundation", "strength_a"] });
      }
      if (path.endsWith("profile.json")) {
        return JSON.stringify({ version: 1, name: "A", first_session_benchmark_pending: true });
      }
      return null;
    });
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: false, profileComplete: true }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    const writes = commitFilesAtomic.mock.calls[0][0];
    const profileWrite = writes.find((w) => w.path.endsWith("profile.json"));
    expect(profileWrite).toBeDefined();
    expect(JSON.parse(profileWrite!.content!).first_session_benchmark_pending).toBe(false);
  });

  // Fix 1: a generated spec whose dose would exceed a since-updated progression's real current
  // (the retry scenario fix 1's comment describes - the athlete did other real workout_create
  // turns using the same catalog progression id before this retry ran) gets clamped, not thrown.
  it("repairs a generated spec that would have tripped invariant 2, still committing a benchmark", async () => {
    // The same accessibility-cost-first, id-tiebreak pick buildBenchmarkSpec's pickPrimary makes
    // for the "push" pattern with no injury filter and nothing excluded (#727 review: equipment
    // cost, not raw item count, since a one-item ["full_gym"] shouldn't tie a one-item
    // ["bodyweight"]) - reproduced here rather than assuming which catalog entry gets chosen, so
    // this doesn't silently stop testing anything if the catalog data changes.
    const EQUIPMENT_COST: Record<string, number> = {
      bodyweight: 0,
      resistance_band: 1,
      dumbbells: 2,
      bench: 2,
      pull_up_bar: 2,
      full_gym: 3,
    };
    const equipmentCost = (equipment: string[]) =>
      equipment.length === 0 ? 0 : Math.max(...equipment.map((item) => EQUIPMENT_COST[item] ?? 3));
    const catalog = loadExerciseCatalog();
    const pushEntry = catalog
      .filter((e) => e.movement_pattern === "push")
      .sort(
        (a, b) =>
          equipmentCost(a.equipment) - equipmentCost(b.equipment) || a.id.localeCompare(b.id),
      )[0]!;
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({
        wasProfileComplete: false,
        profileComplete: true,
        context: {
          injuries: { flags: [] },
          progressions: {
            version: 1,
            _meta: { updated_at: "t", updated_by: "model", trace_id: "t1" },
            progressions: [
              {
                id: pushEntry.progression_id!,
                name: pushEntry.name,
                current: "1 (already benchmarked)",
                target: "",
                unit: null,
                history: [],
              },
            ],
          },
        },
      }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    const writes = commitFilesAtomic.mock.calls[0][0];
    const routineWrite = writes.find(
      (w) => w.path.includes("templates/") && !w.path.endsWith("_manifest.json"),
    );
    const compiled = JSON.parse(routineWrite!.content!);
    const compiledPush = compiled.phases
      .flatMap((p: { exercises: { name: string; reps?: number; sets: number }[] }) => p.exercises)
      .find((ex: { name: string }) => ex.name === pushEntry.name);
    expect(compiledPush.reps * compiledPush.sets).toBeLessThanOrEqual(1);
  });

  // Review finding (P1, #727 hardening): without a cap, a real failure unrelated to spec
  // validity (a commit error, a transient GitHub API failure) left first_session_benchmark_pending
  // stuck true forever - every future turn re-ran the full generation attempt with no backoff.
  describe("attempt cap (P1, #727 hardening)", () => {
    it("gives up after the max attempt cap instead of attempting generation again", async () => {
      getFileRaw.mockImplementation(async (_repo: string, path: string) =>
        path.endsWith("profile.json")
          ? JSON.stringify({
              version: 1,
              name: "A",
              first_session_benchmark_pending: true,
              first_session_benchmark_attempts: 3,
            })
          : null,
      );
      await generateFirstSessionWorkoutsAfterCompletion(
        baseTurn({
          wasProfileComplete: true,
          profileComplete: true,
          context: {
            injuries: { flags: [] },
            progressions: null,
            profile: { first_session_benchmark_pending: true, first_session_benchmark_attempts: 3 },
          },
        }) as never,
      );
      // Gives up via its own commit - never reaches the manifest read a real generation
      // attempt would need, so no such attempt happened.
      expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
      expect(getFileRaw).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("_manifest.json"),
        expect.anything(),
      );
      expect(captureServerMessage).toHaveBeenCalledTimes(1);
      expect(captureServerMessage).toHaveBeenCalledWith(
        expect.stringContaining("gave up after 3 failed attempts"),
        expect.objectContaining({
          level: "error",
          tags: expect.objectContaining({ outcome: "gave_up", attempts: 3 }),
        }),
      );
      const writes = commitFilesAtomic.mock.calls[0][0];
      const parsed = JSON.parse(writes[0].content!);
      expect(parsed.first_session_benchmark_pending).toBe(false);
      expect(parsed.first_session_benchmark_attempts).toBe(0);
    });

    it("still attempts generation below the cap", async () => {
      getFileRaw.mockImplementation(async (_repo: string, path: string) =>
        path.endsWith("profile.json")
          ? JSON.stringify({
              version: 1,
              name: "A",
              first_session_benchmark_pending: true,
              first_session_benchmark_attempts: 2,
            })
          : path.endsWith("_manifest.json")
            ? JSON.stringify({ template_ids: ["foundation", "strength_a"] })
            : null,
      );
      await generateFirstSessionWorkoutsAfterCompletion(
        baseTurn({
          wasProfileComplete: true,
          profileComplete: true,
          context: {
            injuries: { flags: [] },
            progressions: null,
            profile: { first_session_benchmark_pending: true, first_session_benchmark_attempts: 2 },
          },
        }) as never,
      );
      expect(getFileRaw).toHaveBeenCalledWith(
        "owner/repo",
        expect.stringContaining("_manifest.json"),
        "token",
      );
      expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    });

    it("records a failed attempt when the whole generation throws, without giving up on this one turn", async () => {
      commitFilesAtomic.mockRejectedValueOnce(new Error("network blip"));
      getFileRaw.mockImplementation(async (_repo: string, path: string) =>
        path.endsWith("profile.json")
          ? JSON.stringify({ version: 1, name: "A" })
          : path.endsWith("_manifest.json")
            ? JSON.stringify({ template_ids: ["foundation", "strength_a"] })
            : null,
      );
      await generateFirstSessionWorkoutsAfterCompletion(
        baseTurn({ wasProfileComplete: false, profileComplete: true }) as never,
      );
      // First call is the (rejected) main benchmark commit, second call records the failure.
      expect(commitFilesAtomic).toHaveBeenCalledTimes(2);
      const attemptWrite = commitFilesAtomic.mock.calls[1][0];
      expect(JSON.parse(attemptWrite[0].content!).first_session_benchmark_attempts).toBe(1);
      expect(captureServerException).toHaveBeenCalledTimes(1);
      expect((captureServerException.mock.calls[0][0] as Error).message).toBe("network blip");
    });
  });

  // Fix 2: a spec repair can't rescue (compileWorkout/validateWorkout structurally reject it, not
  // one of the four invariants repair targets) still lands a benchmark, via the fixed fallback.
  it("falls back to the fixed bodyweight benchmark when the generated spec is unrecoverable", async () => {
    buildBenchmarkSpec.mockReturnValue({
      title: "First session benchmark",
      workout_type: "foundation",
      phases: [], // structurally invalid - compileWorkout has nothing to build a routine from
    });
    await generateFirstSessionWorkoutsAfterCompletion(
      baseTurn({ wasProfileComplete: false, profileComplete: true }) as never,
    );
    expect(commitFilesAtomic).toHaveBeenCalledTimes(1);
    const writes = commitFilesAtomic.mock.calls[0][0];
    const routineWrite = writes.find(
      (w) => w.path.includes("templates/") && !w.path.endsWith("_manifest.json"),
    );
    const compiled = JSON.parse(routineWrite!.content!);
    expect(compiled.phases.flatMap((p: { exercises: { name: string }[] }) => p.exercises)).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Bodyweight squat" })]),
    );
  });
});
