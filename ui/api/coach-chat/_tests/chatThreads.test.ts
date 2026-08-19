import { describe, it, expect } from "vitest";
import { appendConversationTurn, serializeChatHistory, applyRetention, mergeThreadToFront, type ChatThread } from "../_lib/chatThreads.js";
import { withComputedDayOffsets } from "../_lib/coachDay.js";

// part3-rollout: chat_history.json no longer persists ageLabel/status/dayOffset - both are
// dead weight on disk (dayOffset/ageLabel get overwritten by withComputedDayOffsets on every
// read, status is confirmed always "active" in storage). These tests cover the two halves of
// that contract: what actually round-trips through the file, and what the API still hands back
// to the client.
function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: "t-1",
    createdAt: 1723834200000,
    title: "Morning check-in",
    preview: "Some preview text",
    messages: [{ id: "u-1", role: "user", text: "hey coach" }],
    ...overrides,
  };
}

describe("appendConversationTurn", () => {
  it("does not invent a user transcript message for an explicit button close", () => {
    const prior = [{ id: "u-1", role: "user" as const, text: "My draft stays unsent" }];
    const result = appendConversationTurn(
      prior,
      undefined,
      { id: "c-1", role: "coach", paragraphs: ["Anything else before we close?"] },
      { id: "d-1", role: "divider", label: "TODAY" },
    );
    expect(result).toEqual([...prior, { id: "c-1", role: "coach", paragraphs: ["Anything else before we close?"] }]);
  });
});

describe("serializeChatHistory", () => {
  it("writes _meta plus threads, with no ageLabel/status/dayOffset on any thread", () => {
    const raw = serializeChatHistory([thread()], "2026-08-18T00:00:00.000Z", "trace-abc");
    const parsed = JSON.parse(raw);

    expect(parsed._meta).toEqual({
      updated_at: "2026-08-18T00:00:00.000Z",
      updated_by: "coach",
      trace_id: "trace-abc",
    });
    expect(parsed.threads).toHaveLength(1);
    const persisted = parsed.threads[0];
    expect(persisted).toEqual({
      id: "t-1",
      createdAt: 1723834200000,
      title: "Morning check-in",
      preview: "Some preview text",
      messages: [{ id: "u-1", role: "user", text: "hey coach" }],
    });
    expect(persisted).not.toHaveProperty("ageLabel");
    expect(persisted).not.toHaveProperty("status");
    expect(persisted).not.toHaveProperty("dayOffset");
  });

  it("round-trips through JSON.parse with the threads array intact", () => {
    const threads = [thread({ id: "t-1" }), thread({ id: "t-2", createdAt: 1723920600000 })];
    const raw = serializeChatHistory(threads, "2026-08-18T00:00:00.000Z", "trace-xyz");
    const parsed = JSON.parse(raw) as { threads: ChatThread[] };
    expect(parsed.threads.map((t) => t.id)).toEqual(["t-1", "t-2"]);
  });
});

describe("mergeThreadToFront / applyRetention", () => {
  it("still work against the trimmed persisted shape", () => {
    const threads = [thread({ id: "t-1" }), thread({ id: "t-2" })];
    const merged = mergeThreadToFront(threads, thread({ id: "t-1", title: "Updated" }));
    expect(merged.map((t) => t.id)).toEqual(["t-1", "t-2"]);
    expect(merged[0].title).toBe("Updated");
    expect(applyRetention(merged)).toHaveLength(2);
  });
});

describe("withComputedDayOffsets (API response shape)", () => {
  it("adds dayOffset/ageLabel/status back for the client, computed fresh", () => {
    const [result] = withComputedDayOffsets([thread()], "UTC");
    expect(result).toMatchObject({
      id: "t-1",
      title: "Morning check-in",
      status: "active",
    });
    expect(typeof result.dayOffset).toBe("number");
    expect(typeof result.ageLabel).toBe("string");
  });
});
