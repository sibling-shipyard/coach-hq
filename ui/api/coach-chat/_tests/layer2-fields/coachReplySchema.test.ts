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
