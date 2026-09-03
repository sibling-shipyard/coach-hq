import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activitySync,
  challengeDayNumber,
  CoachChatSaveFailedError,
  droppedActionToastMessage,
  fetchProactiveCoachMessage,
  fetchProfileStatus,
  materializeProactiveThread,
  normalizeThread,
  parseProactiveSeed,
  resolveProactiveThread,
  retryActivityIdsFromThread,
  selectProactiveCoachMessage,
  sendMessage,
  syncedActivityList,
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
  const ledger = {
    seasons: {
      current_season_id: "s1",
      seasons: [{ id: "s1", start_date: "2026-08-03" }],
    },
  };

  it("prefers profile.coach_since over season start_date", () => {
    const fromCoachSince = challengeDayNumber({ coach_since: "2026-03-17" }, ledger, now);
    const fromSeason = challengeDayNumber(null, ledger, now);
    expect(fromCoachSince).toBeGreaterThan(fromSeason);
    expect(fromCoachSince).toBeGreaterThan(100);
  });

  it("falls back to current season start_date when coach_since is absent", () => {
    const fromSeason = challengeDayNumber(null, ledger, now);
    expect(fromSeason).toBeGreaterThan(1);
    expect(fromSeason).toBeLessThan(40);
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

  it("returns the fresh committed thread list and profile completeness on every turn (C1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: "Noted, 76kg it is.",
          threadId: "thread-1",
          threads: [],
          stale: false,
          profileComplete: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessage("thread-1", [], "76kg this morning");

    expect(result.profileComplete).toBe(true);
    expect(result.threadId).toBe("thread-1");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    // The request body carries only threadId/messages/message/knownSha now (C1 removed the
    // End Conversation flag entirely).
    expect(Object.keys(JSON.parse(request.body as string)).sort()).toEqual([
      "message",
      "messages",
      "threadId",
    ]);
  });

  // D1 (#736): passes droppedActions straight through - CoachChat.tsx is what surfaces it.
  it("passes droppedActions through on the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: "Logged the weight, couldn't log the quest.",
          threadId: "thread-1",
          threads: [],
          profileComplete: true,
          droppedActions: [{ field: "quest_event", reason: 'no quest with id "q99"' }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMessage("thread-1", [], "did my run");

    expect(result.droppedActions).toEqual([
      { field: "quest_event", reason: 'no quest with id "q99"' },
    ]);
  });

  // D1 (#736): a 502 that carries `reply` alongside `error` means Gemini generated a reply but
  // the save failed - throws CoachChatSaveFailedError (carrying that reply) instead of a plain
  // Error, so the caller can show the reply instead of discarding it.
  it("throws CoachChatSaveFailedError, carrying the reply, when the error response includes one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Coach replied but saving failed: GitHub timeout",
          traceId: "trace-abc",
          reply: "Nice work today, rest up.",
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessage("thread-1", [], "done for today")).rejects.toMatchObject({
      name: "CoachChatSaveFailedError",
      reply: "Nice work today, rest up.",
      traceId: "trace-abc",
    });
  });

  it("throws a plain Error, not CoachChatSaveFailedError, when the error response has no reply", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: "Coach couldn't respond in time - try again in a moment." }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendMessage("thread-1", [], "hello")).rejects.toThrow(
      "Coach couldn't respond in time - try again in a moment.",
    );
    await expect(sendMessage("thread-1", [], "hello")).rejects.not.toBeInstanceOf(
      CoachChatSaveFailedError,
    );
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

describe("droppedActionToastMessage", () => {
  it("uses the soft copy for a pure validation drop - data committed, one reference was bad", () => {
    expect(
      droppedActionToastMessage([
        { field: "quest_event", reason: "no such quest", kind: "validation" },
      ]),
    ).toBe("Coach couldn't quite save one of your updates - it wasn't lost, just skipped");
  });

  it("uses the honest copy when any dropped action is a commit_failure - data genuinely never saved", () => {
    expect(
      droppedActionToastMessage([
        {
          field: "user_data/coach/profile.json",
          reason: "save failed: 500",
          kind: "commit_failure",
        },
      ]),
    ).toBe("Coach's reply saved, but one of your updates didn't - try mentioning it again");
  });

  it("treats an absent kind as validation (server default)", () => {
    expect(droppedActionToastMessage([{ field: "quest_event", reason: "no such quest" }])).toBe(
      "Coach couldn't quite save one of your updates - it wasn't lost, just skipped",
    );
  });
});
