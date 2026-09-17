import { describe, it, expect } from "vitest";
import {
  applyQuestEvent,
  applySeasonStart,
  applyQuestCreate,
} from "../../_lib/decide/coachSeasonQuestIntents.js";

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
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "morning_routine", status: "completed" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    expect(result.rows).toHaveLength(3);
    const newRow = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(newRow).toMatchObject({
      quest_id: "morning_routine",
      date: "2026-08-16",
      status: "completed",
      value: null,
    });
    expect(newRow.id).toBe("pr_morning_routine_2026-08-16");
  });

  it("replaces the existing row for the same quest_id+date rather than adding a duplicate", () => {
    const result = JSON.parse(
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "morning_routine", status: "missed" }],
        "2026-08-15",
        "s_2026_q2",
        "t2",
        new Date("2026-08-16T09:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    const rowsForDate = result.rows.filter(
      (r: any) => r.quest_id === "morning_routine" && r.date === "2026-08-15",
    );
    expect(rowsForDate).toHaveLength(1);
    expect(rowsForDate[0].status).toBe("missed");
    expect(rowsForDate[0].id).toBe("pr_morning_routine_2026-08-15");
    expect(result.rows).toHaveLength(2);
  });

  it("stores value when given (progress-type quest case)", () => {
    const result = JSON.parse(
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "inner_game_of_tennis", status: "completed", value: "12" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    const row = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(row.value).toBe("12");
  });

  it("stores value as null when omitted", () => {
    const result = JSON.parse(
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "morning_routine", status: "completed" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    const row = result.rows.find((r: any) => r.date === "2026-08-16");
    expect(row.value).toBeNull();
  });

  it("stamps id/date/ts/trace_id/season_id server-side, not from anything Gemini-influenced beyond quest_id/status/value", () => {
    const result = JSON.parse(
      applyQuestEvent(
        null,
        [{ quest_id: "morning_routine", status: "completed" }],
        "2026-08-16",
        "s_2026_q3",
        "trace-xyz",
        new Date("2026-08-16T18:42:03Z"),
        VALID_QUEST_IDS,
      ),
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
      applyQuestEvent(
        "{not valid json",
        [{ quest_id: "morning_routine", status: "completed" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("treats missing/non-array rows as empty rather than throwing", () => {
    const result = JSON.parse(
      applyQuestEvent(
        '{"threads":[]}',
        [{ quest_id: "morning_routine", status: "completed" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("leaves other quests' rows untouched by an update to one quest", () => {
    const result = JSON.parse(
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "morning_routine", status: "excused" }],
        "2026-08-15",
        "s_2026_q2",
        "t2",
        new Date("2026-08-16T09:00:00Z"),
        VALID_QUEST_IDS,
      ),
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
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "not_a_real_quest", status: "completed" }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    ).toThrow('quest_event: no quest with id "not_a_real_quest" in quests.json');
  });

  // Applier-level double-check for the same enum -
  // coachReplySchema.ts's quest_event.status already constrains on the Gemini path.
  it("throws on an invalid status instead of silently writing it", () => {
    expect(() =>
      applyQuestEvent(
        EXISTING,
        [{ quest_id: "morning_routine", status: "in_progress" as any }],
        "2026-08-16",
        "s_2026_q2",
        "t1",
        new Date("2026-08-16T18:00:00Z"),
        VALID_QUEST_IDS,
      ),
    ).toThrow('"in_progress" is not a valid status');
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
            { quest_id: "inner_game_of_tennis", status: "completed", value: "15" },
          ],
          "2026-08-16",
          "s_2026_q2",
          "t3",
          new Date("2026-08-16T18:00:00Z"),
          VALID_QUEST_IDS,
        ),
      );
      expect(result.rows).toHaveLength(4);
      const morning = result.rows.find(
        (r: any) => r.quest_id === "morning_routine" && r.date === "2026-08-16",
      );
      const tennis = result.rows.find(
        (r: any) => r.quest_id === "inner_game_of_tennis" && r.date === "2026-08-16",
      );
      expect(morning).toMatchObject({ status: "completed", value: null });
      expect(tennis).toMatchObject({ status: "completed", value: "15" });
    });

    it("an empty array is a no-op - rows unchanged", () => {
      const result = JSON.parse(
        applyQuestEvent(
          EXISTING,
          [],
          "2026-08-16",
          "s_2026_q2",
          "t3",
          new Date("2026-08-16T18:00:00Z"),
          VALID_QUEST_IDS,
        ),
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

describe("applySeasonStart", () => {
  const SEASON_INPUT = {
    name: "Marathon Build",
    start_date: "2026-08-18",
    end_date: "2026-12-01",
    main_quest: { name: "Run a marathon", type: "count_target" as const, target: 1 },
    new_habits: [] as {
      name: string;
      type: "daily_streak" | "progress" | "count_target" | "weekly_frequency";
      polarity?: "default_done" | "default_not_done";
      target?: number;
      unit?: string;
    }[],
  };

  it("mints a real id and sets current_season_id - no prior season (FSP case)", () => {
    const result = applySeasonStart(
      null,
      null,
      SEASON_INPUT,
      "2026-08-18",
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    const seasons = JSON.parse(result.seasonsContent);
    expect(seasons.current_season_id).toMatch(/^season_marathon_build_/);
    expect(seasons.seasons[0].id).toBe(seasons.current_season_id);
    expect(seasons.seasons[0]).toMatchObject({
      name: "Marathon Build",
      start_date: "2026-08-18",
      end_date: "2026-12-01",
      status: "active",
    });
    expect(seasons.seasons).toHaveLength(1);

    const quests = JSON.parse(result.questsContent);
    expect(quests.main_quest).toMatchObject({
      name: "Run a marathon",
      type: "count_target",
      target: 1,
      season_id: seasons.current_season_id,
    });
    expect(quests.quests).toHaveLength(0);
  });

  it("#808: new_habits appends as habit quests in the same call as the season/goal", () => {
    const result = applySeasonStart(
      null,
      null,
      {
        ...SEASON_INPUT,
        new_habits: [{ name: "Morning mobility", type: "daily_streak", target: 10, unit: "min" }],
      },
      "2026-08-18",
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    const quests = JSON.parse(result.questsContent);
    expect(quests.quests).toHaveLength(1);
    expect(quests.quests[0]).toMatchObject({
      name: "Morning mobility",
      type: "daily_streak",
      status: "active",
      start_date: "2026-08-18",
      end_date: null,
      target: 10,
      unit: "min",
      source: "model",
    });
    expect(quests.quests[0].id).toMatch(/^q_morning_mobility_/);
  });

  it("does not throw when new_habits is absent from the reply, despite being required in the schema - Gemini drops required fields (#808)", () => {
    const { new_habits: _omitted, ...withoutNewHabits } = SEASON_INPUT;
    const result = applySeasonStart(
      null,
      null,
      withoutNewHabits as typeof SEASON_INPUT,
      "2026-08-18",
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    const quests = JSON.parse(result.questsContent);
    expect(quests.quests).toHaveLength(0);
  });

  it("never invents a phase field - Season has none", () => {
    const result = applySeasonStart(
      null,
      null,
      SEASON_INPUT,
      "2026-08-18",
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    expect(JSON.parse(result.seasonsContent).seasons[0].phase).toBeUndefined();
  });

  it("started early: prior active season resolves to retired, its main_quest retires into quests[]", () => {
    const existingSeasons = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
      current_season_id: "season_old_aaaa",
      seasons: [
        {
          id: "season_old_aaaa",
          name: "Old Season",
          start_date: "2026-01-01",
          end_date: "2026-12-01",
          status: "active",
        },
      ],
    });
    const existingQuests = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
      weekly_targets: {},
      main_quest: {
        id: "mq_old_aaaa",
        name: "Old Goal",
        type: "count_target",
        target: 10,
        season_id: "season_old_aaaa",
      },
      quests: [],
    });

    const result = applySeasonStart(
      existingSeasons,
      existingQuests,
      SEASON_INPUT,
      "2026-08-18", // before the old season's 2026-12-01 end_date - started early
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );

    const seasons = JSON.parse(result.seasonsContent);
    const newSeasonId = seasons.current_season_id;
    expect(seasons.seasons[1]).toMatchObject({ id: "season_old_aaaa", status: "retired" });
    expect(seasons.seasons[0].id).toBe(newSeasonId);

    const quests = JSON.parse(result.questsContent);
    expect(quests.main_quest).toMatchObject({ name: "Run a marathon", season_id: newSeasonId });
    expect(quests.quests).toHaveLength(1);
    expect(quests.quests[0]).toMatchObject({
      id: "mq_old_aaaa",
      name: "Old Goal",
      type: "count_target",
      target: 10,
      status: "retired",
      start_date: "2026-01-01",
      end_date: "2026-08-18",
      source: "model",
    });
  });

  it("started after end date: prior active season resolves to completed", () => {
    const existingSeasons = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
      current_season_id: "season_old_aaaa",
      seasons: [
        {
          id: "season_old_aaaa",
          name: "Old Season",
          start_date: "2026-01-01",
          end_date: "2026-06-01",
          status: "active",
        },
      ],
    });

    const result = applySeasonStart(
      existingSeasons,
      null,
      SEASON_INPUT,
      "2026-08-18", // after the old season's 2026-06-01 end_date
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    const seasons = JSON.parse(result.seasonsContent);
    expect(seasons.seasons[1]).toMatchObject({ id: "season_old_aaaa", status: "completed" });
  });

  it("leaves an already-resolved prior season (not active) untouched", () => {
    const existingSeasons = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
      current_season_id: "season_old_aaaa",
      seasons: [
        {
          id: "season_old_aaaa",
          name: "Old Season",
          start_date: "2026-01-01",
          end_date: "2026-06-01",
          status: "completed",
        },
      ],
    });
    const result = applySeasonStart(
      existingSeasons,
      null,
      SEASON_INPUT,
      "2026-08-18",
      "t1",
      new Date("2026-08-18T10:00:00Z"),
    );
    const seasons = JSON.parse(result.seasonsContent);
    expect(seasons.seasons[1]).toMatchObject({ id: "season_old_aaaa", status: "completed" });
  });
});

describe("applyQuestCreate", () => {
  const EXISTING = JSON.stringify({
    version: 1,
    _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
    weekly_targets: {},
    main_quest: {
      id: "mq_old_aaaa",
      name: "Old Goal",
      type: "count_target",
      target: 10,
      season_id: "season_old_aaaa",
    },
    quests: [
      {
        id: "q_old_bbbb",
        name: "Old habit",
        type: "daily_streak",
        start_date: "2026-01-01",
        end_date: null,
        status: "active",
        source: "athlete",
      },
    ],
  });

  it("appends new quests with source model, never touching main_quest", () => {
    const result = JSON.parse(
      applyQuestCreate(
        EXISTING,
        {
          quests: [{ name: "Stretch daily", type: "daily_streak", polarity: "default_done" }],
        },
        "2026-08-18",
        "t1",
        new Date("2026-08-18T10:00:00Z"),
      ),
    );
    // main_quest is untouched - quest_create has no field to set it with.
    expect(result.main_quest.id).toBe("mq_old_aaaa");
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

  it("keeps the existing main_quest untouched, only appending quests", () => {
    const result = JSON.parse(
      applyQuestCreate(
        EXISTING,
        { quests: [{ name: "Read daily", type: "daily_streak" }] },
        "2026-08-18",
        "t1",
        new Date("2026-08-18T10:00:00Z"),
      ),
    );
    expect(result.main_quest.id).toBe("mq_old_aaaa");
    expect(result.quests).toHaveLength(2);
  });

  it("round-trips an explicit main_quest: null on file when none is given", () => {
    const existingNoMainQuest = JSON.stringify({
      version: 1,
      _meta: { updated_at: "2026-08-01", updated_by: "model", trace_id: "old" },
      weekly_targets: {},
      main_quest: null,
      quests: [],
    });
    const result = JSON.parse(
      applyQuestCreate(
        existingNoMainQuest,
        { quests: [{ name: "Read daily", type: "daily_streak" }] },
        "2026-08-18",
        "t1",
        new Date("2026-08-18T10:00:00Z"),
      ),
    );
    expect(result.main_quest).toBeNull();
    expect(result.quests).toHaveLength(1);
  });

  it("succeeds with a quests-only create when no main_quest is given and none is on file", () => {
    const result = JSON.parse(
      applyQuestCreate(
        null,
        { quests: [{ name: "Read daily", type: "daily_streak" }] },
        "2026-08-18",
        "t1",
        new Date("2026-08-18T10:00:00Z"),
      ),
    );
    expect(result.main_quest).toBeNull();
    expect(result.quests).toHaveLength(1);
    expect(result.quests[0]).toMatchObject({ name: "Read daily", type: "daily_streak" });
  });
});
