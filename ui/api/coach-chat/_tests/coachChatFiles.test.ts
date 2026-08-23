import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ATHLETE_INSIGHTS_PATH, invalidateCoachContext, isAthleteProfileComplete, isFirstSessionRitualDone, loadCoachContext } from "../_lib/coachChatFiles.js";
import type { ProfileJson, MemoryJson } from "../_lib/coachMemoryFiles.js";
import type { QuestsJson, SeasonsJson } from "../_lib/coachQuestFiles.js";

// coach-redesign-part1-memory.md, Step 3: replaces the old regex/section-matching read of
// state.md's Athlete Profile with a simple field-presence check against profile.json/memory.json,
// matching #362's reduced REQUIRED_PROFILE_FIELDS set - just spread across two files now instead
// of one section. Issue #408 dropped `goal` from memory.json entirely, so this gate is now
// name/sport only (see coachChatFiles.ts's isAthleteProfileComplete).
function profile(overrides: Partial<ProfileJson> = {}): ProfileJson {
  return {
    version: 1,
    coach_since: null,
    name: "Skanda",
    dob: "2003-01-02",
    timezone: "Asia/Kolkata",
    height_cm: 180,
    weight_kg: 75,
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryJson> = {}): MemoryJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    sports: ["Badminton"],
    notes: {
      fitness_baseline: { text: "", updated_at: "", trace_id: "" },
      coaching_priorities: { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "", updated_at: "", trace_id: "" },
    },
    ...overrides,
  };
}

function seasons(overrides: Partial<SeasonsJson> = {}): SeasonsJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    current_season_id: "season-1",
    seasons: [{ id: "season-1", name: "Build", start_date: "2026-08-18", end_date: "2026-12-01", status: "active" }],
    ...overrides,
  };
}

describe("isAthleteProfileComplete", () => {
  it("is true when profile, sport, and current season are complete", () => {
    expect(isAthleteProfileComplete(profile(), memory(), seasons())).toBe(true);
  });

  it("is false when profile.json is missing (null)", () => {
    expect(isAthleteProfileComplete(null, memory(), seasons())).toBe(false);
  });

  it("is false when memory.json is missing (null)", () => {
    expect(isAthleteProfileComplete(profile(), null, seasons())).toBe(false);
  });

  it("is false when seasons.json is missing (null)", () => {
    expect(isAthleteProfileComplete(profile(), memory(), null)).toBe(false);
  });

  it("is false when name is blank", () => {
    expect(isAthleteProfileComplete(profile({ name: "" }), memory(), seasons())).toBe(false);
  });

  it.each([
    ["dob", { dob: null }],
    ["timezone", { timezone: "" }],
    ["height", { height_cm: null }],
    ["weight", { weight_kg: null }],
  ])("is false when %s is missing", (_label, missing) => {
    expect(isAthleteProfileComplete(profile(missing), memory(), seasons())).toBe(false);
  });

  it("is false when sports is empty", () => {
    expect(isAthleteProfileComplete(profile(), memory({ sports: [] }), seasons())).toBe(false);
  });

  it("is false when sports only contains blank strings", () => {
    expect(isAthleteProfileComplete(profile(), memory({ sports: ["", "  "] }), seasons())).toBe(false);
  });

  it("is false when current_season_id is unset", () => {
    expect(isAthleteProfileComplete(profile(), memory(), seasons({ current_season_id: null }))).toBe(false);
  });

  it("is false when current_season_id does not match a season", () => {
    expect(isAthleteProfileComplete(profile(), memory(), seasons({ current_season_id: "missing" }))).toBe(false);
  });
});

