import { beforeEach, describe, expect, it, vi } from "vitest";

// #1105 track C3 / ADR 0049: the lazy same-turn rollover check. current_week.json's rollover
// otherwise only runs inside sync.user.yml, gated on the iOS app's own activity-sync push - an
// athlete who hasn't synced recently gets no rollover at all. buildTurnWrites checks
// needsRollover (engine/lib/currentWeekRollover.mts, #1105 track C1) on every turn and folds a
// fresh placeholder into that turn's own write set on the real transition turn, the same
// injectCoachSinceIfNeeded pattern coach_since already uses (ADR 0018).

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));
vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));

const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async (_repo: string, _path: string) => null as string | null),
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
    trimmed: "Done for today",
    geminiMessage: "Done for today",
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
    now: new Date("2026-09-16T12:00:00.000Z").getTime(),
    today: "2026-09-16",
    traceId: "trace-1",
    validQuestIds: new Set<string>(),
    validInjuryFlagIds: new Set<string>(),
    activeInjuryFlagIds: new Set<string>(),
    reply: { reply: "Good work." },
    finalReplyText: "Good work.",
    ...overrides,
  };
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A full, schema-valid seven-day week starting on the given Monday (parseCurrentWeek rejects
// anything short of exactly seven consecutive days) - "live" requires a real coach_read too.
function fullWeek(weekId: string, mondayStart: string, dataStatus: "live" | "placeholder") {
  const endDate = addDays(mondayStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: addDays(mondayStart, i),
    intent: null,
    coach_note: null,
    sessions: [],
  }));
  return JSON.stringify({
    schema_version: 1,
    data_status: dataStatus,
    timezone: "UTC",
    week: { id: weekId, start_date: mondayStart, end_date: endDate, focus: null, guardrails: [] },
    coach_read:
      dataStatus === "live"
        ? {
            headline: "Steady week.",
            body: "Keep the volume honest.",
            valid_from: mondayStart,
            valid_until: endDate,
          }
        : null,
    days,
    updated_at: `${mondayStart}T00:00:00.000Z`,
    updated_by: dataStatus === "live" ? "model" : "rollover",
    trace_id: "seed",
  });
}

function rolloverWriteFrom(turn: { optionalWrites: { path: string; content?: string }[] }) {
  return turn.optionalWrites.find((write) => write.path === "user_data/ledger/current_week.json");
}

describe("lazy same-turn week rollover (#1105 track C3, ADR 0049)", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    getFileRaw.mockClear();
    getFileRaw.mockImplementation(async () => null);
  });

  it("does not roll over a week that is still current", async () => {
    // Week runs 2026-09-14 (Mon) through 2026-09-20 (Sun); "today" (2026-09-16) is squarely
    // inside it.
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.includes("current_week") ? fullWeek("2026-W38", "2026-09-14", "live") : null,
    );

    const turn = await buildTurnWrites(baseTurn() as never);

    expect(rolloverWriteFrom(turn)).toBeUndefined();
  });

  it("does not roll over a week exactly at its end_date (today falls on end_date, not past it)", async () => {
    // A live week is available through end_date's one-day grace period too (current-week.mts's
    // getAvailability), so a live week's real boundary sits one day past end_date, not on it.
    // Uses a placeholder week instead, whose own staleness rule (needsRollover) is a direct
    // todayDateStr > end_date comparison with no grace period - today equal to end_date is the
    // real boundary for that rule, and this fixture's week ends exactly today.
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.includes("current_week") ? fullWeek("2026-W37", "2026-09-07", "placeholder") : null,
    );

    // Week 2026-W37 (2026-09-07 through 2026-09-13) would already be stale by 2026-09-16 - use a
    // matching "today" that lands exactly on this fixture's own end_date instead.
    const turn = await buildTurnWrites(baseTurn({ today: "2026-09-13" }) as never);

    expect(rolloverWriteFrom(turn)).toBeUndefined();
  });

  it("rolls over a week several weeks stale", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.includes("current_week") ? fullWeek("2026-W34", "2026-08-17", "live") : null,
    );

    const turn = await buildTurnWrites(baseTurn({ today: "2026-09-16" }) as never);

    const write = rolloverWriteFrom(turn);
    expect(write).toBeDefined();
    const content = JSON.parse((write as { content: string }).content);
    expect(content.data_status).toBe("placeholder");
    // Monday on or before 2026-09-16 (a Wednesday).
    expect(content.week.start_date).toBe("2026-09-14");
    expect(content.week.end_date).toBe("2026-09-20");
    expect(content.days).toHaveLength(7);
    expect(content.days.every((day: { sessions: unknown[] }) => day.sessions.length === 0)).toBe(
      true,
    );
  });

  it("no-ops on malformed/unparseable current_week.json rather than throwing", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.includes("current_week") ? "{not valid json" : null,
    );

    const turn = await buildTurnWrites(baseTurn({ today: "2026-09-16" }) as never);

    expect(rolloverWriteFrom(turn)).toBeUndefined();
  });

  it("skips the rollover write when this turn's own week_update already writes current_week.json", async () => {
    // A stale week AND a real week_update kickoff land in the same turn - the athlete's own
    // intent has to win, and commitFilesAtomic does not merge two writes to the same path.
    getFileRaw.mockImplementation(async (_repo: string, path: string) => {
      if (path.includes("current_week")) return fullWeek("2026-W34", "2026-08-17", "live");
      if (path.endsWith("_manifest.json")) return JSON.stringify({ template_ids: [] });
      return null;
    });

    const kickoffDays = [
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ].map((date) => ({ date, sessions: [] as never[] }));

    const turn = await buildTurnWrites(
      baseTurn({
        today: "2026-09-16",
        reply: {
          reply: "Started your new week.",
          week_update: {
            headline: "Fresh week",
            body: "Let's get moving.",
            days: kickoffDays,
          },
        },
      }) as never,
    );

    const writes = turn.optionalWrites.filter(
      (write) => write.path === "user_data/ledger/current_week.json",
    );
    // Exactly one write to current_week.json - the athlete's own week_update kickoff, not a
    // second rollover write layered on top of it.
    expect(writes).toHaveLength(1);
    const content = JSON.parse((writes[0] as { content: string }).content);
    expect(content.coach_read.headline).toBe("Fresh week");
  });
});
