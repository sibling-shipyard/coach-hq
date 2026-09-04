import { describe, it, expect } from "vitest";
import { generationConfigFor } from "../../_lib/gemini/coachReplySchema.js";
import { MEMORY_NOTE_TEXT_CAP, INJURY_FLAG_TEXT_CAP } from "../../_lib/text-caps.bundle.js";

// Issue #462, layer 1: the Gemini responseSchema carries maxLength for the free-text fields it
// actually exposes, sourced from engine/lib/text-caps.mts so the numbers can't drift from the
// write-time backstop in turnWrites/*.ts.
describe("coachReplySchema text caps", () => {
  it("caps memory_update.text at MEMORY_NOTE_TEXT_CAP", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    const memoryUpdate = props.memory_update as { properties: { text: unknown } };
    expect(memoryUpdate.properties.text).toMatchObject({ maxLength: MEMORY_NOTE_TEXT_CAP });
  });

  it("caps injury_event[].text at INJURY_FLAG_TEXT_CAP", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    const injuryEvent = props.injury_event as { items: { properties: { text: unknown } } };
    expect(injuryEvent.items.properties.text).toMatchObject({
      maxLength: INJURY_FLAG_TEXT_CAP,
    });
  });

  it("caps injury_flag[].text at INJURY_FLAG_TEXT_CAP", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    const injuryFlag = props.injury_flag as { items: { properties: { text: unknown } } };
    expect(injuryFlag.items.properties.text).toMatchObject({
      maxLength: INJURY_FLAG_TEXT_CAP,
    });
  });
});

// C1: the closing-turn concept is gone - every returning-athlete turn now gets the same action
// fields, data-fact and session-artifact alike, instead of the old ordinary/closing split (#616
// unlocked the data-fact half only; this finishes the job for the session-artifact half).
describe("coachReplySchema returning-athlete action fields", () => {
  it("includes both data-fact and session-artifact fields on any returning-athlete turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        "memory_update",
        "sports_update",
        "injury_flag",
        "injury_event",
        "quest_event",
        "profile_update",
        "template_edit",
        "session_plan",
        "week_plan",
        "session_reconcile",
        "plan_edit",
      ]),
    );
  });

  // coach_note is day-keyed (coachIntents.ts's applyCoachNote), available on every
  // returning-athlete turn.
  it("includes coach_note on a returning-athlete turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).toContain("coach_note");
  });
});

// B3: quest_create and season_start were FSP-only until now - a returning athlete could never
// start a new season or set a new goal through chat, on any turn. They join the same
// always-available data-fact set memory_update/profile_update already got in A1/B1.
describe("coachReplySchema returning-athlete season/quest access (B3)", () => {
  it("includes season_start and quest_create on a returning, non-first-session turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["season_start", "quest_create"]));
  });

  it("season_start's payload carries main_quest, required alongside name/start_date/end_date", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    const seasonStart = props.season_start as unknown as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(seasonStart.properties)).toEqual(
      expect.arrayContaining(["name", "start_date", "end_date", "main_quest"]),
    );
    expect(seasonStart.required).toEqual(
      expect.arrayContaining(["name", "start_date", "end_date", "main_quest"]),
    );
  });

  it("quest_create is habit quests only - main_quest is structurally not a valid field on it", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    const questCreate = props.quest_create as { properties: Record<string, unknown> };
    expect(Object.keys(questCreate.properties)).toEqual(["quests"]);
    expect(questCreate.properties.main_quest).toBeUndefined();
  });

  // Regression: main_quest can only ever change together with a season change - this must be
  // structurally impossible even if Gemini attempted the old shape, not just discouraged in the
  // prompt. Confirmed two ways: quest_create's schema has no main_quest field at all (above), and
  // season_start requires main_quest, so a goal-less season is equally impossible.
  it("makes a goal change without a season change structurally impossible on any turn", () => {
    for (const firstSession of [true, false]) {
      const props = generationConfigFor("ordinary", firstSession).responseSchema.properties;
      if (!props.quest_create) continue;
      const questCreate = props.quest_create as { properties: Record<string, unknown> };
      expect(questCreate.properties.main_quest).toBeUndefined();
    }
  });
});

// D1 layer 1 (#736): quest_id/flag_id are referential-id fields free of any static enum -
// exactly the class of bug #693 (Gemini inventing an id). When the athlete's actual current ids
// are passed in, they become a real `enum`, making a hallucinated id structurally impossible to
// generate in the common case.
describe("coachReplySchema dynamic reference-id enums (D1 #736, layer 1)", () => {
  it("builds quest_event.quest_id as an enum of the athlete's actual current quest ids", () => {
    const props = generationConfigFor("ordinary", false, {
      questIds: ["q1", "q2"],
    }).responseSchema.properties;
    const questEvent = props.quest_event as { items: { properties: { quest_id: unknown } } };
    expect(questEvent.items.properties.quest_id).toMatchObject({ enum: ["q1", "q2"] });
  });

  it("builds injury_event.flag_id as an enum of the athlete's actual current injury flag ids", () => {
    const props = generationConfigFor("ordinary", false, {
      injuryFlagIds: ["inj_a", "inj_b"],
    }).responseSchema.properties;
    const injuryEvent = props.injury_event as { items: { properties: { flag_id: unknown } } };
    expect(injuryEvent.items.properties.flag_id).toMatchObject({ enum: ["inj_a", "inj_b"] });
  });

  it("leaves quest_id/flag_id as plain free-text fields when no ids are given (no ids to constrain to)", () => {
    const withoutIds = generationConfigFor("ordinary", false).responseSchema.properties;
    const questEvent = withoutIds.quest_event as { items: { properties: { quest_id: unknown } } };
    expect(questEvent.items.properties.quest_id).not.toHaveProperty("enum");
  });

  it("leaves quest_id/flag_id as plain free-text fields when the athlete has none yet (empty enum is unsatisfiable)", () => {
    const props = generationConfigFor("ordinary", false, {
      questIds: [],
      injuryFlagIds: [],
    }).responseSchema.properties;
    const questEvent = props.quest_event as { items: { properties: { quest_id: unknown } } };
    expect(questEvent.items.properties.quest_id).not.toHaveProperty("enum");
  });

  it("does not mutate the shared schema shape across calls with different athletes' ids", () => {
    const first = generationConfigFor("ordinary", false, { questIds: ["q1"] });
    const second = generationConfigFor("ordinary", false, { questIds: ["q2"] });
    const firstQuestEvent = first.responseSchema.properties.quest_event as {
      items: { properties: { quest_id: { enum: string[] } } };
    };
    expect(firstQuestEvent.items.properties.quest_id.enum).toEqual(["q1"]);
    const secondQuestEvent = second.responseSchema.properties.quest_event as {
      items: { properties: { quest_id: { enum: string[] } } };
    };
    expect(secondQuestEvent.items.properties.quest_id.enum).toEqual(["q2"]);
  });
});
