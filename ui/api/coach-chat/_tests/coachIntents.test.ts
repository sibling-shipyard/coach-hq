import { describe, it, expect } from "vitest";
import { applyRollingState } from "../_lib/coachIntents.js";

describe("applyRollingState", () => {
  it("starts a new log when content is null", () => {
    const result = applyRollingState(null, { date: "2026-08-16", text: "First session logged." });
    expect(JSON.parse(result)).toEqual([{ date: "2026-08-16", text: "First session logged." }]);
  });

  it("prepends the new entry as newest and keeps the window under the cap", () => {
    const existing = JSON.stringify([
      { date: "2026-08-15", text: "Rest day." },
      { date: "2026-08-14", text: "Strength session." },
    ]);
    const result = JSON.parse(applyRollingState(existing, { date: "2026-08-16", text: "5k run." }, 3));
    expect(result).toEqual([
      { date: "2026-08-16", text: "5k run." },
      { date: "2026-08-15", text: "Rest day." },
      { date: "2026-08-14", text: "Strength session." },
    ]);
  });

  it("drops the oldest entry once the window is exceeded", () => {
    const existing = JSON.stringify([
      { date: "2026-08-15", text: "Rest day." },
      { date: "2026-08-14", text: "Strength session." },
      { date: "2026-08-13", text: "Badminton." },
    ]);
    const result = JSON.parse(applyRollingState(existing, { date: "2026-08-16", text: "5k run." }, 3));
    expect(result).toHaveLength(3);
    expect(result.map((e: { date: string }) => e.date)).toEqual(["2026-08-16", "2026-08-15", "2026-08-14"]);
    expect(result.find((e: { date: string }) => e.date === "2026-08-13")).toBeUndefined();
  });

  it("treats malformed JSON as an empty log rather than throwing", () => {
    const result = applyRollingState("{not valid json", { date: "2026-08-16", text: "5k run." });
    expect(JSON.parse(result)).toEqual([{ date: "2026-08-16", text: "5k run." }]);
  });

  it("treats a non-array JSON value as an empty log", () => {
    const result = applyRollingState('{"threads":[]}', { date: "2026-08-16", text: "5k run." });
    expect(JSON.parse(result)).toEqual([{ date: "2026-08-16", text: "5k run." }]);
  });

  it("respects a custom window size", () => {
    const existing = JSON.stringify([{ date: "2026-08-15", text: "Rest day." }]);
    const result = JSON.parse(applyRollingState(existing, { date: "2026-08-16", text: "5k run." }, 1));
    expect(result).toEqual([{ date: "2026-08-16", text: "5k run." }]);
  });
});
