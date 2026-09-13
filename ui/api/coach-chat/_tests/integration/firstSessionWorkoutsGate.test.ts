import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a live-verified bug (#727 review, manual OpenRouter test against a
// real athlete repo): generateFirstSessionWorkoutsAfterCompletion must never fire for an
// already-established athlete, only on the genuine false->true profileComplete transition.

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async () => ({ commitSha: "commit-sha" })),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

// A manifest that does NOT list the benchmark id - the exact real-world state of every
// established athlete repo, since the benchmark concept never touched them.
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

import { generateFirstSessionWorkoutsAfterCompletion } from "../../_lib/coachTurn.js";

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
});
