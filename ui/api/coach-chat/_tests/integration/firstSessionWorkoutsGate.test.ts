import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a live-verified bug (#727 review, manual OpenRouter test against a
// real athlete repo): generateFirstSessionWorkoutsAfterCompletion must never fire for an
// already-established athlete, only on the genuine false->true profileComplete transition.

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (_writes: { path: string; content?: string }[]) => ({
    commitSha: "commit-sha",
  })),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

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
    getFileRaw.mockClear();
    buildBenchmarkSpec.mockReset();
    buildBenchmarkSpec.mockImplementation(originalHolder.fn!);
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
