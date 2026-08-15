import { describe, it, expect } from "vitest";
import { coachDayNumber } from "../coach-chat/_lib/coachDay.js";
import { injectCoachSinceIfNeeded } from "../coach-chat/_lib/coachWrites.js";

// ADR 0018: coach_since is a durable, write-once day-number anchor. These tests cover the two
// pure pieces - the fallback chain that resolves "day N" for a commit message, and the
// transition-detection + merge logic that stamps coach_since exactly once, on the turn that
// finishes the First Session Protocol.
describe("coachDayNumber", () => {
  const stateMdUTC = "- **Timezone:** UTC\n";

  it("uses coach_since when present", () => {
    const challenge = JSON.stringify({ coach_since: "2026-07-30" });
    expect(coachDayNumber(challenge, stateMdUTC, new Date("2026-08-02T12:00:00Z"))).toBe(4);
  });

  it("falls back to season.start_date when coach_since is absent", () => {
    const challenge = JSON.stringify({ season: { start_date: "2026-08-01" } });
    expect(coachDayNumber(challenge, stateMdUTC, new Date("2026-08-02T12:00:00Z"))).toBe(2);
  });

  it("falls back to challenge.start_date when neither coach_since nor season is present", () => {
    const challenge = JSON.stringify({ challenge: { start_date: "2026-08-02" } });
    expect(coachDayNumber(challenge, stateMdUTC, new Date("2026-08-02T12:00:00Z"))).toBe(1);
  });

  it("prefers coach_since over season/challenge start dates when all three are present", () => {
    const challenge = JSON.stringify({
      coach_since: "2026-01-01",
      season: { start_date: "2026-07-01" },
      challenge: { start_date: "2026-08-01" },
    });
    expect(coachDayNumber(challenge, stateMdUTC, new Date("2026-01-02T12:00:00Z"))).toBe(2);
  });

  it("returns null when challengeJson is null", () => {
    expect(coachDayNumber(null, stateMdUTC, new Date())).toBeNull();
  });

  it("returns null when challengeJson is undefined (ordinary turn, never fetched)", () => {
    expect(coachDayNumber(undefined, stateMdUTC, new Date())).toBeNull();
  });

  it("returns null when none of coach_since/season/challenge start dates are present", () => {
    expect(coachDayNumber(JSON.stringify({ phase: "base" }), stateMdUTC, new Date())).toBeNull();
  });

  it("returns null for unparsable JSON", () => {
    expect(coachDayNumber("{not valid", stateMdUTC, new Date())).toBeNull();
  });
});

describe("injectCoachSinceIfNeeded", () => {
  const stateMdUTC = "- **Timezone:** UTC\n";
  const closingFiles = { coachNotes: null, challengeV2: '{"phase":"base"}', currentWeek: null, sleepLog: null };

  it("does nothing when the profile was already complete before this turn", () => {
    const updates = [{ path: "user_data/coach/state.md", content: "filled in" }];
    const result = injectCoachSinceIfNeeded(updates, closingFiles, true, true, stateMdUTC);
    expect(result).toBe(updates);
  });

  it("does nothing when the profile still isn't complete after this turn", () => {
    const updates: { path: string; content: string }[] = [];
    const result = injectCoachSinceIfNeeded(updates, closingFiles, false, false, stateMdUTC);
    expect(result).toBe(updates);
  });

  it("does nothing on an ordinary turn where closingFiles was never fetched", () => {
    const updates: { path: string; content: string }[] = [];
    const result = injectCoachSinceIfNeeded(updates, undefined, false, true, stateMdUTC);
    expect(result).toBe(updates);
  });

  it("stamps coach_since onto challenge_v2.json on the false→true transition", () => {
    const result = injectCoachSinceIfNeeded([], closingFiles, false, true, stateMdUTC);
    const entry = result.find((u) => u.path === "user_data/ledger/challenge_v2.json");
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content);
    expect(parsed.phase).toBe("base");
    expect(typeof parsed.coach_since).toBe("string");
    expect(parsed.coach_since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("merges onto a challenge_v2.json write Gemini already proposed this same turn, instead of adding a second write", () => {
    const geminiUpdate = { path: "user_data/ledger/challenge_v2.json", content: '{"phase":"base","quests":["cold_shower"]}' };
    const result = injectCoachSinceIfNeeded([geminiUpdate], closingFiles, false, true, stateMdUTC);
    const challengeEntries = result.filter((u) => u.path === "user_data/ledger/challenge_v2.json");
    expect(challengeEntries).toHaveLength(1);
    const parsed = JSON.parse(challengeEntries[0].content);
    expect(parsed.quests).toEqual(["cold_shower"]);
    expect(typeof parsed.coach_since).toBe("string");
  });

  it("never overwrites an existing coach_since, even if the transition logic somehow fires again", () => {
    const files = { ...closingFiles, challengeV2: '{"coach_since":"2026-01-01"}' };
    const result = injectCoachSinceIfNeeded([], files, false, true, stateMdUTC);
    expect(result).toEqual([]);
  });

  it("handles challenge_v2.json not existing yet (null)", () => {
    const files = { ...closingFiles, challengeV2: null };
    const result = injectCoachSinceIfNeeded([], files, false, true, stateMdUTC);
    const entry = result.find((u) => u.path === "user_data/ledger/challenge_v2.json");
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content);
    expect(typeof parsed.coach_since).toBe("string");
  });
});
