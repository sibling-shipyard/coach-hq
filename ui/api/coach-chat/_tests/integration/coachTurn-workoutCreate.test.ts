import { beforeEach, describe, expect, it, vi } from "vitest";

// Same harness shape as coachTurn.test.ts's own top-of-file mocks - a separate file gets its own
// isolated module registry in vitest, so this can't just import that file's mocks.
const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

// The manifest already lists one routine (existing_routine) so a workout_create can exercise the
// no-collision path and a workout_remove can exercise deleting a real entry.
const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async (_repo: string, path: string) =>
    path.endsWith("_manifest.json") ? JSON.stringify({ template_ids: ["existing_routine"] }) : null,
  ),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw, invalidateCoachContext: vi.fn() };
});
vi.mock("../../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/chatThreads.js")>();
  return { ...original, loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })) };
});

import { buildTurnWrites } from "../../_lib/coachTurn.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "Give me an upper body workout",
    geminiMessage: "Give me an upper body workout",
    repo: "owner/repo",
    token: "token",
    apiKey: "key",
    currentSha: "old-sha",
    stale: false,
    context: {
      soul: "soul",
      profile: null,
      memory: null,
      injuries: null,
      coachLog: null,
      seasons: null,
      quests: null,
      progress: null,
      progressions: null,
      athleteInsights: null,
    },
    timezone: "UTC",
    athleteContext: "",
    questContext: "",
    firstSession: false,
    now: Date.now(),
    traceId: "trace-1",
    validQuestIds: new Set<string>(),
    validInjuryFlagIds: new Set<string>(),
    activeInjuryFlagIds: new Set<string>(),
    reply: { reply: "Good work." },
    finalReplyText: "Good work.",
    ...overrides,
  };
}

// A2 (#727): "A returning athlete still commits correctly, the case that used to silently
// no-op" - before this PR there was no workout_create/workout_remove field in the schema at all,
// so a mid-conversation ask for a new routine had nowhere to land. These confirm buildTurnWrites
// actually produces both writes, in the same commit as everything else the turn produces.
describe("coach turn stages - workout_create/workout_remove (A2)", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    getFileRaw.mockClear();
  });

  it("commits a workout_create on an ordinary turn, alongside the manifest update", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Here's an upper body session.",
          workout_create: {
            title: "Upper Body Pump",
            workout_type: "strength",
            phases: [
              {
                name: "Main",
                exercises: [
                  {
                    name: "Dumbbell row",
                    type: "reps",
                    reps: 10,
                    sets: 3,
                    form_cue: "Squeeze the shoulder blade.",
                    why: "Back strength.",
                  },
                ],
              },
            ],
          },
        },
      }) as never,
    );

    expect(turn.droppedActions).toEqual([]);
    expect(turn.optionalWrites.map((write) => write.path)).toEqual(
      expect.arrayContaining([
        "user_data/activities/workout_plans/templates/upper_body_pump.json",
        "user_data/activities/workout_plans/templates/_manifest.json",
      ]),
    );
    const manifestWrite = turn.optionalWrites.find((write) =>
      write.path.endsWith("_manifest.json"),
    );
    const manifestContent = await (
      manifestWrite as { resolve?: () => Promise<string> }
    ).resolve?.();
    // Static FileWrite, not resolved - content is just there directly.
    const content = manifestContent ?? (manifestWrite as unknown as { content: string }).content;
    expect(JSON.parse(content).template_ids).toEqual(["existing_routine", "upper_body_pump"]);
  });

  it("commits a workout_remove on an ordinary turn, deleting the file and the manifest entry", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Removed it.",
          workout_remove: { routine_id: "existing_routine" },
        },
      }) as never,
    );

    expect(turn.droppedActions).toEqual([]);
    const deleteEntry = turn.optionalWrites.find(
      (write) =>
        write.path === "user_data/activities/workout_plans/templates/existing_routine.json",
    );
    expect(deleteEntry).toEqual({
      path: "user_data/activities/workout_plans/templates/existing_routine.json",
      delete: true,
    });
    const manifestWrite = turn.optionalWrites.find((write) =>
      write.path.endsWith("_manifest.json"),
    ) as unknown as { content: string };
    expect(JSON.parse(manifestWrite.content).template_ids).toEqual([]);
  });

  it("drops workout_remove as a dropped action, not a thrown error, for an unknown routine_id", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Trying to remove that.",
          workout_remove: { routine_id: "ghost_routine" },
        },
      }) as never,
    );
    expect(turn.droppedActions).toEqual([expect.objectContaining({ field: "workout_remove" })]);
    expect(turn.optionalWrites.some((write) => write.path.includes("ghost_routine"))).toBe(false);
  });
});
