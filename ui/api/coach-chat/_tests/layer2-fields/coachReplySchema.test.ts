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
    expect(props.memory_update.properties.text).toMatchObject({ maxLength: MEMORY_NOTE_TEXT_CAP });
  });

  it("caps injury_event[].text at INJURY_FLAG_TEXT_CAP", () => {
    const props = generationConfigFor("closing", false).responseSchema.properties;
    expect(props.injury_event.items.properties.text).toMatchObject({ maxLength: INJURY_FLAG_TEXT_CAP });
  });
});
