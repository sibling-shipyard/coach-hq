import { describe, it, expect } from "vitest";
import { hasUnsavedContentMismatch } from "../coach-chat.js";

// B1 (docs/eng-docs/coach-chat-closing-followup.md): the mismatch heuristic that triggers a
// one-shot retry when a closing turn's `reasoning` describes real content but `file_updates`
// came back empty/absent. Confirmed necessary by a live repro (2026-08-14, coach-akash-suresh,
// traceId xuij2ft9) where Part A (schema reorder + broader close-trigger regex, #284) alone did
// not reliably prevent this.
describe("hasUnsavedContentMismatch", () => {
  it("matches the production repro reasoning (describes a real edit, file_updates empty)", () => {
    const reasoning =
      "Athlete explicitly requested to close the session. Today is Day 150. Concrete facts from " +
      "this check-in: post-badminton recovery day, foundation completed in the morning, general " +
      "fatigue from yesterday's 3.5h heat session but no injury or structural soreness flags. " +
      "Updating Recent Session Notes in state.md to drop the oldest entry and record Day 150.";
    expect(hasUnsavedContentMismatch(reasoning, [], undefined)).toBe(true);
    expect(hasUnsavedContentMismatch(reasoning, undefined, undefined)).toBe(true);
  });

  it("does not match a genuine 'nothing to save' reasoning, even if long", () => {
    const reasoning =
      "Athlete just said bye with no new training content this conversation - nothing concrete to " +
      "save, state.md already reflects everything discussed earlier today.";
    expect(hasUnsavedContentMismatch(reasoning, [], undefined)).toBe(false);
  });

  it("does not match an empty or missing reasoning", () => {
    expect(hasUnsavedContentMismatch("", [], undefined)).toBe(false);
    expect(hasUnsavedContentMismatch(undefined, [], undefined)).toBe(false);
    expect(hasUnsavedContentMismatch("   ", [], undefined)).toBe(false);
  });

  it("does not match short/terse reasoning under the length threshold", () => {
    expect(hasUnsavedContentMismatch("ok, nothing here", [], undefined)).toBe(false);
  });

  it("does not match when file_updates is actually non-empty", () => {
    const reasoning =
      "Real training content this turn: intervals completed, athlete felt strong - updating " +
      "state.md's Training Log section with the new entry.";
    expect(
      hasUnsavedContentMismatch(
        reasoning,
        [{ path: "user_data/coach/state.md", edits: [{ old_string: "a", new_string: "b" }] }],
        undefined,
      ),
    ).toBe(false);
  });

  // coach-commit-mvp: a non-trivial coach_note is now a fully legitimate, independent way to
  // satisfy a close - even with reasoning that would otherwise look like a mismatch and no
  // file_updates at all, a real coach_note means content WAS captured.
  it("does not match when a non-trivial coach_note is present, even with matching-mismatch reasoning and no file_updates", () => {
    const reasoning =
      "Athlete explicitly requested to close the session. Concrete facts from this check-in: ran " +
      "intervals, felt strong, no injury flags. Reporting this via coach_note instead of file_updates.";
    expect(
      hasUnsavedContentMismatch(reasoning, [], "Ran intervals, felt strong, no soreness. Resting tomorrow."),
    ).toBe(false);
    expect(
      hasUnsavedContentMismatch(reasoning, undefined, "Ran intervals, felt strong, no soreness. Resting tomorrow."),
    ).toBe(false);
  });

  it("still matches when coach_note is present but under the length threshold (trivial/placeholder)", () => {
    const reasoning =
      "Athlete explicitly requested to close the session. Concrete facts from this check-in: ran " +
      "intervals, felt strong, no injury flags. This needs saving somewhere.";
    expect(hasUnsavedContentMismatch(reasoning, [], "ok")).toBe(true);
    expect(hasUnsavedContentMismatch(reasoning, [], "")).toBe(true);
    expect(hasUnsavedContentMismatch(reasoning, [], "   ")).toBe(true);
  });
});
