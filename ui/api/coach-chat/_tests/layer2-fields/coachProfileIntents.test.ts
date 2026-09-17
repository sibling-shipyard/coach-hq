import { describe, it, expect } from "vitest";
import {
  applyCoachNote,
  applyMemoryUpdate,
  applyProfileUpdate,
  applyCoachingStyleUpdate,
  applySportsUpdate,
  type ProfileUpdate,
} from "../../_lib/decide/coachProfileIntents.js";

describe("applyCoachNote", () => {
  it("starts a new log with one row when content is null", () => {
    const result = JSON.parse(
      applyCoachNote(
        null,
        "First session logged.",
        "2026-08-16",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
      ),
    );
    expect(result.version).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      date: "2026-08-16",
      type: "chat",
      text: "First session logged.",
      trace_id: "t1",
    });
    expect(result.rows[0].id).toMatch(/^sess_2026-08-16_/);
    expect(result.rows[0].ts).toBe("2026-08-16T18:00:00.000Z");
  });

  it("appends to the end of the existing row log (oldest first, storage unbounded)", () => {
    const existing = JSON.stringify({
      version: 1,
      rows: [
        {
          id: "sess_2026-08-14_aaaa",
          date: "2026-08-14",
          ts: "2026-08-14T00:00:00Z",
          type: "chat",
          text: "Strength session.",
          trace_id: "t0",
        },
        {
          id: "sess_2026-08-15_bbbb",
          date: "2026-08-15",
          ts: "2026-08-15T00:00:00Z",
          type: "chat",
          text: "Rest day.",
          trace_id: "t0",
        },
      ],
    });
    const result = JSON.parse(
      applyCoachNote(existing, "5k run.", "2026-08-16", "t1", new Date("2026-08-16T18:00:00Z")),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r: { date: string }) => r.date)).toEqual([
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ]);
    expect(result.rows[2].text).toBe("5k run.");
  });

  it("treats malformed JSON as an empty log rather than throwing", () => {
    const result = JSON.parse(
      applyCoachNote(
        "{not valid json",
        "5k run.",
        "2026-08-16",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
      ),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("treats a value with no rows array as an empty log", () => {
    const result = JSON.parse(
      applyCoachNote(
        '{"threads":[]}',
        "5k run.",
        "2026-08-16",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
      ),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("trims the note before storing", () => {
    const result = JSON.parse(
      applyCoachNote(
        null,
        "  padded on both sides  \n",
        "2026-08-16",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
      ),
    );
    expect(result.rows[0].text).toBe("padded on both sides");
  });

  // C2: day-keyed overwrite, mirroring applyQuestEvent's (quest_id, date) upsert pattern in
  // coachSeasonQuestIntents.ts - one row per calendar day, revised in place rather than appended
  // to on a repeat turn.
  const DAY_KEYED_EXISTING = JSON.stringify({
    version: 1,
    rows: [
      {
        id: "sess_2026-08-15_old1",
        date: "2026-08-15",
        ts: "2026-08-15T18:00:00.000Z",
        type: "chat",
        text: "Rest day.",
        trace_id: "old",
      },
      {
        id: "sess_2026-08-16_old2",
        date: "2026-08-16",
        ts: "2026-08-16T09:00:00.000Z",
        type: "chat",
        text: "Knee soreness noted after yesterday's run.",
        trace_id: "old",
      },
    ],
  });

  it("creates a fresh row on a new day rather than touching yesterday's row", () => {
    const result = JSON.parse(
      applyCoachNote(
        DAY_KEYED_EXISTING,
        "5k run, felt strong.",
        "2026-08-17",
        "t2",
        new Date("2026-08-17T18:00:00Z"),
      ),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].text).toBe("Rest day."); // yesterday untouched
    expect(result.rows[1].text).toBe("Knee soreness noted after yesterday's run.");
    const newRow = result.rows[2];
    expect(newRow.date).toBe("2026-08-17");
    expect(newRow.text).toBe("5k run, felt strong.");
    expect(newRow.trace_id).toBe("t2");
    expect(newRow.id).toMatch(/^sess_2026-08-17_/);
  });

  it("overwrites today's existing row in place on a same-day update, reusing its id", () => {
    const result = JSON.parse(
      applyCoachNote(
        DAY_KEYED_EXISTING,
        "Knee soreness noted after yesterday's run (later reported feeling better).",
        "2026-08-16",
        "t2",
        new Date("2026-08-16T20:00:00Z"),
      ),
    );
    expect(result.rows).toHaveLength(2); // no new row added
    expect(result.rows.map((r: { date: string }) => r.date)).toEqual(["2026-08-15", "2026-08-16"]);
    const updated = result.rows[1];
    expect(updated.id).toBe("sess_2026-08-16_old2"); // id reused, not re-minted
    expect(updated.text).toBe(
      "Knee soreness noted after yesterday's run (later reported feeling better).",
    );
    expect(updated.trace_id).toBe("t2");
    expect(updated.ts).toBe("2026-08-16T20:00:00.000Z");
  });
});

describe("applyMemoryUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: ["badminton"],
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
    const result = JSON.parse(
      applyMemoryUpdate(EXISTING, "fitness_baseline", "new baseline text", "2026-08-18", "t2"),
    );
    expect(result.notes.fitness_baseline).toEqual({
      text: "new baseline text",
      updated_at: "2026-08-18",
      trace_id: "t2",
    });
    expect(result.notes.coaching_priorities.text).toBe("old priorities");
    expect(result.notes.equipment.text).toBe("old equipment");
  });

  it("preserves top-level sports", () => {
    const result = JSON.parse(
      applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["badminton"]);
  });

  // Issue #408: goal/timeline dropped from memory.json entirely - seasons.json's name +
  // quests.json's main_quest now represent what goal was trying to capture structurally.
  it("no longer has goal/timeline in its output shape", () => {
    const result = JSON.parse(
      applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "t2"),
    );
    expect(result.goal).toBeUndefined();
    expect(result.timeline).toBeUndefined();
  });

  it("does not resurrect goal/timeline when starting a fresh file from null", () => {
    const result = JSON.parse(applyMemoryUpdate(null, "equipment", "new gear", "2026-08-18", "t1"));
    expect(result.goal).toBeUndefined();
    expect(result.timeline).toBeUndefined();
  });

  it("stamps _meta with the server-provided date/trace_id, never Gemini-supplied", () => {
    const result = JSON.parse(
      applyMemoryUpdate(EXISTING, "equipment", "new gear", "2026-08-18", "trace-xyz"),
    );
    expect(result._meta).toEqual({
      updated_at: "2026-08-18",
      updated_by: "model",
      trace_id: "trace-xyz",
    });
  });

  it("starts a fresh file with all six empty notes when content is null", () => {
    const result = JSON.parse(
      applyMemoryUpdate(null, "coaching_priorities", "first priority", "2026-08-18", "t1"),
    );
    expect(result.notes.coaching_priorities.text).toBe("first priority");
    expect(result.notes.equipment).toEqual({ text: "", updated_at: "", trace_id: "" });
    expect(result.sports).toEqual([]);
  });

  it("treats malformed JSON as an empty file rather than throwing", () => {
    const result = JSON.parse(
      applyMemoryUpdate("{not valid json", "equipment", "new gear", "2026-08-18", "t1"),
    );
    expect(result.notes.equipment.text).toBe("new gear");
  });

  it("trims the incoming text", () => {
    const result = JSON.parse(
      applyMemoryUpdate(EXISTING, "equipment", "  padded text  ", "2026-08-18", "t1"),
    );
    expect(result.notes.equipment.text).toBe("padded text");
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
    const result = JSON.parse(
      applyProfileUpdate(EXISTING, [{ field: "timezone", value: "America/New_York" }]),
    );
    expect(result.timezone).toBe("America/New_York");
    expect(result.name).toBe("Akash");
  });

  // Found in review: the numeric branch (height_cm/weight_kg) got a blank-value guard, but the
  // string branch (name/dob/timezone) didn't get the same treatment - a blank value silently
  // wiped real data with "" instead of being rejected.
  it.each(["name", "dob", "timezone"] as const)(
    'throws on a blank %s instead of silently wiping it with ""',
    (field) => {
      expect(() => applyProfileUpdate(EXISTING, [{ field, value: "" }])).toThrow(
        `profile_update: empty value is not valid for ${field}`,
      );
      expect(() => applyProfileUpdate(EXISTING, [{ field, value: "   " }])).toThrow(
        `profile_update: empty value is not valid for ${field}`,
      );
    },
  );

  it("coerces numeric fields even if given as a string", () => {
    const result = JSON.parse(applyProfileUpdate(EXISTING, [{ field: "weight_kg", value: "72" }]));
    expect(result.weight_kg).toBe(72);
  });

  // Found in review: Number(update.value) was never checked for NaN - a non-numeric string
  // (Gemini passing along "about 180" verbatim, say) would silently write NaN into profile.json
  // instead of being rejected.
  it("throws instead of silently writing NaN for a non-numeric value on a numeric field", () => {
    expect(() =>
      applyProfileUpdate(EXISTING, [{ field: "height_cm", value: "about 180" }]),
    ).toThrow('profile_update: "about 180" is not a valid number for height_cm');
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

  // coach_since is deliberately excluded from ProfileUpdateField (see coachProfileIntents.ts) -
  // it's stamped once at First Session per ADR 0018 and is never a settable field via this
  // action. The type checker rejects it at compile time (@ts-expect-error below confirms that),
  // AND applyProfileUpdate now has a runtime guard too - not just trusting the type, same pattern
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
    const result = JSON.parse(
      applyProfileUpdate("{not valid json", [{ field: "name", value: "Akash" }]),
    );
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

describe("applyCoachingStyleUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: ["badminton"],
    coaching_style: null,
    notes: {
      fitness_baseline: { text: "old baseline", updated_at: "2026-08-01", trace_id: "old" },
      coaching_priorities: { text: "old priorities", updated_at: "2026-08-01", trace_id: "old" },
      "learned_patterns.training": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.nutrition": { text: "", updated_at: "", trace_id: "" },
      "learned_patterns.mental": { text: "", updated_at: "", trace_id: "" },
      equipment: { text: "old equipment", updated_at: "2026-08-01", trace_id: "old" },
    },
  });

  it("sets coaching_style, leaves everything else untouched", () => {
    const result = JSON.parse(
      applyCoachingStyleUpdate(EXISTING, "accountability", "2026-08-18", "t2"),
    );
    expect(result.coaching_style).toBe("accountability");
    expect(result.sports).toEqual(["badminton"]);
    expect(result.notes.equipment.text).toBe("old equipment");
    expect(result._meta).toEqual({ updated_at: "2026-08-18", updated_by: "model", trace_id: "t2" });
  });

  it("throws on a value outside the three-enum set", () => {
    expect(() => applyCoachingStyleUpdate(EXISTING, "supportive", "2026-08-18", "t2")).toThrow(
      /coaching_style_update/,
    );
  });

  it("starts a fresh file with the given style when content is null", () => {
    const result = JSON.parse(applyCoachingStyleUpdate(null, "analysis", "2026-08-18", "t1"));
    expect(result.coaching_style).toBe("analysis");
    expect(result.sports).toEqual([]);
  });

  it("treats malformed JSON as a fresh file rather than throwing", () => {
    const result = JSON.parse(
      applyCoachingStyleUpdate("{not valid json", "encouragement", "2026-08-18", "t1"),
    );
    expect(result.coaching_style).toBe("encouragement");
  });
});

