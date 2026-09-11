import { beforeEach, describe, expect, it, vi } from "vitest";

const { commitFilesAtomic } = vi.hoisted(() => ({
  commitFilesAtomic: vi.fn(async (writes: { resolve?: () => Promise<string> }[]) => {
    for (const write of writes) await write.resolve?.();
    return { commitSha: "commit-sha" };
  }),
}));

vi.mock("../../../_lib/githubGitData.js", () => ({ commitFilesAtomic }));
// Templates manifest gets a real answer (tpl-1 valid) so a template_edit referencing it survives
// validateTemplateEdit's pre-check - every other path stays null, unchanged from before.
const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async (_repo: string, path: string) =>
    path.endsWith("_manifest.json") ? JSON.stringify({ template_ids: ["tpl-1"] }) : null,
  ),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return {
    ...original,
    getFileRaw,
    invalidateCoachContext: vi.fn(),
  };
});
vi.mock("../../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/chatThreads.js")>();
  return {
    ...original,
    loadChatHistory: vi.fn(async () => ({ version: 1, threads: [] })),
  };
});

import { buildTurnWrites, commitTurn, parseTurnRequest } from "../../_lib/coachTurn.js";

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "Done for today",
    geminiMessage: "Done for today",
    repo: "owner/repo",
    token: "token",
    apiKey: "key",
    currentSha: "old-sha",
    stale: false,
    context: {
      soul: "soul",
      profile: null,
      memory: null,
      injuries: null,
      coachLog: null,
      seasons: null,
      quests: null,
      progress: null,
      progressions: null,
      athleteInsights: null,
    },
    timezone: "UTC",
    athleteContext: "",
    questContext: "",
    firstSession: true,
    now: Date.now(),
    traceId: "trace-1",
    reply: { reply: "Good work." },
    finalReplyText: "Good work.",
    ...overrides,
  };
}

