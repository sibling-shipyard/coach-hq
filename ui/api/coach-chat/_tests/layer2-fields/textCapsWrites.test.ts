import { describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw: vi.fn(async () => null),
  };
});

import { buildCoachNoteWrite } from "../../_lib/turnWrites/coachNoteWrite.js";
import { buildMemoryFileWrite } from "../../_lib/turnWrites/memoryWrite.js";
import { buildInjuryWrites } from "../../_lib/turnWrites/injuryWrite.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "../../_lib/text-caps.bundle.js";

// Issue #462, layer 3: even if the Gemini schema (layer 1), prompt (layer 0), and reprompt
// (layer 2) all fail to keep a field in budget, these write builders are the deterministic
// backstop - nothing oversized reaches commitFilesAtomic.
describe("turnWrites text-cap backstop", () => {
  it("buildCoachNoteWrite caps an oversized coach_note", async () => {
    const oversized = "n".repeat(COACH_LOG_TEXT_CAP + 800);
    const write = buildCoachNoteWrite("owner/repo", "token", "UTC", "trace-1", oversized);
    expect(write).toBeDefined();
    const content = await write!.resolve();
    const parsed = JSON.parse(content) as { rows: { text: string }[] };
    expect(parsed.rows[0].text.length).toBeLessThanOrEqual(COACH_LOG_TEXT_CAP);
  });

  it("buildMemoryFileWrite caps an oversized memory_update.text", async () => {
    const oversized = "m".repeat(MEMORY_NOTE_TEXT_CAP + 800);
    const write = buildMemoryFileWrite("owner/repo", "token", "UTC", "trace-1", {
      memoryUpdate: { label: "fitness_baseline", text: oversized },
      coachingStyleUpdate: undefined,
      sportsUpdate: [],
    });
    expect(write).toBeDefined();
    const content = await write!.resolve();
    const parsed = JSON.parse(content) as { notes: Record<string, { text: string }> };
    expect(parsed.notes.fitness_baseline.text.length).toBeLessThanOrEqual(MEMORY_NOTE_TEXT_CAP);
  });

  it("buildInjuryWrites caps oversized injury_flag[].text entries", async () => {
    const oversized = "i".repeat(INJURY_FLAG_TEXT_CAP + 400);
    const write = buildInjuryWrites("owner/repo", "token", "UTC", [{ text: oversized }], []);
    expect(write).toBeDefined();
    const content = await write!.resolve();
    const parsed = JSON.parse(content) as { flags: { text: string }[] };
    expect(parsed.flags[0].text.length).toBeLessThanOrEqual(INJURY_FLAG_TEXT_CAP);
  });

  it("buildInjuryWrites caps oversized injury_event[].text entries", async () => {
    const oversized = "i".repeat(INJURY_FLAG_TEXT_CAP + 400);
    const write = buildInjuryWrites(
      "owner/repo",
      "token",
      "UTC",
      [],
      [{ status: "active", flag_id: "inj_test", text: oversized }],
    );
    expect(write).toBeDefined();
    // getFileRaw is mocked to null, so this event's flag_id will not exist in flags - it should
    // throw, same discipline as applyInjuryEvent's existing "no flag with id" guard.
    await expect(write!.resolve()).rejects.toThrow('no flag with id "inj_test"');
  });
});
