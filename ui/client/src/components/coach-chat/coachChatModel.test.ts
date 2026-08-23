import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProactiveCoachMessage,
  materializeProactiveThread,
  parseProactiveSeed,
  resolveProactiveThread,
  selectProactiveCoachMessage,
  sendMessage,
  shouldSendEndConversation,
  updatePendingEndThreads,
  type ChatMessage,
} from "./coachChatModel";

const MESSAGE_ID = "cm-11111111-2222-4333-8444-555555555555";
const SEED_ID = `local-proactive-${MESSAGE_ID}`;
const EXACT_BODY = "The quiet work landed.  Nothing clever to add today, but I noticed.";

function widgetSnapshots() {
  return {
    schema_version: 1,
    generated_at: "2026-08-23T12:00:00.000Z",
    home: {
      coachMessage: {
        id: MESSAGE_ID,
        created_at: "2026-08-23T11:55:00.000Z",
        body: EXACT_BODY,
        conversation_seed_id: SEED_ID,
      },
    },
  };
}

describe("proactive Coach seed", () => {
  it("parses one valid seed and rejects absent, malformed, or repeated values", () => {
    expect(parseProactiveSeed(`?seed=${encodeURIComponent(SEED_ID)}`)).toBe(SEED_ID);
    expect(parseProactiveSeed("")).toBeNull();
    expect(parseProactiveSeed("?seed=local-proactive-not-a-message")).toBeNull();
    expect(parseProactiveSeed(`?seed=${SEED_ID}&seed=${SEED_ID}`)).toBeNull();
  });

  it("matches only the exact latest seed and preserves the exact body", () => {
    expect(selectProactiveCoachMessage(widgetSnapshots(), SEED_ID)).toEqual(
      widgetSnapshots().home.coachMessage,
    );
    expect(
      selectProactiveCoachMessage(
        widgetSnapshots(),
        "local-proactive-cm-99999999-2222-4333-8444-555555555555",
      ),
    ).toBeNull();
  });

  it("materializes one local thread with the seed id, divider, and exact Coach body", () => {
    const message = widgetSnapshots().home.coachMessage;
    const thread = materializeProactiveThread(message);

    expect(thread.id).toBe(SEED_ID);
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0]).toMatchObject({ role: "divider" });
    expect(thread.messages[1]).toEqual({
      id: expect.stringMatching(/^c-/),
      role: "coach",
      paragraphs: [EXACT_BODY],
    });
  });

  it("reuses cached messages for the same seed without adding another opener", () => {
    const cached: ChatMessage[] = [
      { id: "d-1787486100000", role: "divider", label: "TODAY" },
      { id: "c-1787486100000", role: "coach", paragraphs: [EXACT_BODY] },
      { id: "u-1787486160000", role: "user", text: "It felt controlled." },
    ];

    const thread = materializeProactiveThread(
      widgetSnapshots().home.coachMessage,
      cached,
    );

    expect(thread.messages).toBe(cached);
    expect(thread.messages.filter(({ role }) => role === "coach")).toHaveLength(1);
  });

  it("reopens an existing exact-seed thread before consulting the latest snapshot", () => {
    const existing = materializeProactiveThread(
      widgetSnapshots().home.coachMessage,
    );

    expect(resolveProactiveThread(SEED_ID, null, [existing])).toBe(existing);
    expect(
      resolveProactiveThread(
        SEED_ID,
        {
          ...widgetSnapshots().home.coachMessage,
          id: "cm-newer",
          conversation_seed_id: "local-proactive-cm-newer",
        },
        [existing],
      ),
    ).toBe(existing);
    expect(resolveProactiveThread(SEED_ID, null, [])).toBeNull();
  });

  it("fetches the snapshot contract and degrades unavailable data to normal fallback", async () => {
    const matchedFetcher = vi.fn(async () => Response.json(widgetSnapshots()));
    await expect(
      fetchProactiveCoachMessage(SEED_ID, matchedFetcher as typeof fetch),
    ).resolves.toEqual(widgetSnapshots().home.coachMessage);
    expect(matchedFetcher).toHaveBeenCalledWith(
      "/api/widget-snapshots",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const unavailableFetcher = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(
      fetchProactiveCoachMessage(SEED_ID, unavailableFetcher as typeof fetch),
    ).resolves.toBeNull();
  });
});

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
