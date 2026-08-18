import { describe, it, expect } from "vitest";
import { applyCoachNote, applyMemoryUpdate, applyInjuryEvent } from "../_lib/coachIntents.js";

describe("applyCoachNote", () => {
  it("starts a new log with one row when content is null", () => {
    const result = JSON.parse(applyCoachNote(null, "First session logged.", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")));
    expect(result.version).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ date: "2026-08-16", type: "chat", text: "First session logged.", trace_id: "t1" });
    expect(result.rows[0].id).toMatch(/^sess_2026-08-16_/);
    expect(result.rows[0].ts).toBe("2026-08-16T18:00:00.000Z");
  });

  it("appends to the end of the existing row log (oldest first, storage unbounded)", () => {
    const existing = JSON.stringify({
      version: 1,
      rows: [
        { id: "sess_2026-08-14_aaaa", date: "2026-08-14", ts: "2026-08-14T00:00:00Z", type: "chat", text: "Strength session.", trace_id: "t0" },
        { id: "sess_2026-08-15_bbbb", date: "2026-08-15", ts: "2026-08-15T00:00:00Z", type: "chat", text: "Rest day.", trace_id: "t0" },
      ],
    });
    const result = JSON.parse(applyCoachNote(existing, "5k run.", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")));
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r: { date: string }) => r.date)).toEqual(["2026-08-14", "2026-08-15", "2026-08-16"]);
    expect(result.rows[2].text).toBe("5k run.");
  });

  it("treats malformed JSON as an empty log rather than throwing", () => {
    const result = JSON.parse(applyCoachNote("{not valid json", "5k run.", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")));
    expect(result.rows).toHaveLength(1);
  });

  it("treats a value with no rows array as an empty log", () => {
    const result = JSON.parse(applyCoachNote('{"threads":[]}', "5k run.", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")));
    expect(result.rows).toHaveLength(1);
  });

  it("trims the note before storing", () => {
    const result = JSON.parse(applyCoachNote(null, "  padded on both sides  \n", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")));
    expect(result.rows[0].text).toBe("padded on both sides");
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
