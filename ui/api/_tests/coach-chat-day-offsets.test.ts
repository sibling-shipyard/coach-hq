import { describe, it, expect, vi, afterEach } from "vitest";
import { withComputedDayOffsets, type ChatThread } from "../coach-chat.js";

// Regression coverage for the stale ageLabel bug: ageLabel used to be written once as the
// literal string "NOW" at thread-creation/close time and never touched again, so an old thread
// kept saying "NOW" forever even once dayOffset had correctly moved on. withComputedDayOffsets
// now derives ageLabel from the freshly computed dayOffset on every read.
describe("withComputedDayOffsets", () => {
  const stateMdUTC = "- **Timezone:** UTC\n";

  function thread(overrides: Partial<ChatThread> = {}): ChatThread {
    return {
      id: "t-1",
      dayOffset: 0,
      title: "Some thread",
      preview: "preview text",
      ageLabel: "NOW",
      status: "active",
      messages: [],
      ...overrides,
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps ageLabel as NOW for a thread created today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
    const t = thread({ createdAt: new Date("2026-08-04T09:00:00Z").getTime() });
    const [result] = withComputedDayOffsets([t], stateMdUTC);
    expect(result.dayOffset).toBe(0);
    expect(result.ageLabel).toBe("NOW");
  });

  it("recomputes ageLabel to D-N for an old thread that was stuck at NOW", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    // Created 4 days earlier, but ageLabel was written once as "NOW" back then and never updated.
    const t = thread({ createdAt: new Date("2026-08-04T09:00:00Z").getTime(), ageLabel: "NOW" });
    const [result] = withComputedDayOffsets([t], stateMdUTC);
    expect(result.dayOffset).toBe(4);
    expect(result.ageLabel).toBe("D-4");
  });

  it("derives ageLabel consistently across multiple threads of different ages", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const threads = [
      thread({ id: "t-today", createdAt: new Date("2026-08-08T01:00:00Z").getTime() }),
      thread({ id: "t-yesterday", createdAt: new Date("2026-08-07T01:00:00Z").getTime() }),
      thread({ id: "t-week-old", createdAt: new Date("2026-08-01T01:00:00Z").getTime() }),
    ];
    const results = withComputedDayOffsets(threads, stateMdUTC);
    expect(results.map((r) => r.ageLabel)).toEqual(["NOW", "D-1", "D-7"]);
  });
});
