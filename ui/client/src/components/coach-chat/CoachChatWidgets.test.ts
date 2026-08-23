import { describe, expect, it } from "vitest";
import { formatSyncRowMeta } from "./CoachChatWidgets";
import { syncedActivityList, type ChatAttachment, type SyncedActivityRow } from "./coachChatModel";

const row: SyncedActivityRow = {
  id: "abc",
  title: "Easy Run",
  sport: "Run",
  start: "2026-08-22T06:12:00",
  duration_s: 2400,
  load: 48,
};

describe("synced activity list widget helpers", () => {
  it("formats title meta without crashing on sparse rows", () => {
    expect(formatSyncRowMeta(row)).toContain("Run");
    expect(formatSyncRowMeta(row)).toContain("40m");
    expect(formatSyncRowMeta({ ...row, sport: "", start: "", duration_s: 0 })).toBe("0m");
  });

  it("ignores unknown attachment kinds and versions when picking the list", () => {
    const unknown: ChatAttachment = { version: 1, kind: "coach_plan_card" };
    const wrongVersion: ChatAttachment = { version: 9, kind: "synced_activity_list", activities: [row] };
    expect(syncedActivityList([unknown, wrongVersion])).toBeNull();
    expect(
      syncedActivityList([
        unknown,
        { version: 1, kind: "synced_activity_list", batch_id: "b", activities: [row] },
      ])?.activities,
    ).toEqual([row]);
  });
});
