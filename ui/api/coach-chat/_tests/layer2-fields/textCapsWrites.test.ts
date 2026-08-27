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
import { buildInjuryEventWrite } from "../../_lib/turnWrites/injuryWrite.js";
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
      sportsUpdate: [],
    });
    expect(write).toBeDefined();
    const content = await write!.resolve();
    const parsed = JSON.parse(content) as { notes: Record<string, { text: string }> };
    expect(parsed.notes.fitness_baseline.text.length).toBeLessThanOrEqual(MEMORY_NOTE_TEXT_CAP);
  });

  it("buildInjuryEventWrite caps oversized injury_event[].text entries", async () => {
    const oversized = "i".repeat(INJURY_FLAG_TEXT_CAP + 400);
    const write = buildInjuryEventWrite("owner/repo", "token", "UTC", [
      { status: "active", text: oversized },
    ]);
    expect(write).toBeDefined();
    const content = await write!.resolve();
    const parsed = JSON.parse(content) as { flags: { text: string }[] };
    expect(parsed.flags[0].text.length).toBeLessThanOrEqual(INJURY_FLAG_TEXT_CAP);
  });
});
