import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, shouldSendEndConversation, updatePendingEndThreads } from "./coachChatModel";

describe("sendMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the explicit close flag and returns fresh profile completeness", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: "One last check before we close.",
          closed: false,
          stale: false,
          profileComplete: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessage("thread-1", [], "", true);

    expect(result.profileComplete).toBe(true);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      threadId: "thread-1",
      message: "",
      endConversationRequested: true,
    });
  });
});

describe("explicit close pending state", () => {
  it("keeps follow-up replies in closing mode for only the requested thread", () => {
    const pending = updatePendingEndThreads(new Set<string>(), "thread-1", true);
    expect(shouldSendEndConversation(pending, "thread-1", false)).toBe(true);
    expect(shouldSendEndConversation(pending, "thread-2", false)).toBe(false);
  });

  it("clears only after the requested thread closes", () => {
    const pending = new Set(["thread-1", "thread-2"]);
    expect(updatePendingEndThreads(pending, "thread-1", false)).toEqual(new Set(["thread-2"]));
    expect(pending).toEqual(new Set(["thread-1", "thread-2"]));
  });
});
