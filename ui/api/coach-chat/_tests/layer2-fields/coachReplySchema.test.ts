import { describe, it, expect } from "vitest";
import { generationConfigFor } from "../../_lib/coachReplySchema.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "../../_lib/text-caps.bundle.js";

// Issue #462, layer 1: the Gemini responseSchema carries maxLength for the three free-text
// fields, sourced from engine/lib/text-caps.mts so the numbers can't drift from the write-time
// backstop in turnWrites/*.ts.
describe("coachReplySchema text caps", () => {
  it("caps coach_note at COACH_LOG_TEXT_CAP on a returning close", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    expect(props.coach_note).toMatchObject({ maxLength: COACH_LOG_TEXT_CAP });
  });

  it("caps memory_update.text at MEMORY_NOTE_TEXT_CAP", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    const memoryUpdate = props.memory_update as { properties: { text: unknown } };
    expect(memoryUpdate.properties.text).toMatchObject({ maxLength: MEMORY_NOTE_TEXT_CAP });
  });

  it("caps injury_event[].text at INJURY_FLAG_TEXT_CAP", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    const injuryEvent = props.injury_event as { items: { properties: { text: unknown } } };
    expect(injuryEvent.items.properties.text).toMatchObject({
      maxLength: INJURY_FLAG_TEXT_CAP,
    });
  });

  it("caps injury_flag[].text at INJURY_FLAG_TEXT_CAP", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    const injuryFlag = props.injury_flag as { items: { properties: { text: unknown } } };
    expect(injuryFlag.items.properties.text).toMatchObject({
      maxLength: INJURY_FLAG_TEXT_CAP,
    });
  });
});

// #616: a returning athlete's ordinary (non-closing) turn used to get zero action fields at
// all - the schema structurally forbade Gemini from ever producing a data-fact write outside a
// close. A1 unlocks the data-fact subset on every turn; session artifacts stay closing-gated.
describe("coachReplySchema returning-athlete action fields", () => {
  it("unlocks data-fact fields on a returning, non-closing (ordinary) turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        "memory_update",
        "sports_update",
        "injury_flag",
        "injury_event",
        "quest_event",
        "profile_update",
      ]),
    );
  });

  it("keeps session-artifact fields and coach_note off a returning, ordinary turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).not.toEqual(
      expect.arrayContaining([
        "coach_note",
        "template_edit",
        "session_plan",
        "week_plan",
        "session_reconcile",
        "plan_edit",
      ]),
    );
  });

  it("still includes coach_note and session-artifact fields on a returning closing turn", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining([
        "coach_note",
        "memory_update",
        "template_edit",
        "session_plan",
        "week_plan",
        "session_reconcile",
        "plan_edit",
      ]),
    );
  });
});

// B3: quest_create and season_start were FSP-only until now - a returning athlete could never
// start a new season or set a new goal through chat, on any turn. They join the same
// always-available data-fact set memory_update/profile_update already got in A1/B1.
describe("coachReplySchema returning-athlete season/quest access (B3)", () => {
  it("includes season_start and quest_create on a returning, non-first-session, non-closing turn", () => {
    const props = generationConfigFor("ordinary", false).responseSchema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["season_start", "quest_create"]));
  });

  it("includes season_start and quest_create on a returning, non-first-session closing turn too", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
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
    for (const mode of ["ordinary", "closing"] as const) {
      for (const firstSession of [true, false]) {
        const props = generationConfigFor(mode, firstSession).responseSchema.properties;
        if (!props.quest_create) continue;
        const questCreate = props.quest_create as { properties: Record<string, unknown> };
        expect(questCreate.properties.main_quest).toBeUndefined();
      }
    }
  });
});