// Live testing found a real bug: isAthleteProfileComplete flips true (unlocking daily chat) the
// moment profile/sports/season land, which is also what firstSessionContext() used to gate
// on directly - so an athlete who mentioned habit quests on the SAME turn that completed their
// profile got no FSP prompt guidance for it at all, and quest_create silently never fired.
// isFirstSessionRitualDone adds the one more thing SOUL's own ritual still wants before FSP is
// truly over: a main_quest. It resolves to true forever once set, same as the other fields, so a
// quest-declining athlete only sees it once, not indefinitely.
function quests(overrides: Partial<QuestsJson> = {}): QuestsJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    weekly_targets: {},
    main_quest: { id: "q1", name: "Get faster", type: "progress", target: 100 },
    quests: [],
    ...overrides,
  };
}

describe("isFirstSessionRitualDone", () => {
  it("is true once profile is complete and a main_quest exists", () => {
    expect(isFirstSessionRitualDone(profile(), memory(), seasons(), quests())).toBe(true);
  });

  it("is false when quests.json doesn't exist yet, even if profile is otherwise complete", () => {
    expect(isFirstSessionRitualDone(profile(), memory(), seasons(), null)).toBe(false);
  });

  it("is false when profile isn't complete yet, regardless of quests", () => {
    expect(isFirstSessionRitualDone(profile({ name: "" }), memory(), seasons(), quests())).toBe(false);
  });
});

// Audit fix: concurrent cache-miss callers for the same repo used to each independently hit
// GitHub for the same files - now they share one in-flight fetch.
describe("loadCoachContext in-flight de-dup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("content", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one round-trip across concurrent cache-miss calls for the same repo", async () => {
    const repo = `owner/repo-concurrent-${Date.now()}`; // unique per test - module cache persists across tests
    const [a, b] = await Promise.all([
      loadCoachContext(repo, "token"),
      loadCoachContext(repo, "token"),
    ]);
    expect(a).toEqual(b);
    // 9 files (profile.json, memory.json, injuries.json, coach_log.json, seasons.json,
    // quests.json, progress.json, progressions.json, athlete_insights.json) fetched once -
    // SOUL.md no longer comes from the athlete's repo at all (bundled from platform/SOUL.md, see
    // build-soul.mjs), and state.md/rolling_state.json/challenge_v2.json/the precomputed quest artifact are all
    // gone (coach-redesign-part1-memory.md, coach-redesign-part2-ledger.md; the dead quest-artifact fetch
    // was dead weight found in review - renderQuestContext never read it).
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("a fresh:true call never shares the in-flight de-dup, even if one is already pending", async () => {
    const repo = `owner/repo-fresh-${Date.now()}`;
    const [cached, fresh] = await Promise.all([
      loadCoachContext(repo, "token"),
      loadCoachContext(repo, "token", { fresh: true }),
    ]);
    expect(cached).toEqual(fresh);
    // Each call does its own independent 9-file fetch since one of them demanded freshness.
    expect(fetchMock).toHaveBeenCalledTimes(18);
  });

  it("refetches every context file after the repo cache is invalidated", async () => {
    const repo = `owner/repo-invalidated-${Date.now()}`;
    await loadCoachContext(repo, "token");
    await loadCoachContext(repo, "token");
    expect(fetchMock).toHaveBeenCalledTimes(9);

    invalidateCoachContext(repo);
    await loadCoachContext(repo, "token");
    expect(fetchMock).toHaveBeenCalledTimes(18);
  });

  it.each([["absent", null], ["malformed", "{not-json"]])(
    "degrades to no athlete insights when the file is %s",
    async (caseName, raw) => {
      const repo = `owner/repo-insights-${caseName}-${Date.now()}`;
      fetchMock.mockImplementation(async (input: string | URL | Request) => {
        if (String(input).includes(ATHLETE_INSIGHTS_PATH)) {
          return raw == null ? new Response(null, { status: 404 }) : new Response(raw, { status: 200 });
        }
        return new Response("content", { status: 200 });
      });
      await expect(loadCoachContext(repo, "token")).resolves.toMatchObject({ athleteInsights: null });
      expect(fetchMock).toHaveBeenCalledTimes(9);
    },
  );
});
