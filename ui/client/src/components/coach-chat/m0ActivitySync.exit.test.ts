import { describe, expect, it } from "vitest";
import {
  coachMessageHasCopy,
  findClientActivity,
  normalizeThread,
  qualifiedActivityId,
  retryActivityIdsFromThread,
  syncedActivityList,
  type ChatAttachment,
  type ChatThread,
  type SyncedActivityListAttachment,
} from "./coachChatModel";
import fixture from "./m0ActivitySync.fixture.json";

const attachment = fixture.attachment as SyncedActivityListAttachment;

function threadFrom(paragraphs: string[]): ChatThread {
  return {
    id: "thread-m0",
    dayOffset: 0,
    title: "2 sessions synced",
    preview: paragraphs[0] ?? "",
    ageLabel: "NOW",
    messages: [
      { id: "d-1", role: "divider", label: "TODAY" },
      {
        id: "c-1",
        role: "coach",
        paragraphs,
        attachments: [attachment],
      },
    ],
  };
}

describe("M0 exit proof — persisted sync turn", () => {
  it("one multi-activity list and one Coach reply, no user turn", () => {
    const persisted = normalizeThread(threadFrom([fixture.coach_reply]));
    const coach = persisted.messages.find((message) => message.role === "coach");
    if (!coach || coach.role !== "coach") throw new Error("expected a coach message");
    expect(persisted.messages.filter((message) => message.role === "user")).toEqual([]);
    expect(persisted.messages.filter((message) => message.role === "coach")).toHaveLength(1);
    expect(coach.paragraphs).toEqual([fixture.coach_reply]);
    expect(syncedActivityList(coach.attachments)).toEqual(attachment);
    expect(attachment.activities).toHaveLength(2);
  });

  it("Retry is offered only on a list-only failure, never after the reply lands", () => {
    const persisted = threadFrom([fixture.coach_reply]);
    const failed = threadFrom([]);
    const failedCoach = failed.messages.find((message) => message.role === "coach");
    if (!failedCoach || failedCoach.role !== "coach") throw new Error("expected a coach message");
    expect(retryActivityIdsFromThread(persisted)).toBeNull();
    expect(retryActivityIdsFromThread(failed)).toEqual(fixture.activity_ids);
    expect(coachMessageHasCopy(failedCoach)).toBe(false);
  });

  it("card values stay on the reread rows; Gemini-invented measurements never join the list", () => {
    const invented: ChatAttachment = {
      version: 1,
      kind: "future_widget",
      ...fixture.gemini_invented,
    };
    const list = syncedActivityList([invented, attachment]);
    expect(list?.activities.map((row) => row.id)).toEqual(attachment.activities.map((row) => row.id));
    expect(JSON.stringify(list)).not.toContain(fixture.gemini_invented.title);
    expect(JSON.stringify(list)).not.toContain(fixture.gemini_invented.id);
    for (const row of attachment.activities) {
      const client = findClientActivity(fixture.client_activities, row.id);
      expect(client?.name).toBe(row.title);
      expect(client?.sport_type).toBe(row.sport);
      expect(client?.start_date_local).toBe(row.start);
      expect(client?.elapsed_time).toBe(row.duration_s);
    }
  });

  it("each persisted row deep-links to the matching client activity by id", () => {
    for (const row of attachment.activities) {
      const client = findClientActivity(fixture.client_activities, qualifiedActivityId(row.id));
      expect(client?.id).toBe(row.id);
      expect(findClientActivity(fixture.client_activities, "missing")).toBeUndefined();
    }
  });
});
