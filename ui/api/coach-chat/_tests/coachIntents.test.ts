import { describe, it, expect } from "vitest";
import {
  applyCoachNote,
  applyMemoryUpdate,
  applyCoachingStyleUpdate,
  applySportsUpdate,
  applyInjuryEvent,
  applyQuestEvent,
  applyProfileUpdate,
  applySeasonStart,
  applyQuestCreate,
  type ProfileUpdate,
} from "../_lib/coachIntents.js";

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

  it("preserves top-level sports/coaching_style", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "t2"));
    expect(result.sports).toEqual(["badminton"]);
    expect(result.coaching_style).toBe("Direct");
  });

  // Issue #408: goal/timeline dropped from memory.json entirely - seasons.json's name +
  // quests.json's main_quest now represent what goal was trying to capture structurally.
  it("no longer has goal/timeline in its output shape", () => {
    const result = JSON.parse(applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "t2"));
    expect(result.goal).toBeUndefined();
    expect(result.timeline).toBeUndefined();
  });

  it("does not resurrect goal/timeline when starting a fresh file from null", () => {
    const result = JSON.parse(applyMemoryUpdate(null, "equipment", "new gear", "2026-08-18", "t1"));
    expect(result.goal).toBeUndefined();
    expect(result.timeline).toBeUndefined();
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

describe("applyCoachingStyleUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: ["badminton"],
    coaching_style: "encouragement",
    notes: {
      fitness_baseline: { text: "old baseline", updated_at: "2026-08-01", trace_id: "old" },
      coaching_priorities: { text: "old priorities", updated_at: "2026-08-01", trace_id: "old" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "old equipment", updated_at: "2026-08-01", trace_id: "old" },
    },
  });

  it("sets coaching_style, leaves notes/sports untouched", () => {
    const result = JSON.parse(applyCoachingStyleUpdate(EXISTING, "accountability", "2026-08-18", "t2"));
    expect(result.coaching_style).toBe("accountability");
    expect(result.sports).toEqual(["badminton"]);
    expect(result.notes.equipment.text).toBe("old equipment");
  });

  it("throws on a value outside the enum instead of writing free text", () => {
    expect(() => applyCoachingStyleUpdate(EXISTING, "very direct please", "2026-08-18", "t2")).toThrow(
      'coaching_style_update: "very direct please" is not a valid coaching style',
    );
  });

  it("starts a fresh file with the given style when content is null", () => {
    const result = JSON.parse(applyCoachingStyleUpdate(null, "analysis", "2026-08-18", "t1"));
    expect(result.coaching_style).toBe("analysis");
    expect(result.sports).toEqual([]);
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
    const result = JSON.parse(applyInjuryEvent(EXISTING, [{ status: "active", text: "Left ankle tweak" }], "2026-08-18"));
    expect(result.flags).toHaveLength(3);
    const newFlag = result.flags[2];
    expect(newFlag.text).toBe("Left ankle tweak");
    expect(newFlag.status).toBe("active");
    expect(newFlag.opened_at).toBe("2026-08-18");
    expect(newFlag.resolved_at).toBeNull();
    expect(newFlag.id).toMatch(/^inj_/);
  });

  it("starts a fresh flags array when content is null", () => {
    const result = JSON.parse(applyInjuryEvent(null, [{ status: "active", text: "First injury" }], "2026-08-18"));
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0].text).toBe("First injury");
  });

  it("updates an existing active flag's text without changing its id/opened_at", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, [{ status: "active", flag_id: "inj_elbow", text: "Worse today" }], "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.text).toBe("Worse today");
    expect(flag.opened_at).toBe("2026-08-01");
    expect(flag.resolved_at).toBeNull();
  });

  it("resolves a flag, stamping resolved_at and leaving text as-is when no new text given", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, [{ status: "resolved", flag_id: "inj_elbow" }], "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_elbow");
    expect(flag.status).toBe("resolved");
    expect(flag.resolved_at).toBe("2026-08-18");
    expect(flag.text).toBe("Right elbow soreness");
  });

  it("reactivates a previously resolved flag, clearing resolved_at back to null", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, [{ status: "active", flag_id: "inj_knee", text: "Flared up again" }], "2026-08-18"));
    const flag = result.flags.find((f: any) => f.id === "inj_knee");
    expect(flag.status).toBe("active");
    expect(flag.resolved_at).toBeNull();
    expect(flag.text).toBe("Flared up again");
  });

  it("leaves other flags untouched", () => {
    const result = JSON.parse(applyInjuryEvent(EXISTING, [{ status: "resolved", flag_id: "inj_elbow" }], "2026-08-18"));
    const untouched = result.flags.find((f: any) => f.id === "inj_knee");
    expect(untouched).toEqual({ id: "inj_knee", text: "Right knee discomfort", status: "resolved", opened_at: "2026-07-01", resolved_at: "2026-07-20" });
  });

  it("treats malformed JSON as an empty flags array rather than throwing", () => {
    const result = JSON.parse(applyInjuryEvent("{not valid json", [{ status: "active", text: "New injury" }], "2026-08-18"));
    expect(result.flags).toHaveLength(1);
  });

  it("throws on an unknown flag_id instead of silently no-op'ing", () => {
    // A silent no-op here would let the caller commit a write that looks successful but changed
    // nothing - throwing lets the caller's existing error handling (commitFilesAtomic's catch)
    // surface the failure instead.
    expect(() =>
      applyInjuryEvent(EXISTING, [{ status: "resolved", flag_id: "inj_nonexistent" }], "2026-08-18"),
    ).toThrow('no flag with id "inj_nonexistent"');
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
      ),
    );
    const elbow = result.flags.find((f: any) => f.id === "inj_elbow");
    const knee = result.flags.find((f: any) => f.id === "inj_knee");
    expect(elbow.status).toBe("resolved");
    expect(knee).toMatchObject({ status: "active", resolved_at: null, text: "Flared up again" });
  });

  it("lets a batch open a brand-new flag and resolve it in the same turn", () => {
    const result = JSON.parse(
      applyInjuryEvent(null, [{ status: "active", text: "New wrist tweak" }], "2026-08-18"),
    );
    // Confirms new-flag events accumulate correctly across a batch (a second new flag doesn't
    // clobber the first) - the id-less branch appends rather than replaces.
    const second = JSON.parse(
      applyInjuryEvent(JSON.stringify(result), [{ status: "active", text: "Separate shoulder niggle" }], "2026-08-18"),
    );
    expect(second.flags).toHaveLength(2);
  });
});

