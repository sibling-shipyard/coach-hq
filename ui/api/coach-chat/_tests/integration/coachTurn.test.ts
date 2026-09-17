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

import { buildTurnWrites } from "../../_lib/buildTurnWrites.js";
import { commitTurn } from "../../_lib/turnCompletion.js";
import { parseTurnRequest } from "../../_lib/turnRequest.js";

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

  // Review finding (P1, #727 hardening): the coach_since/first_session_benchmark_pending merge
  // patch used to hand-write just { coach_since }, discarding first_session_benchmark_pending:
  // true even though injectCoachSinceIfNeeded always sets both together - on the common case (the
  // athlete's last profile field and the profileComplete transition land the same turn), the
  // pending marker never got persisted, defeating the whole retry mechanism for exactly the
  // athletes who'd need it.
  it("preserves first_session_benchmark_pending when profile_update and the coach_since transition land the same turn", async () => {
    // wasProfileComplete/profileComplete aren't read from these overrides directly - buildTurnWrites
    // recomputes both itself (projectProfileCompletion) from context.profile/memory/seasons plus
    // this turn's own profile_update, so the fixture has to be a genuinely incomplete profile
    // (missing only timezone) that this turn's profile_update completes.
    const turn = await buildTurnWrites(
      baseTurn({
        reply: {
          reply: "Got it, you're all set.",
          profile_update: [{ field: "timezone", value: "Asia/Kolkata" }],
        },
        context: {
          soul: "soul",
          profile: {
            version: 1,
            coach_since: null,
            name: "Athlete",
            dob: "1998-01-01",
            timezone: "",
            height_cm: 178,
            weight_kg: 75,
          },
          memory: {
            version: 1,
            _meta: { updated_at: "t", updated_by: "model", trace_id: "t1" },
            sports: ["Running"],
            coaching_style: "accountability",
            training_availability: null,
            notes: Object.fromEntries(
              [
                "fitness_baseline",
                "coaching_priorities",
                "learned_patterns.training",
                "learned_patterns.nutrition",
                "learned_patterns.mental",
                "equipment",
              ].map((label) => [label, { text: "", updated_at: "", trace_id: "" }]),
            ),
          },
          seasons: {
            version: 1,
            _meta: { updated_at: "t", updated_by: "model", trace_id: "t1" },
            current_season_id: "season-1",
            seasons: [
              {
                id: "season-1",
                name: "Base Build",
                start_date: "2026-09-01",
                end_date: "2026-12-01",
                main_quest: { id: "q1", name: "Goal", type: "count_target", target: 1 },
              },
            ],
          },
          injuries: null,
          coachLog: null,
          quests: null,
          progress: null,
          progressions: null,
          athleteInsights: null,
        },
      }) as never,
    );
    const profileWrite = turn.optionalWrites.find((write) =>
      write.path.endsWith("profile.json"),
    ) as { path: string; resolve: () => Promise<string> } | undefined;
    expect(profileWrite).toBeDefined();
    const content = JSON.parse(await profileWrite!.resolve());
    expect(content.coach_since).toBeTruthy();
    expect(content.first_session_benchmark_pending).toBe(true);
    // The profile_update field itself still landed - the merge doesn't clobber it either.
    expect(content.timezone).toBe("Asia/Kolkata");
    // Not duplicated as a separate validUpdates entry - it got folded into the write above.
    expect(turn.validUpdates.some((update) => update.path.endsWith("profile.json"))).toBe(false);
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
      "Marked that quest complete.\n\n(Note: couldn't save quest_event this turn - something about that request didn't go through. If it's still relevant, ask again.)",
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

  // #1070: isProseOnlyWeekPlan's own one-shot reprompt (requestCoachReply) already worked - what
  // was missing was a same-turn correction for the athlete when the reprompt still doesn't fix
  // it. Before this fix, requestCoachReply only console.warn'd/captured to Sentry, so the athlete
  // read a full week plan that was never actually saved with no indication anything went wrong
  // (live-reproduced on coach-akash-suresh, traceId tkxjxkzd). RepliedTurn.stillProseOnlyWeekPlan
  // carries the signal into buildTurnWrites, same shape as stillUnconfirmedAssumption.
  it("appends a same-turn correction to the reply when the prose-only week plan is still unresolved after reprompt (#1070)", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        firstSession: false,
        stillProseOnlyWeekPlan: true,
        reply: {
          reply:
            "Here's your roadmap: Monday easy run, Tuesday intervals, Wednesday badminton," +
            " Thursday recovery, Friday badminton, Saturday long run, Sunday rest.",
          coach_note: "Laid out the week ahead.",
        },
      }) as never,
    );
    expect(turn.finalReplyText).toBe(
      "Here's your roadmap: Monday easy run, Tuesday intervals, Wednesday badminton," +
        " Thursday recovery, Friday badminton, Saturday long run, Sunday rest.\n\n" +
        "(Note: the week plan above wasn't saved - ask again and I'll lock it in.)",
    );
  });

  it("does not append the prose-only week plan correction when stillProseOnlyWeekPlan is unset", async () => {
    const turn = await buildTurnWrites(
      baseTurn({
        firstSession: false,
        reply: {
          reply: "Here's your roadmap for the week ahead.",
          coach_note: "Laid out the week ahead.",
        },
      }) as never,
    );
    expect(turn.finalReplyText).toBe("Here's your roadmap for the week ahead.");
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
    // A real, fully schema-valid current_week.json - #727 live-testing found that Coach's own
    // patch write path validates its result eagerly now (a real week_update kickoff crashed the
    // whole turn otherwise), so this fixture needs to actually pass that validation like a real
    // repo's current_week.json always would, not just carry the one field this test's patch
    // touches.
    const weekDates = [
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ];
    const currentWeekContent = JSON.stringify({
      schema_version: 1,
      data_status: "live",
      timezone: "UTC",
      week: {
        id: "2026-W37",
        start_date: "2026-09-07",
        end_date: "2026-09-13",
        focus: "Base week",
        guardrails: [],
      },
      coach_read: {
        headline: "Steady week.",
        body: "Keep the volume honest.",
        valid_from: "2026-09-07",
        valid_until: "2026-09-13",
      },
      days: weekDates.map((date) => ({
        date,
        intent: "Training",
        coach_note: "Standard day.",
        sessions:
          date === "2026-09-12"
            ? [
                {
                  id: "s_saturday",
                  discipline: "football",
                  kind: "match",
                  title: "Football - away game",
                  status: "planned",
                  origin: "planned",
                  priority: "anchor",
                  planned_duration_min: 90,
                  template_id: "match_day",
                  session_file: "sessions/2026-09-12_match_day.json",
                  coach_note: "Away game.",
                  original_date: null,
                  completion_activity_ids: [],
                },
              ]
            : [],
      })),
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
            week_update: {
              days: [
                {
                  date: "2026-09-12",
                  sessions: [
                    {
                      session_id: "s_saturday",
                      discipline: "walk",
                      kind: "recovery",
                      title: "Easy Walk",
                    },
                  ],
                },
              ],
            },
          },
        }) as never,
      );
      expect(turn.droppedActions).toEqual([
        expect.objectContaining({
          field: "week_update",
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
            week_update: {
              days: [
                {
                  date: "2026-09-12",
                  sessions: [
                    {
                      session_id: "s_saturday",
                      discipline: "walk",
                      kind: "recovery",
                      title: "Easy Walk",
                    },
                  ],
                },
              ],
            },
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