describe("applySportsUpdate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    sports: [],
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
    const result = JSON.parse(
      applySportsUpdate(EXISTING, ["badminton", "running"], "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["badminton", "running"]);
    expect(result.notes.equipment.text).toBe("old equipment");
    expect(result._meta).toEqual({ updated_at: "2026-08-18", updated_by: "model", trace_id: "t2" });
  });

  it("trims each sport and drops blank entries", () => {
    const result = JSON.parse(
      applySportsUpdate(EXISTING, ["  badminton  ", "", "  "], "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["badminton"]);
  });

  it("throws when every given sport is blank", () => {
    expect(() => applySportsUpdate(EXISTING, ["", "   "], "2026-08-18", "t2")).toThrow(
      /sports_update/,
    );
  });

  it("starts a fresh file with the given sports when content is null", () => {
    const result = JSON.parse(applySportsUpdate(null, ["swimming"], "2026-08-18", "t1"));
    expect(result.sports).toEqual(["swimming"]);
    expect(result.notes.equipment).toEqual({ text: "", updated_at: "", trace_id: "" });
  });

  it("treats malformed JSON as a fresh file rather than throwing", () => {
    const result = JSON.parse(
      applySportsUpdate("{not valid json", ["badminton"], "2026-08-18", "t1"),
    );
    expect(result.sports).toEqual(["badminton"]);
  });

  const EXISTING_WITH_SPORTS = JSON.stringify({
    ...JSON.parse(EXISTING),
    sports: ["running", "cycling"],
  });

  it("merges a partial-list update, keeping sports the new list dropped (#1037)", () => {
    // This is the actual bug PR E fixes: the model names only the new sport and forgets to
    // restate what's already on file. The old replace-only code would fail this - it set
    // sports to exactly ["climbing"], silently dropping running and cycling.
    const result = JSON.parse(
      applySportsUpdate(EXISTING_WITH_SPORTS, ["climbing"], "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["climbing", "running", "cycling"]);
  });

  it("doesn't duplicate an existing sport named again with different casing", () => {
    const result = JSON.parse(
      applySportsUpdate(EXISTING_WITH_SPORTS, ["Running", "climbing"], "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["Running", "climbing", "cycling"]);
  });

  it("behaves like a full replace when the new list already names everything on file", () => {
    const result = JSON.parse(
      applySportsUpdate(EXISTING_WITH_SPORTS, ["cycling", "running"], "2026-08-18", "t2"),
    );
    expect(result.sports).toEqual(["cycling", "running"]);
  });

  it("still throws on an all-blank list even with existing sports on file", () => {
    expect(() => applySportsUpdate(EXISTING_WITH_SPORTS, ["", "   "], "2026-08-18", "t2")).toThrow(
      /sports_update/,
    );
  });
});
