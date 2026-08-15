import { describe, it, expect } from "vitest";
import { appendCoachNote } from "../_lib/coach-chat/coachWrites.js";

// coach-commit-mvp (docs/eng-docs/coach-commit-mvp.md): the append-only write path for
// coach_notes.md - deliberately the simplest possible write strategy (no exact-match old_string,
// no JSON merge patch), so this pure function has almost nothing to get wrong.
describe("appendCoachNote", () => {
  it("appends a dated entry to existing content", () => {
    const current = "## 2026-08-01\nRan easy 5k, felt fine.";
    const result = appendCoachNote(current, "Ran intervals, felt strong.", "2026-08-14");
    expect(result).toBe("## 2026-08-01\nRan easy 5k, felt fine.\n\n## 2026-08-14\nRan intervals, felt strong.");
  });

  it("starts the file fresh when current content is null (file doesn't exist yet)", () => {
    const result = appendCoachNote(null, "First real note for this athlete.", "2026-08-14");
    expect(result).toBe("\n\n## 2026-08-14\nFirst real note for this athlete.");
  });

  it("trims surrounding whitespace off the note before appending", () => {
    const result = appendCoachNote("existing", "  padded on both sides  \n", "2026-08-14");
    expect(result).toBe("existing\n\n## 2026-08-14\npadded on both sides");
  });
});