describe("coach turn stages", () => {
  beforeEach(() => {
    commitFilesAtomic.mockClear();
    getFileRaw.mockClear();
  });

  it("parses an ordinary message without carrying the transport body forward", async () => {
    const result = await parseTurnRequest(
      new Request("https://coach.test", {
        method: "POST",
        body: JSON.stringify({ message: "  Felt strong  ", messages: [] }),
      }),
    );
    expect(result).toMatchObject({
      trimmed: "Felt strong",
      priorMessages: [],
    });
  });

  it("builds only the writes represented by Gemini actions", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Logged.",
          injury_flag: [{ text: "Sore ankle" }],
        },
      }) as never,
    );
    // coach_note is dormant since C1 (see coachReplySchema.ts) - Gemini never sets it, so it
    // never appears in optionalWrites even though buildCoachNoteWrite still exists for C2.
    expect(turn.optionalWrites.map((write) => write.path)).toEqual([
      "user_data/coach/injuries.json",
    ]);
    expect(turn.chatWrite.path).toBe("user_data/coach/chat_history.json");
    await turn.chatWrite.resolve?.();
    expect(turn.latestThreads).toHaveLength(1);
  });

  // akash retest finding: a dropped action's reply text used to only get corrected in next
  // turn's coach_log context (formatDroppedActionsNote) - the athlete would see a false success
  // claim for one whole turn. finalReplyText is the fix: this same turn's reply (and the chat
  // message actually persisted to chat_history.json) both carry the correction.
  it("appends a same-turn correction to the reply when an action is dropped, not just coach_note", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        firstSession: false,
        validQuestIds: new Set<string>(),
        reply: {
          reply: "Marked that quest complete.",
          coach_note: "Quest completion reported.",
          quest_event: [{ quest_id: "q99", status: "completed" }],
        },
      }) as never,
    );
    expect(turn.droppedActions).toEqual([expect.objectContaining({ field: "quest_event" })]);
    // The reply commitTurn actually returns to the athlete this turn.
    expect(turn.finalReplyText).toBe(
      "Marked that quest complete.\n\n(Note: couldn't save quest_event - it didn't match anything on file.)",
    );
    // The persisted chat transcript carries the same correction, not the model's raw claim -
    // otherwise reopening this thread later would still show the uncorrected message.
    await turn.chatWrite.resolve?.();
    const coachMessage = turn.latestThreads[0]?.messages.find((m) => m.role === "coach");
    expect(
      coachMessage && "paragraphs" in coachMessage ? coachMessage.paragraphs : undefined,
    ).toEqual([turn.finalReplyText]);
    // coach_note (next turn's context) still gets its own, differently-worded system note too -
    // this fix is additive, not a replacement for the existing next-turn mechanism.
    const coachNoteWrite = turn.optionalWrites.find(
      (write) => write.path === "user_data/coach/coach_log.json",
    );
    expect(coachNoteWrite).toBeDefined();
  });

  // C1: template_edit/session_plan/week_plan/session_reconcile/plan_edit are available on any
  // returning-athlete turn now, not gated to a closing turn any more - this turn has no close
  // signal at all (there's no such concept left to signal). Also exercises the lazy
  // templates-manifest fetch (correction #4): it only fires because this reply asked for
  // template_edit.
  it("commits a template_edit on an ordinary turn, no close signal needed", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        firstSession: false,
        reply: {
          reply: "Removing that phase.",
          template_edit: { template_id: "tpl-1" },
        },
      }) as never,
    );
    expect(turn.optionalWrites.map((write) => write.path)).toContain(
      "user_data/activities/workout_plans/templates/tpl-1.json",
    );
    // The manifest fetch only happens because this reply carried template_edit - an ordinary
    // turn with none of the session-artifact fields never pays for it (see the earlier test).
    expect(getFileRaw).toHaveBeenCalledWith(
      "owner/repo",
      "user_data/activities/workout_plans/templates/_manifest.json",
      "token",
    );
  });

  // Bug 3 Primary (2026-09-10 pro baseline): a real conversation showed the coach ask a genuine
  // clarifying question, never get an answer, then unilaterally overwrite a real scheduled
  // session anyway. requestCoachReply sets stillUnconfirmedAssumption when its own reprompt
  // couldn't resolve it - these tests confirm buildTurnWrites actually holds back the write.
  describe("stillUnconfirmedAssumption (Bug 3 Primary)", () => {
    const currentWeekContent = JSON.stringify({
      schema_version: 1,
      data_status: "live",
      timezone: "UTC",
      week: { id: "2026-W37", start_date: "2026-09-07", end_date: "2026-09-13" },
      coach_read: null,
      days: [
        {
          date: "2026-09-12",
          sessions: [
            {
              id: "s_saturday",
              discipline: "football",
              kind: "match",
              title: "Football - away game",
              status: "planned",
            },
          ],
        },
      ],
      coach_comments: [],
      updated_at: "2026-09-10T00:00:00.000Z",
      updated_by: "model",
      trace_id: "seed",
    });

    it("drops a plan_edit when stillUnconfirmedAssumption is set", async () => {
      const turn = await buildTurnWrites(
        baseTurn({
          firstSession: false,
          validQuestIds: new Set<string>(),
          prefetchedCurrentWeekContent: currentWeekContent,
          stillUnconfirmedAssumption: "dropping football or doing both?",
          reply: {
            reply: "Done, swapped it for a walk.",
            coach_note: "Swapped Saturday.",
            plan_edit: [
              {
                session_id: "s_saturday",
                discipline: "walk",
                kind: "recovery",
                title: "Easy Walk",
              },
            ],
          },
        }) as never,
      );
      expect(turn.droppedActions).toEqual([
        expect.objectContaining({
          field: "plan_edit",
          reason: expect.stringContaining("unresolved"),
        }),
      ]);
      expect(turn.optionalWrites.map((write) => write.path)).not.toContain(
        "user_data/ledger/current_week.json",
      );
    });

    it("commits the plan_edit normally when stillUnconfirmedAssumption is not set", async () => {
      const turn = await buildTurnWrites(
        baseTurn({
          firstSession: false,
          validQuestIds: new Set<string>(),
          // Explicit confirmation cue in the raw message - isolates this test to the
          // stillUnconfirmedAssumption dimension only, distinct from the independent Bug 3
          // Fallback content-diff guard (validateActions.ts), which would otherwise also drop a
          // category-changing edit with no confirmation cue regardless of this field.
          trimmed: "Yes, swap it for a walk instead.",
          geminiMessage: "Yes, swap it for a walk instead.",
          prefetchedCurrentWeekContent: currentWeekContent,
          reply: {
            reply: "Done, swapped it for a walk.",
            coach_note: "Swapped Saturday.",
            plan_edit: [
              {
                session_id: "s_saturday",
                discipline: "walk",
                kind: "recovery",
                title: "Easy Walk",
              },
            ],
          },
        }) as never,
      );
      expect(turn.droppedActions).toEqual([]);
      expect(turn.optionalWrites.map((write) => write.path)).toContain(
        "user_data/ledger/current_week.json",
      );
    });
  });

  it("commits incremental First Session writes on an ordinary turn", async () => {
    const response = await commitTurn({
      ...baseTurn(),
      wasProfileComplete: false,
      profileComplete: false,
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [],
      latestThreads: [],
      finalThreadId: "thread-1",
      computedTitle: "Felt strong",
    } as never);
    expect(commitFilesAtomic).toHaveBeenCalledWith(
      expect.any(Array),
      "coach: chat — Felt strong",
      expect.objectContaining({ repo: "owner/repo" }),
    );
    expect(await response.json()).toMatchObject({
      reply: "Good work.",
      repoSha: "commit-sha",
    });
  });

  it("commits chat and action writes together for a returning, profile-complete athlete (#616)", async () => {
    const latestThreads = [
      {
        id: "thread-1",
        createdAt: 1,
        title: "Done",
        preview: "Good work.",
        messages: [],
      },
    ];
    const response = await commitTurn({
      ...baseTurn(),
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [{ path: "user_data/coach/injuries.json", content: "{}" }],
      latestThreads,
      finalThreadId: "thread-1",
      computedTitle: "Done",
      wasProfileComplete: true,
      profileComplete: true,
    } as never);
    // D1 (#736): chat history commits independently of the structured-fact writes now - two
    // separate commitFilesAtomic calls, not one combined atomic commit, so a bad fact never
    // costs the chat message (and vice versa).
    expect(commitFilesAtomic).toHaveBeenCalledTimes(2);
    expect(
      commitFilesAtomic.mock.calls[0]?.[0].map((write) => (write as { path: string }).path),
    ).toEqual(["user_data/coach/profile.json", "user_data/coach/injuries.json"]);
    expect(
      commitFilesAtomic.mock.calls[1]?.[0].map((write) => (write as { path: string }).path),
    ).toEqual(["user_data/coach/chat_history.json"]);
    expect(await response.json()).toMatchObject({
      reply: "Good work.",
      threadId: "thread-1",
      repoSha: "commit-sha",
      droppedActions: [],
    });
  });

  // OpenRouter K1 retest finding: the turn-committed log line's droppedFacts counter only ever
  // counted commit failures, never a validation drop (buildTurnWrites' bad-reference drops) - a
  // reader who saw droppedFacts: 0 on a turn that actually dropped a reference had no way to
  // tell. The two counts must stay distinct in the log line, not collapsed into one name.
  it("logs commit-failure and validation drop counts as two distinct fields, not one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await commitTurn({
      ...baseTurn(),
      validUpdates: [{ path: "user_data/coach/profile.json", content: "{}" }],
      chatWrite: { path: "user_data/coach/chat_history.json", content: "{}" },
      optionalWrites: [],
      latestThreads: [],
      finalThreadId: "thread-1",
      computedTitle: "Felt strong",
      droppedActions: [{ field: "quest_event", reason: "no match on file", kind: "validation" }],
    } as never);
    const committedCall = logSpy.mock.calls.find(
      (call) => call[0] === "[coach-chat] turn committed",
    );
    expect(committedCall).toBeDefined();
    const logged = JSON.parse(committedCall![1] as string);
    expect(logged.droppedFactsCommitFailures).toBe(0);
    expect(logged.droppedActionsValidation).toBe(1);
    logSpy.mockRestore();
  });
});
