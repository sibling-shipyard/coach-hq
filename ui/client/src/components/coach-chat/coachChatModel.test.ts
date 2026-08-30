import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activitySync,
  challengeDayNumber,
  fetchProactiveCoachMessage,
  fetchProfileStatus,
  materializeProactiveThread,
  normalizeThread,
  parseProactiveSeed,
  resolveProactiveThread,
  retryActivityIdsFromThread,
  selectProactiveCoachMessage,
  sendMessage,
  shouldSendEndConversation,
  syncedActivityList,
  updatePendingEndThreads,
  type ChatAttachment,
  type ChatMessage,
  type ChatThread,
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

    const thread = materializeProactiveThread(widgetSnapshots().home.coachMessage, cached);

    expect(thread.messages).toBe(cached);
    expect(thread.messages.filter(({ role }) => role === "coach")).toHaveLength(1);
  });

  it("reopens an existing exact-seed thread before consulting the latest snapshot", () => {
    const existing = materializeProactiveThread(widgetSnapshots().home.coachMessage);

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

const listAttachment: ChatAttachment = {
  version: 1,
  kind: "synced_activity_list",
  batch_id: "batch-1",
  activities: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Easy Run",
      sport: "Run",
      start: "2026-08-22T06:12:00",
      duration_s: 2400,
      load: 48,
    },
  ],
};

function threadWithAttachments(attachments: ChatAttachment[]): ChatThread {
  return {
    id: "thread-1",
    dayOffset: 0,
    title: "Easy Run",
    preview: "Nice work.",
    ageLabel: "NOW",
    messages: [
      { id: "d-1", role: "divider", label: "TODAY" },
      { id: "c-1", role: "coach", paragraphs: ["Nice work."], attachments },
    ],
  };
}

describe("challengeDayNumber", () => {
  const now = new Date(2026, 7, 30); // local midnight Aug 30 2026

  it("prefers profile.coach_since over season start_date", () => {
    const ledger = {
      seasons: {
        current_season_id: "s1",
        seasons: [{ id: "s1", start_date: "2026-08-03" }],
      },
    };
    expect(challengeDayNumber({ coach_since: "2026-03-17" }, ledger, now)).toBe(166);
  });

  it("falls back to current season start_date when coach_since is absent", () => {
    const ledger = {
      seasons: {
        current_season_id: "s1",
        seasons: [{ id: "s1", start_date: "2026-08-03" }],
      },
    };
    expect(challengeDayNumber(null, ledger, now)).toBe(28);
  });
});

describe("fetchProfileStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns profileComplete and live coachSince", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ profileComplete: true, coachSince: "2026-03-17" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProfileStatus()).resolves.toEqual({
      profileComplete: true,
      coachSince: "2026-03-17",
    });
  });

  it("treats a missing coachSince field as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ profileComplete: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchProfileStatus()).resolves.toEqual({
      profileComplete: false,
      coachSince: null,
    });
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

describe("activitySync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs action activity_sync with the given activity_ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: "Nice work on Easy Run.",
          closed: false,
          duplicate: false,
          threadId: "thread-sync",
          threads: [threadWithAttachments([listAttachment])],
          profileComplete: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await activitySync(["hk:11111111-1111-1111-1111-111111111111"]);

    expect(result.closed).toBe(false);
    expect(result.duplicate).toBe(false);
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      action: "activity_sync",
      activity_ids: ["hk:11111111-1111-1111-1111-111111111111"],
    });
    const coach = result.threads[0]?.messages.find((m) => m.role === "coach");
    expect(coach && coach.role === "coach" ? coach.attachments : undefined).toEqual([
      listAttachment,
    ]);
  });
});

describe("attachments on a thread", () => {
  it("round-trips synced_activity_list through normalizeThread", () => {
    const normalized = normalizeThread(threadWithAttachments([listAttachment]));
    const coach = normalized.messages.find((m) => m.role === "coach");
    expect(coach && coach.role === "coach" ? coach.attachments : undefined).toEqual([
      listAttachment,
    ]);
    expect(
      syncedActivityList(coach && coach.role === "coach" ? coach.attachments : undefined),
    ).toEqual(listAttachment);
  });

  it("keeps unknown attachment kinds on the thread but ignores them in the list helper", () => {
    const unknown: ChatAttachment = { version: 1, kind: "future_widget", payload: { n: 1 } };
    const wrongVersion: ChatAttachment = {
      version: 2,
      kind: "synced_activity_list",
      batch_id: "nope",
      activities: [],
    };
    const normalized = normalizeThread(
      threadWithAttachments([unknown, wrongVersion, listAttachment]),
    );
    const coach = normalized.messages.find((m) => m.role === "coach");
    expect(coach && coach.role === "coach" ? coach.attachments : undefined).toEqual([
      unknown,
      wrongVersion,
      listAttachment,
    ]);
    expect(syncedActivityList([unknown, wrongVersion])).toBeNull();
    expect(syncedActivityList([unknown, listAttachment])).toEqual(listAttachment);
  });

  it("does not offer Retry once the Coach reply is on the turn", () => {
    expect(retryActivityIdsFromThread(threadWithAttachments([listAttachment]))).toBeNull();
  });

  it("offers Retry from a list-only pending turn", () => {
    const pending = threadWithAttachments([listAttachment]);
    pending.messages = [
      { id: "d-1", role: "divider", label: "TODAY" },
      { id: "c-1", role: "coach", paragraphs: [], attachments: [listAttachment] },
    ];
    expect(retryActivityIdsFromThread(pending)).toEqual([
      "hk:11111111-1111-1111-1111-111111111111",
    ]);
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
