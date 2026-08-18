import { describe, it, expect } from "vitest";
import { applyRollingState, applyMemoryUpdate, applyInjuryEvent } from "../_lib/coachIntents.js";

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

describe("applyMemoryUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: ["badminton"],
    goal: "Get back to competitive shape",
    timeline: "Club tournament in October",
    coaching_style: "Direct",
    notes: {
      fitness_baseline: { text: "old baseline", updated_at: "2026-08-01", trace_id: "old" },
      coaching_priorities: { text: "old priorities", updated_at: "2026-08-01", trace_id: "old" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "old equipment", updated_at: "2026-08-01", trace_id: "old" },
    },
  });

  it("replaces exactly the labelled box, leaving the other five untouched", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "fitness_baseline", "new baseline text", "2026-08-18", "t2"));
    expect(result.notes.fitness_baseline).toEqual({ text: "new baseline text", updated_at: "2026-08-18", trace_id: "t2" });
    expect(result.notes.coaching_priorities.text).toBe("old priorities");
    expect(result.notes.equipment.text).toBe("old equipment");
  });

  it("preserves top-level sports/goal/timeline/coaching_style", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "t2"));
    expect(result.sports).toEqual(["badminton"]);
    expect(result.goal).toBe("Get back to competitive shape");
    expect(result.timeline).toBe("Club tournament in October");
    expect(result.coaching_style).toBe("Direct");
  });

  it("stamps _meta with the server-provided date/trace_id, never Gemini-supplied", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "trace-xyz"));
    expect(result._meta).toEqual({ updated_at: "2026-08-18", updated_by: "model", trace_id: "trace-xyz" });
  });

  it("starts a fresh file with all six empty notes when content is null", () => {
    const result = JSON.parse(applyMemoryUpdate(null, "coaching_priorities", "first priority", "2026-08-18", "t1"));
    expect(result.notes.coaching_priorities.text).toBe("first priority");
    expect(result.notes.equipment).toEqual({ text: "", updated_at: "", trace_id: "" });
    expect(result.sports).toEqual([]);
  });

  it("treats malformed JSON as an empty file rather than throwing", () => {
    const result = JSON.parse(applyMemoryUpdate("{not valid json", "equipment", "new gear", "2026-08-18", "t1"));
    expect(result.notes.equipment.text).toBe("new gear");
  });

  it("trims the incoming text", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "equipment", "  padded text  ", "2026-08-18", "t1"));
    expect(result.notes.equipment.text).toBe("padded text");
  });
});

describe("applyInjuryEvent", () => {
  const EXISTING = JSON.stringify({
    flags: [
      { id: "inj_elbow", text: "Right elbow soreness", status: "active", opened_at: "2026-08-01", resolved_at: null },
      { id: "inj_knee", text: "Right knee discomfort", status: "resolved", opened_at: "2026-07-01", resolved_at: "2026-07-20" },
    ],
  });

  it("opens a new flag with a server-minted id and no resolved_at", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "active", text: "Left ankle tweak" }, "2026-08-18"));
    expect(result.flags).toHaveLength(3);
    const newFlag = result.flags[2];
    expect(newFlag.text).toBe("Left ankle tweak");
    expect(newFlag.status).toBe("active");
    expect(newFlag.opened_at).toBe("2026-08-18");
    expect(newFlag.resolved_at).toBeNull();
    expect(newFlag.id).toMatch(/^inj_/);
  });

  it("starts a fresh flags array when content is null", () => {
    const result = JSON.parse(applyInjuryEvent(null, { status: "active", text: "First injury" }, "2026-08-18"));
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].text).toBe("First injury");
  });

  it("updates an existing active flag's text without changing its id/opened_at", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "active", flag_id: "inj_elbow", text: "Worse today" }, "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.text).toBe("Worse today");
    expect(flag.opened_at).toBe("2026-08-01");
    expect(flag.resolved_at).toBeNull();
  });

  it("resolves a flag, stamping resolved_at and leaving text as-is when no new text given", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "resolved", flag_id: "inj_elbow" }, "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.status).toBe("resolved");
    expect(flag.resolved_at).toBe("2026-08-18");
    expect(flag.text).toBe("Right elbow soreness");
  });

  it("reactivates a previously resolved flag, clearing resolved_at back to null", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "active", flag_id: "inj_knee", text: "Flared up again" }, "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_knee");
    expect(flag.status).toBe("active");
    expect(flag.resolved_at).toBeNull();
    expect(flag.text).toBe("Flared up again");
  });

  it("leaves other flags untouched", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "resolved", flag_id: "inj_elbow" }, "2026-08-18"));
    const untouched = result.flags.find((f: any) => f.id === "inj_knee");
    expect(untouched).toEqual({ id: "inj_knee", text: "Right knee discomfort", status: "resolved", opened_at: "2026-07-01", resolved_at: "2026-07-20" });
  });

  it("treats malformed JSON as an empty flags array rather than throwing", () => {
    const result = JSON.parse(applyInjuryEvent("{not valid json", { status: "active", text: "New injury" }, "2026-08-18"));
    expect(result.flags).toHaveLength(1);
  });

  it("ignores an unknown flag_id gracefully (no matching flag changed)", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, { status: "resolved", flag_id: "inj_nonexistent" }, "2026-08-18"));
    expect(result.flags).toHaveLength(2);
    expect(result.flags.every((f: any) => f.resolved_at !== "2026-08-18" || f.id === "inj_knee")).toBe(true);
  });
});
