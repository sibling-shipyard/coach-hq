import { describe, it, expect } from "vitest";
import { applyInjuryFlag, applyInjuryEvent } from "../../_lib/decide/coachInjuryIntents.js";

describe("applyInjuryFlag", () => {
  it("opens a new flag with a server-minted id and no resolved_at", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "Left ankle tweak" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.flags).toHaveLength(1);
    const newFlag = result.flags[0];
    expect(newFlag.text).toBe("Left ankle tweak");
    expect(newFlag.status).toBe("active");
    expect(newFlag.opened_at).toBe("2026-08-18");
    expect(newFlag.resolved_at).toBeNull();
    expect(newFlag.id).toMatch(/^inj_/);
  });

  // Review finding: every sibling writer (profile, memory, quests, seasons) re-stamps
  // version/_meta on every write; this one used to just emit {flags}, silently dropping both.
  // No existing test asserted on the stamp, which is the whole point of the fix.
  it("stamps version and _meta on every write, not just the flags array", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "Left ankle tweak" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.version).toBe(1);
    expect(result._meta).toEqual({
      updated_at: "2026-08-18T00:00:00.000Z",
      updated_by: "model",
      trace_id: "test-trace",
    });
  });

  it("re-stamps version and _meta fresh even when writing against existing content", () => {
    const existing = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-07-01T00:00:00.000Z", updated_by: "model", trace_id: "old-trace" },
      flags: [],
    });
    const result = JSON.parse(
      applyInjuryFlag(
        existing,
        [{ text: "New wrist tweak" }],
        "2026-08-19",
        "2026-08-19T12:00:00.000Z",
        "new-trace",
      ),
    );
    expect(result._meta).toEqual({
      updated_at: "2026-08-19T12:00:00.000Z",
      updated_by: "model",
      trace_id: "new-trace",
    });
  });

  it("starts a fresh flags array when content is null", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "First injury" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].text).toBe("First injury");
  });

  it("treats malformed JSON as an empty flags array rather than throwing", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        "{not valid json",
        [{ text: "New injury" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.flags).toHaveLength(1);
  });

  it("applies every new injury in the batch, not just the first", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "New wrist tweak" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    // Confirms new-flag events accumulate correctly across calls (a second new flag doesn't
    // clobber the first).
    const second = JSON.parse(
      applyInjuryFlag(
        JSON.stringify(result),
        [{ text: "Separate shoulder niggle" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(second.flags).toHaveLength(2);
  });

  // K1 fixture eval (incremental-injury-disclosure [3/3]): a pure filler turn with zero new
  // information re-fired injury_flag for the same hip injury already logged the turn before,
  // reworded rather than identical - "Left hip soreness persisting for 3 days" (turn 2) vs "Left
  // hip soreness for the past 3 days, noticed during runs" (turn 3's re-fire). Without dedup this
  // would mint a second, genuinely duplicate active flag for the same real injury.
  it("does not mint a second flag when a near-identical injury is already active (K1 fixture eval)", () => {
    const first = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "Left hip soreness persisting for 3 days" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(first.flags).toHaveLength(1);

    const second = JSON.parse(
      applyInjuryFlag(
        JSON.stringify(first),
        [{ text: "Left hip soreness for the past 3 days, noticed during runs" }],
        "2026-08-19",
        "2026-08-19T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(second.flags).toHaveLength(1);
  });

  it("does not dedupe against a resolved flag - a re-reported injury can reopen", () => {
    const resolved = JSON.stringify({
      flags: [
        {
          id: "inj_old",
          text: "Left hip soreness",
          status: "resolved",
          opened_at: "2026-07-01",
          resolved_at: "2026-07-10",
        },
      ],
    });
    const result = JSON.parse(
      applyInjuryFlag(
        resolved,
        [{ text: "Left hip soreness" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.flags).toHaveLength(2);
    expect(result.flags[1].status).toBe("active");
  });

  it("still mints separate flags for two genuinely different injuries in the same batch", () => {
    const result = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "Left hip soreness for 3 days" }, { text: "Right shoulder ache after lifting" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(result.flags).toHaveLength(2);
  });

  // Review finding: "Left hip pain" vs "Right hip pain" share 2 of 3 words each ("hip", "pain"),
  // clearing the 0.5 word-overlap threshold and silently dropping a real second injury on the
  // opposite side of the body.
  it("does not dedupe a same-turn injury against its mirror on the opposite side", () => {
    const first = JSON.parse(
      applyInjuryFlag(
        null,
        [{ text: "Left hip pain" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(first.flags).toHaveLength(1);

    const second = JSON.parse(
      applyInjuryFlag(
        JSON.stringify(first),
        [{ text: "Right hip pain" }],
        "2026-08-19",
        "2026-08-19T00:00:00.000Z",
        "test-trace",
      ),
    );
    expect(second.flags).toHaveLength(2);
  });
});

describe("applyInjuryEvent", () => {
  const EXISTING = JSON.stringify({
    flags: [
      {
        id: "inj_elbow",
        text: "Right elbow soreness",
        status: "active",
        opened_at: "2026-08-01",
        resolved_at: null,
      },
      {
        id: "inj_knee",
        text: "Right knee discomfort",
        status: "resolved",
        opened_at: "2026-07-01",
        resolved_at: "2026-07-20",
      },
    ],
  });

  it("updates an existing active flag's text without changing its id/opened_at", () => {
    const result = JSON.parse(
      applyInjuryEvent(
        EXISTING,
        [{ status: "active", flag_id: "inj_elbow", text: "Worse today" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.text).toBe("Worse today");
    expect(flag.opened_at).toBe("2026-08-01");
    expect(flag.resolved_at).toBeNull();
  });

  it("resolves a flag, stamping resolved_at and leaving text as-is when no new text given", () => {
    const result = JSON.parse(
      applyInjuryEvent(
        EXISTING,
        [{ status: "resolved", flag_id: "inj_elbow" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.status).toBe("resolved");
    expect(flag.resolved_at).toBe("2026-08-18");
    expect(flag.text).toBe("Right elbow soreness");
  });

  it("reactivates a previously resolved flag, clearing resolved_at back to null", () => {
    const result = JSON.parse(
      applyInjuryEvent(
        EXISTING,
        [{ status: "active", flag_id: "inj_knee", text: "Flared up again" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    const flag = result.flags.find((f: any) => f.id === "inj_knee");
    expect(flag.status).toBe("active");
    expect(flag.resolved_at).toBeNull();
    expect(flag.text).toBe("Flared up again");
  });

  it("leaves other flags untouched", () => {
    const result = JSON.parse(
      applyInjuryEvent(
        EXISTING,
        [{ status: "resolved", flag_id: "inj_elbow" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    const untouched = result.flags.find((f: any) => f.id === "inj_knee");
    expect(untouched).toEqual({
      id: "inj_knee",
      text: "Right knee discomfort",
      status: "resolved",
      opened_at: "2026-07-01",
      resolved_at: "2026-07-20",
    });
  });

  it("throws on an unknown flag_id instead of silently no-op'ing", () => {
    // A silent no-op here would let the caller commit a write that looks successful but changed
    // nothing - throwing lets the caller's existing error handling (commitFilesAtomic's catch)
    // surface the failure instead.
    expect(() =>
      applyInjuryEvent(
        EXISTING,
        [{ status: "resolved", flag_id: "inj_nonexistent" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    ).toThrow('no flag with id "inj_nonexistent"');
  });

  // Applier-level double-check for the same enum -
  // coachReplySchema.ts's injury_event.status already constrains on the Gemini path.
  it("throws on an invalid status instead of silently writing it", () => {
    expect(() =>
      applyInjuryEvent(
        EXISTING,
        [{ status: "cured" as any, flag_id: "inj_elbow" }],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    ).toThrow('"cured" is not a valid status');
  });

  // workout-backend-wiring live verification: an athlete reporting two injuries changing in the
  // same message used to silently lose the second one when this was a single object, same bug
  // class issue #410 fixed for quest_event.
  it("applies every event in the batch, not just the first, when the athlete reports two injuries at once", () => {
    const result = JSON.parse(
      applyInjuryEvent(
        EXISTING,
        [
          { status: "resolved", flag_id: "inj_elbow" },
          { status: "active", flag_id: "inj_knee", text: "Flared up again" },
        ],
        "2026-08-18",
        "2026-08-18T00:00:00.000Z",
        "test-trace",
      ),
    );
    const elbow = result.flags.find((f: any) => f.id === "inj_elbow");
    const knee = result.flags.find((f: any) => f.id === "inj_knee");
    expect(elbow.status).toBe("resolved");
    expect(knee).toMatchObject({ status: "active", resolved_at: null, text: "Flared up again" });
  });
});
