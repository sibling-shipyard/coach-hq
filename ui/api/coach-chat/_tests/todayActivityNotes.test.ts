import { describe, it, expect, vi } from "vitest";
import { loadTodayActivityNotes } from "../_lib/decide/todayActivityNotes.js";
import type { ChatMessage } from "../_lib/chatThreads.js";

// #1147: the ordinary reply-turn pipeline re-reads user_data/activities/hist/*.json fresh, on
// every turn, for whatever activity in the client-echoed synced_activity_list attachment landed
// on the athlete's current calendar day - this is what lets a note the athlete writes mid-
// conversation reach the coach without a full regenerate.
describe("loadTodayActivityNotes", () => {
  const UUID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";

  function syncMessage(rows: { id: string; start: string; title: string }[]): ChatMessage {
    return {
      id: "c-1",
      role: "coach",
      paragraphs: ["Nice work."],
      attachments: [
        {
          version: 1,
          kind: "synced_activity_list",
          batch_id: "batch-1",
          activities: rows.map((r) => ({
            id: r.id,
            title: r.title,
            sport: "Badminton",
            start: r.start,
            duration_s: 3600,
            load: null,
          })),
        },
      ],
    };
  }

  function histFile(uuid: string, description: string): string {
    return JSON.stringify({ source: "healthkit", id: uuid, description });
  }

  function deps(files: Record<string, string>) {
    return {
      listActivityFiles: vi.fn(async () =>
        Object.keys(files).map((path) => ({ name: path.split("/").pop()!, path })),
      ),
      readFile: vi.fn(async (path: string) => files[path] ?? null),
    };
  }

  it("includes a synced-today activity with a note", async () => {
    const priorMessages = [
      syncMessage([{ id: UUID, start: "2026-09-16T08:00:00", title: "Morning badminton" }]),
    ];
    const files = { [`user_data/activities/hist/hk_2026-09-16_${UUID}.json`]: histFile(UUID, "Played my old rival.") };
    const notes = await loadTodayActivityNotes(priorMessages, "2026-09-16", deps(files));
    expect(notes).toEqual([
      { activity_id: `healthkit:${UUID}`, title: "Morning badminton", note: "Played my old rival." },
    ]);
  });

  it("omits a synced-today activity with an empty or missing note", async () => {
    const priorMessages = [
      syncMessage([{ id: UUID, start: "2026-09-16T08:00:00", title: "Morning badminton" }]),
    ];
    const files = { [`user_data/activities/hist/hk_2026-09-16_${UUID}.json`]: histFile(UUID, "   ") };
    const notes = await loadTodayActivityNotes(priorMessages, "2026-09-16", deps(files));
    expect(notes).toEqual([]);
  });

  it("omits an older-day activity in the same attachment", async () => {
    const priorMessages = [
      syncMessage([{ id: UUID, start: "2026-09-15T08:00:00", title: "Yesterday's session" }]),
    ];
    const files = { [`user_data/activities/hist/hk_2026-09-15_${UUID}.json`]: histFile(UUID, "A note.") };
    const d = deps(files);
    const notes = await loadTodayActivityNotes(priorMessages, "2026-09-16", d);
    expect(notes).toEqual([]);
    // Older-day rows are filtered before any file read is attempted.
    expect(d.listActivityFiles).not.toHaveBeenCalled();
  });

  it("is a strict no-op with no synced_activity_list attachment at all", async () => {
    const priorMessages: ChatMessage[] = [
      { id: "u-1", role: "user", text: "How should I warm up today?" },
      { id: "c-1", role: "coach", paragraphs: ["Easy spin, then dynamic stretches."] },
    ];
    const listActivityFiles = vi.fn();
    const notes = await loadTodayActivityNotes(priorMessages, "2026-09-16", {
      listActivityFiles,
      readFile: vi.fn(),
    });
    expect(notes).toEqual([]);
    expect(listActivityFiles).not.toHaveBeenCalled();
  });

  it("reflects a note added between turns - no caching across calls", async () => {
    const priorMessages = [
      syncMessage([{ id: UUID, start: "2026-09-16T08:00:00", title: "Morning badminton" }]),
    ];
    const path = `user_data/activities/hist/hk_2026-09-16_${UUID}.json`;
    const files: Record<string, string> = { [path]: histFile(UUID, "") };
    const d = deps(files);

    const beforeNote = await loadTodayActivityNotes(priorMessages, "2026-09-16", d);
    expect(beforeNote).toEqual([]);

    // Athlete writes a note on iOS mid-conversation - the underlying file content changes.
    files[path] = histFile(UUID, "Opponent played left-handed, I need to adjust my serve.");
    const afterNote = await loadTodayActivityNotes(priorMessages, "2026-09-16", d);
    expect(afterNote).toEqual([
      {
        activity_id: `healthkit:${UUID}`,
        title: "Morning badminton",
        note: "Opponent played left-handed, I need to adjust my serve.",
      },
    ]);
  });
});