describe("applyQuestEvent", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    rows: [
      {
        id: "pr_morning_routine_2026-08-15",
        quest_id: "morning_routine",
        season_id: "s_2026_q2",
        date: "2026-08-15",
        status: "completed",
        value: null,
        source: "model",
        ts: "2026-08-15T18:00:00.000Z",
        trace_id: "old",
      },
      {
        id: "pr_inner_game_2026-08-15",
        quest_id: "inner_game_of_tennis",
        season_id: "s_2026_q2",
        date: "2026-08-15",
        status: "completed",
        value: 10,
        source: "model",
        ts: "2026-08-15T18:00:00.000Z",
        trace_id: "old",
      },
    ],
  });

  const VALID_QUEST_IDS = new Set(["morning_routine", "inner_game_of_tennis"]);

  it("upserts a new row for a quest_id+date with no existing row", () => {
    const result = JSON.parse(
      applyQuestEvent(EXISTING, [{ quest_id: "morning_routine", status: "completed" }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    );
    expect(result.rows).toHaveLength(3);
    const newRow = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(newRow).toMatchObject({ quest_id: "morning_routine", date: "2026-08-16", status: "completed", value: null });
    expect(newRow.id).toBe("pr_morning_routine_2026-08-16");
  });

  it("replaces the existing row for the same quest_id+date rather than adding a duplicate", () => {
    const result = JSON.parse(
      applyQuestEvent(EXISTING, [{ quest_id: "morning_routine", status: "missed" }], "2026-08-15", "s_2026_q2", "t2", new Date("2026-08-16T09:00:00Z"), VALID_QUEST_IDS),
    );
    const rowsForDate = result.rows.filter((r: any) => r.quest_id === "morning_routine" && r.date === "2026-08-15");
    expect(rowsForDate).toHaveLength(1);
    expect(rowsForDate[0].status).toBe("missed");
    expect(rowsForDate[0].id).toBe("pr_morning_routine_2026-08-15");
    expect(result.rows).toHaveLength(2);
  });

  it("stores value when given (progress-type quest case)", () => {
    const result = JSON.parse(
      applyQuestEvent(EXISTING, [{ quest_id: "inner_game_of_tennis", status: "completed", value: 12 }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    );
    const row = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(row.value).toBe(12);
  });

  it("stores value as null when omitted", () => {
    const result = JSON.parse(
      applyQuestEvent(EXISTING, [{ quest_id: "morning_routine", status: "completed" }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    );
    const row = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(row.value).toBeNull();
  });

  it("stamps id/date/ts/trace_id/season_id server-side, not from anything Gemini-influenced beyond quest_id/status/value", () => {
    const result = JSON.parse(
      applyQuestEvent(null, [{ quest_id: "morning_routine", status: "completed" }], "2026-08-16", "s_2026_q3", "trace-xyz", new Date("2026-08-16T18:42:03Z"), VALID_QUEST_IDS),
    );
    const row = result.rows[0];
    expect(row.id).toBe("pr_morning_routine_2026-08-16");
    expect(row.date).toBe("2026-08-16");
    expect(row.ts).toBe("2026-08-16T18:42:03.000Z");
    expect(row.trace_id).toBe("trace-xyz");
    expect(row.season_id).toBe("s_2026_q3");
    expect(row.source).toBe("model");
  });

  it("treats malformed JSON as an empty rows array rather than throwing", () => {
    const result = JSON.parse(
      applyQuestEvent("{not valid json", [{ quest_id: "morning_routine", status: "completed" }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("treats missing/non-array rows as empty rather than throwing", () => {
    const result = JSON.parse(
      applyQuestEvent('{"threads":[]}', [{ quest_id: "morning_routine", status: "completed" }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("leaves other quests' rows untouched by an update to one quest", () => {
    const result = JSON.parse(
      applyQuestEvent(EXISTING, [{ quest_id: "morning_routine", status: "excused" }], "2026-08-15", "s_2026_q2", "t2", new Date("2026-08-16T09:00:00Z"), VALID_QUEST_IDS),
    );
    const other = result.rows.find((r: any) => r.quest_id === "inner_game_of_tennis");
    expect(other).toEqual({
      id: "pr_inner_game_2026-08-15",
      quest_id: "inner_game_of_tennis",
      season_id: "s_2026_q2",
      date: "2026-08-15",
      status: "completed",
      value: 10,
      source: "model",
      ts: "2026-08-15T18:00:00.000Z",
      trace_id: "old",
    });
  });

  // Found in review: applyProfileUpdate already guards its field enum against a hallucinated
  // value; this had no equivalent guard against a hallucinated/stale quest_id at all.
  it("throws on a quest_id that isn't in the known quest list, instead of writing a bogus row", () => {
    expect(() =>
      applyQuestEvent(EXISTING, [{ quest_id: "not_a_real_quest", status: "completed" }], "2026-08-16", "s_2026_q2", "t1", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
    ).toThrow('quest_event: no quest with id "not_a_real_quest" in quests.json');
  });

  // Issue #410: quest_event became an array so a single turn can report multiple quest
  // completions - a message reporting two separate quests done at once used to only capture one.
  describe("multiple events in one call (issue #410)", () => {
    it("applies each event's upsert in sequence, updating multiple different rows", () => {
      const result = JSON.parse(
        applyQuestEvent(
          EXISTING,
          [
            { quest_id: "morning_routine", status: "completed" },
            { quest_id: "inner_game_of_tennis", status: "completed", value: 15 },
          ],
          "2026-08-16",
          "s_2026_q2",
          "t3",
          new Date("2026-08-16T18:00:00Z"),
          VALID_QUEST_IDS,
        ),
      );
      expect(result.rows).toHaveLength(4);
      const morning = result.rows.find((r: any) => r.quest_id === "morning_routine" && r.date === "2026-08-16");
      const tennis = result.rows.find((r: any) => r.quest_id === "inner_game_of_tennis" && r.date === "2026-08-16");
      expect(morning).toMatchObject({ status: "completed", value: null });
      expect(tennis).toMatchObject({ status: "completed", value: 15 });
    });

    it("an empty array is a no-op - rows unchanged", () => {
      const result = JSON.parse(
        applyQuestEvent(EXISTING, [], "2026-08-16", "s_2026_q2", "t3", new Date("2026-08-16T18:00:00Z"), VALID_QUEST_IDS),
      );
      expect(result.rows).toEqual(JSON.parse(EXISTING).rows);
    });

    it("a second event for the same quest_id+date within one call upserts onto the first (last one wins)", () => {
      const result = JSON.parse(
        applyQuestEvent(
          null,
          [
            { quest_id: "morning_routine", status: "completed" },
            { quest_id: "morning_routine", status: "missed" },
          ],
          "2026-08-16",
          "s_2026_q2",
          "t3",
          new Date("2026-08-16T18:00:00Z"),
          VALID_QUEST_IDS,
        ),
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("missed");
    });
  });
});

describe("applyProfileUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    coach_since: "2026-01-01",
    name: "Akash",
    dob: "1998-05-01",
    timezone: "America/Los_Angeles",
    height_cm: 175,
    weight_kg: 70,
  });

  it("sets exactly the targeted field, leaves every other field untouched", () => {
    // value is a string here (not a number literal) to match what the Gemini schema actually
    // produces (found in review: ProfileUpdate.value used to allow number too, which nothing
    // could ever really send).
    const result = JSON.parse(applyProfileUpdate(EXISTING, [{ field: "height_cm", value: "178" }]));
    expect(result.height_cm).toBe(178);
    expect(result.name).toBe("Akash");
    expect(result.dob).toBe("1998-05-01");
    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.weight_kg).toBe(70);
    expect(result.coach_since).toBe("2026-01-01");
  });

  it("sets a string field (timezone)", () => {
    const result = JSON.parse(applyProfileUpdate(EXISTING, [{ field: "timezone", value: "America/New_York" }]));
    expect(result.timezone).toBe("America/New_York");
    expect(result.name).toBe("Akash");
  });

  // Found in review: the numeric branch (height_cm/weight_kg) got a blank-value guard, but the
  // string branch (name/dob/timezone) didn't get the same treatment - a blank value silently
  // wiped real data with "" instead of being rejected.
  it.each(["name", "dob", "timezone"] as const)("throws on a blank %s instead of silently wiping it with \"\"", (field) => {
    expect(() => applyProfileUpdate(EXISTING, [{ field, value: "" }])).toThrow(`profile_update: empty value is not valid for ${field}`);
    expect(() => applyProfileUpdate(EXISTING, [{ field, value: "   " }])).toThrow(`profile_update: empty value is not valid for ${field}`);
  });

  it("coerces numeric fields even if given as a string", () => {
    const result = JSON.parse(applyProfileUpdate(EXISTING, [{ field: "weight_kg", value: "72" }]));
    expect(result.weight_kg).toBe(72);
  });

  // Found in review: Number(update.value) was never checked for NaN - a non-numeric string
  // (Gemini passing along "about 180" verbatim, say) would silently write NaN into profile.json
  // instead of being rejected.
  it("throws instead of silently writing NaN for a non-numeric value on a numeric field", () => {
    expect(() => applyProfileUpdate(EXISTING, [{ field: "height_cm", value: "about 180" }])).toThrow(
      'profile_update: "about 180" is not a valid number for height_cm',
    );
  });

  // Found in review, second pass: Number("") is 0, not NaN - a JS quirk the isNaN guard above
  // doesn't catch on its own, so an empty value slipped past it and silently wrote 0 instead of
  // being rejected like any other invalid input.
  it("throws on an empty value instead of silently writing 0 (Number('') === 0, not NaN)", () => {
    expect(() => applyProfileUpdate(EXISTING, [{ field: "weight_kg", value: "" }])).toThrow(
      "profile_update: empty value is not a valid number for weight_kg",
    );
  });

  it("throws on a whitespace-only value the same way", () => {
    expect(() => applyProfileUpdate(EXISTING, [{ field: "weight_kg", value: "   " }])).toThrow(
      "profile_update: empty value is not a valid number for weight_kg",
    );
  });

  // coach_since is deliberately excluded from ProfileUpdateField (see coachIntents.ts) - it's
  // stamped once at First Session per ADR 0018 and is never a settable field via this action.
  // The type checker rejects it at compile time (@ts-expect-error below confirms that), AND
  // applyProfileUpdate now has a runtime guard too - not just trusting the type, same pattern
  // every other applier in this file already follows for its own inputs (malformed JSON, etc.).
  // A caller that bypasses the type (untrusted JSON parsed `as any`, exactly how coach-chat.ts
  // gets Gemini's action arguments) throws instead of silently corrupting coach_since.
  it("throws on a bypassed coach_since field instead of silently corrupting it", () => {
    // @ts-expect-error - "coach_since" is not assignable to ProfileUpdateField.
    const invalid: ProfileUpdate = { field: "coach_since", value: "2026-01-01" };
    const bypassed = invalid as unknown as ProfileUpdate;
    expect(() => applyProfileUpdate(EXISTING, [bypassed])).toThrow(
      'profile_update: "coach_since" is not a settable field',
    );
  });

  // Array (workout-backend-wiring live verification, same fix issue #410 already gave
  // quest_event/injury_event) - a single object silently dropped every field past the first when
  // the athlete reported more than one in the same message.
  it("applies every entry in the array, not just the first", () => {
    const result = JSON.parse(
      applyProfileUpdate(EXISTING, [
        { field: "weight_kg", value: "72" },
        { field: "timezone", value: "America/New_York" },
      ]),
    );
    expect(result.weight_kg).toBe(72);
    expect(result.timezone).toBe("America/New_York");
    expect(result.name).toBe("Akash");
  });

  it("throws before writing anything if any entry in the array is invalid (all-or-nothing)", () => {
    expect(() =>
      applyProfileUpdate(EXISTING, [
        { field: "weight_kg", value: "72" },
        { field: "height_cm", value: "not a number" },
      ]),
    ).toThrow('profile_update: "not a number" is not a valid number for height_cm');
  });

  it("degrades malformed content to a sensible empty/null profile rather than throwing", () => {
    const result = JSON.parse(applyProfileUpdate("{not valid json", [{ field: "name", value: "Akash" }]));
    expect(result.name).toBe("Akash");
    expect(result.coach_since).toBeNull();
    expect(result.dob).toBeNull();
    expect(result.timezone).toBe("UTC");
    expect(result.height_cm).toBeNull();
    expect(result.weight_kg).toBeNull();
  });

  it("degrades missing content (null) to a sensible empty/null profile", () => {
    const result = JSON.parse(applyProfileUpdate(null, [{ field: "dob", value: "1998-05-01" }]));
    expect(result.dob).toBe("1998-05-01");
    expect(result.coach_since).toBeNull();
    expect(result.name).toBe("");
    expect(result.timezone).toBe("UTC");
  });
});

describe("applySportsUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: [],
    coaching_style: "encouragement",
    notes: {
      fitness_baseline: { text: "old baseline", updated_at: "2026-08-01", trace_id: "old" },
      coaching_priorities: { text: "old priorities", updated_at: "2026-08-01", trace_id: "old" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "old equipment", updated_at: "2026-08-01", trace_id: "old" },
    },
  });

  it("sets sports, leaves everything else untouched", () => {
    const result = JSON.parse(applySportsUpdate(EXISTING, ["badminton", "running"], "2026-08-18", "t2"));
    expect(result.sports).toEqual(["badminton", "running"]);
    expect(result.coaching_style).toBe("encouragement");
    expect(result.notes.equipment.text).toBe("old equipment");
    expect(result._meta).toEqual({ updated_at: "2026-08-18", updated_by: "model", trace_id: "t2" });
  });

  it("trims each sport and drops blank entries", () => {
    const result = JSON.parse(applySportsUpdate(EXISTING, ["  badminton  ", "", "  "], "2026-08-18", "t2"));
    expect(result.sports).toEqual(["badminton"]);
  });

  it("throws when every given sport is blank", () => {
    expect(() => applySportsUpdate(EXISTING, ["", "   "], "2026-08-18", "t2")).toThrow(/sports_update/);
  });

  it("starts a fresh file with the given sports when content is null", () => {
    const result = JSON.parse(applySportsUpdate(null, ["swimming"], "2026-08-18", "t1"));
    expect(result.sports).toEqual(["swimming"]);
    expect(result.coaching_style).toBeNull();
    expect(result.notes.equipment).toEqual({ text: "", updated_at: "", trace_id: "" });
  });

  it("treats malformed JSON as a fresh file rather than throwing", () => {
    const result = JSON.parse(applySportsUpdate("{not valid json", ["badminton"], "2026-08-18", "t1"));
    expect(result.sports).toEqual(["badminton"]);
  });
});

describe("applySeasonStart", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    current_season_id: "season_old_aaaa",
    seasons: [{ id: "season_old_aaaa", name: "Old Season", start_date: "2026-01-01", end_date: "2026-06-01", status: "completed" }],
  });

  it("mints a real id and sets current_season_id", () => {
    const result = JSON.parse(
      applySeasonStart(EXISTING, { name: "Marathon Build", start_date: "2026-08-18", end_date: "2026-12-01" }, "t1", new Date("2026-08-18T10:00:00Z")),
    );
    expect(result.current_season_id).toMatch(/^season_marathon_build_/);
    expect(result.seasons[0].id).toBe(result.current_season_id);
    expect(result.seasons[0]).toMatchObject({ name: "Marathon Build", start_date: "2026-08-18", end_date: "2026-12-01", status: "active" });
    // Newest-first: prepended, old season still present after it.
    expect(result.seasons[1].id).toBe("season_old_aaaa");
    expect(result.seasons).toHaveLength(2);
  });

  it("never invents a phase field - Season has none", () => {
    const result = JSON.parse(
      applySeasonStart(EXISTING, { name: "Marathon Build", start_date: "2026-08-18", end_date: "2026-12-01" }, "t1", new Date("2026-08-18T10:00:00Z")),
    );
    expect(result.seasons[0].phase).toBeUndefined();
  });

  it("starts a fresh file with just the new season when content is null", () => {
    const result = JSON.parse(
      applySeasonStart(null, { name: "First Season", start_date: "2026-08-18", end_date: "2026-12-01" }, "t1", new Date("2026-08-18T10:00:00Z")),
    );
    expect(result.seasons).toHaveLength(1);
    expect(result.current_season_id).toBe(result.seasons[0].id);
  });
});

describe("applyQuestCreate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    weekly_targets: {},
    main_quest: { id: "mq_old_aaaa", name: "Old Goal", type: "count_target", target: 10 },
    quests: [{ id: "q_old_bbbb", name: "Old habit", type: "daily_streak", start_date: "2026-01-01", end_date: null, status: "active", source: "athlete" }],
  });

  it("sets main_quest and appends new quests with source model", () => {
    const result = JSON.parse(
      applyQuestCreate(
        EXISTING,
        {
          main_quest: { name: "Run a marathon", type: "count_target", target: 1 },
          quests: [{ name: "Stretch daily", type: "daily_streak", polarity: "default_done" }],
        },
        "2026-08-18",
        "t1",
        new Date("2026-08-18T10:00:00Z"),
      ),
    );
    expect(result.main_quest).toMatchObject({ name: "Run a marathon", type: "count_target", target: 1 });
    expect(result.main_quest.id).toMatch(/^mq_run_a_marathon_/);
    // Existing quest untouched, new one appended.
    expect(result.quests).toHaveLength(2);
    expect(result.quests[0].id).toBe("q_old_bbbb");
    const newQuest = result.quests[1];
    expect(newQuest).toMatchObject({
      name: "Stretch daily",
      type: "daily_streak",
      polarity: "default_done",
      status: "active",
      start_date: "2026-08-18",
      end_date: null,
      source: "model",
    });
    expect(newQuest.id).toMatch(/^q_stretch_daily_/);
  });

  it("keeps the existing main_quest when none is given, only appending quests", () => {
    const result = JSON.parse(
      applyQuestCreate(EXISTING, { quests: [{ name: "Read daily", type: "daily_streak" }] }, "2026-08-18", "t1", new Date("2026-08-18T10:00:00Z")),
    );
    expect(result.main_quest.id).toBe("mq_old_aaaa");
    expect(result.quests).toHaveLength(2);
  });

  it("throws when no main_quest is given and the file has none to fall back to", () => {
    expect(() => applyQuestCreate(null, { quests: [{ name: "Read daily", type: "daily_streak" }] }, "2026-08-18", "t1", new Date("2026-08-18T10:00:00Z"))).toThrow(
      /quest_create: no main_quest given/,
    );
  });
});
