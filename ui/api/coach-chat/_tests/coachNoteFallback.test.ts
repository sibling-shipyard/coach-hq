import { describe, expect, it } from "vitest";
import { synthesizeRequiredCoachNote } from "../_lib/turnReplyValidation.js";
import type { LlmReply } from "../_lib/llm/coachReplySchema.js";

// A coach_note the model failed to write must never leave coach_log with a hole, and the fallback
// may only state what the fields already record.
const reply = (overrides: Partial<LlmReply>): LlmReply =>
  ({ reply: "ok", ...overrides }) as LlmReply;

describe("synthesizeRequiredCoachNote", () => {
  it("builds a note from profile_update entries", () => {
    expect(
      synthesizeRequiredCoachNote(
        reply({ profile_update: [{ field: "weight_kg", value: "72" }] as never }),
      ),
    ).toBe("Auto-note (no note from the model): recorded profile weight_kg = 72.");
  });

  it("names other required-note actions and counts repeats", () => {
    expect(
      synthesizeRequiredCoachNote(
        reply({
          injury_event: [{}, {}] as never,
          quest_event: [{}] as never,
        }),
      ),
    ).toBe("Auto-note (no note from the model): recorded injury_event x2; quest_event.");
  });

  it("returns nothing when the model wrote a note or no action needs one", () => {
    expect(
      synthesizeRequiredCoachNote(
        reply({
          coach_note: "Weighed in.",
          profile_update: [{ field: "weight_kg", value: "72" }] as never,
        }),
      ),
    ).toBeUndefined();
    expect(synthesizeRequiredCoachNote(reply({}))).toBeUndefined();
  });
});
