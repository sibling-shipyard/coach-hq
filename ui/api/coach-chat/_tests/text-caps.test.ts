import { describe, expect, it } from "vitest";
import {
  capText,
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "../../../../engine/lib/text-caps.mts";

describe("capText", () => {
  it("leaves a string under the cap unchanged", () => {
    expect(capText("short note", 100)).toBe("short note");
  });

  it("leaves a string exactly at the cap unchanged", () => {
    const value = "a".repeat(100);
    expect(capText(value, 100)).toBe(value);
  });

  it("truncates a string over the cap and appends the marker", () => {
    const value = "a".repeat(120);
    const result = capText(value, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith("… [truncated]")).toBe(true);
  });

  it("never exceeds the cap - boundary math", () => {
    // marker is 13 chars ("… [truncated]"); keep = cap - 13
    const value = "b".repeat(50);
    const result = capText(value, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toBe(`${"b".repeat(7)}… [truncated]`);
  });

  it("truncates on codepoints, not UTF-16 units - doesn't split an emoji surrogate pair", () => {
    // Each emoji below is a surrogate pair (2 UTF-16 units, 1 codepoint).
    const value = "🏃".repeat(30);
    const result = capText(value, 20);
    // No lone surrogate - the string round-trips through Array.from cleanly.
    expect(Array.from(result).every((ch) => ch.length === 1 || ch.length === 2)).toBe(true);
    expect(result.endsWith("… [truncated]")).toBe(true);
    // Codepoint count (not UTF-16 length) never exceeds the cap; each surviving emoji
    // still costs 2 UTF-16 units, so the raw .length can exceed 20 here.
    expect(Array.from(result).length).toBeLessThanOrEqual(20);
  });

  it("exposes the three cap constants from issue #462", () => {
    expect(COACH_LOG_TEXT_CAP).toBe(2000);
    expect(MEMORY_NOTE_TEXT_CAP).toBe(1500);
    expect(INJURY_FLAG_TEXT_CAP).toBe(500);
  });
});
