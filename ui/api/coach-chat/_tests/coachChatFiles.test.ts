import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAthleteProfileComplete, loadCoachContext } from "../_lib/coachChatFiles.js";
import type { ProfileJson, MemoryJson } from "../_lib/coachMemoryFiles.js";

// coach-redesign-part1-memory.md, Step 3: replaces the old regex/section-matching read of
// state.md's Athlete Profile with a simple field-presence check against profile.json/memory.json,
// matching #362's reduced REQUIRED_PROFILE_FIELDS set exactly (name/sport/goal) - just spread
// across two files now instead of one section.
function profile(overrides: Partial<ProfileJson> = {}): ProfileJson {
  return {
    version: 1,
    coach_since: null,
    name: "Skanda",
    dob: null,
    timezone: "Asia/Kolkata",
    height_cm: null,
    weight_kg: null,
    ...overrides,
  };
}

function memory(overrides: Partial<MemoryJson> = {}): MemoryJson {
  return {
    version: 1,
    _meta: { updated_at: "2026-08-18", updated_by: "model", trace_id: "t1" },
    sports: ["Badminton"],
    goal: "Get back to competitive shape",
    timeline: "",
    coaching_style: "",
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

describe("isAthleteProfileComplete", () => {
  it("is true when name/sport/goal are all present", () => {
    expect(isAthleteProfileComplete(profile(), memory())).toBe(true);
  });

  it("is false when profile.json is missing (null)", () => {
    expect(isAthleteProfileComplete(null, memory())).toBe(false);
  });

  it("is false when memory.json is missing (null)", () => {
    expect(isAthleteProfileComplete(profile(), null)).toBe(false);
  });

  it("is false when name is blank", () => {
    expect(isAthleteProfileComplete(profile({ name: "" }), memory())).toBe(false);
  });

  it("is false when sports is empty", () => {
    expect(isAthleteProfileComplete(profile(), memory({ sports: [] }))).toBe(false);
  });

  it("is false when sports only contains blank strings", () => {
    expect(isAthleteProfileComplete(profile(), memory({ sports: ["", "  "] }))).toBe(false);
  });

  it("is false when goal is blank", () => {
    expect(isAthleteProfileComplete(profile(), memory({ goal: "" }))).toBe(false);
  });

  // #362: dob/height_cm/weight_kg/timeline/coaching_style are context the athlete may decline -
  // never gate on them, same rule as before the redesign, just checked against the new files.
  it("is true even when every optional field is declined", () => {
    const p = profile({ dob: null, height_cm: null, weight_kg: null });
    const m = memory({ timeline: "", coaching_style: "" });
    expect(isAthleteProfileComplete(p, m)).toBe(true);
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
    // 9 files (quest_log.md, profile.json, memory.json, injuries.json, coach_log.json,
    // seasons.json, quests.json, progress.json, progressions.json) fetched once, not once per
    // caller - SOUL.md no longer comes from the athlete's repo at all (bundled from
    // platform/SOUL.md, see build-soul.mjs), and state.md/rolling_state.json/challenge_v2.json
    // are gone (coach-redesign-part1-memory.md, coach-redesign-part2-ledger.md).
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
});
