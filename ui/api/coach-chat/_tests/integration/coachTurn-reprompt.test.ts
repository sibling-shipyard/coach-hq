import { beforeEach, describe, expect, it, vi } from "vitest";

const { askGemini } = vi.hoisted(() => ({ askGemini: vi.fn() }));
vi.mock("../../_lib/gemini/geminiClient.js", () => ({
  askGemini,
  GEMINI_MODEL: "gemini-flash-latest",
}));

// Every test below runs a non-first-session turn, which now means requestCoachReply fetches the
// templates manifest and current_week.json before calling askGemini (Finding A fix). Stubbed here
// instead of letting it hit real GitHub - most tests below don't care about the content, only the
// "does not-first-session-context-fetching break anything else" question, so the default is empty
// (no templates, no sessions) and the one test that cares about real content sets its own return.
const { getFileRaw } = vi.hoisted(() => ({
  getFileRaw: vi.fn(async (_repo: string, _path: string, _token: string) => null as string | null),
}));
vi.mock("../../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/decide/coachChatFiles.js")>();
  return { ...original, getFileRaw };
});

// #1009 Sentry gap: real captureGeminiFailure/captureValidationFailure stay wired to the real
// module (no-op without SENTRY_DSN, which the test env never sets) - only captureStillUnresolvedGuard
// is stubbed, so the still-unresolved describe block below can assert on it directly.
const { captureStillUnresolvedGuard } = vi.hoisted(() => ({
  captureStillUnresolvedGuard: vi.fn(async () => ({ sent: true })),
}));
vi.mock("../../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../_lib/sentry.js")>();
  return { ...original, captureStillUnresolvedGuard };
});

import { requestCoachReply } from "../../_lib/coachTurn.js";
import { COACH_LOG_TEXT_CAP } from "../../_lib/text-caps.bundle.js";

function baseTurnState(overrides: Record<string, unknown> = {}) {
  return {
    threadId: "thread-1",
    priorMessages: [],
    trimmed: "how's my week looking",
    geminiMessage: "how's my week looking",
    repo: "owner/repo",
    token: "token",
    apiKey: "key",
    currentSha: "sha",
    stale: false,
    context: { soul: "soul" },
    timezone: "UTC",
    athleteContext: "",
    questContext: "",
    firstSession: false,
    now: Date.now(),
    traceId: "trace-1",
    validQuestIds: new Set<string>(["q1"]),
    validInjuryFlagIds: new Set<string>(["inj_1"]),
    ...overrides,
  } as unknown as Parameters<typeof requestCoachReply>[0];
}

beforeEach(() => {
  getFileRaw.mockReset();
  getFileRaw.mockResolvedValue(null);
});

// The reprompt is generic across every capped free-text field, so memory_update.text stands in
// for the size-cap scenario below. Every fixture here also carries a coach_note, because
// coach_note is required whenever memory_update fires too (see the missingRequiredCoachNote-only
// tests further down for that check on its own) - each test below stays isolated to the one
// reprompt reason it names.
describe("requestCoachReply text-cap reprompt (issue #462, layer 2)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts exactly once when a capped field comes back oversized, then returns the corrected reply", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    const corrected = "A short note within budget.";
    askGemini
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: oversized },
        coach_note: "note",
        reply: "ok",
      })
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: corrected },
        coach_note: "note",
        reply: "ok",
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.memory_update?.text).toBe(corrected);
  });

  it("does not reprompt a second time if the reprompt also comes back oversized, but logs it", async () => {
    const oversized = "x".repeat(COACH_LOG_TEXT_CAP + 500);
    askGemini
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: oversized },
        coach_note: "note",
        reply: "ok",
      })
      .mockResolvedValueOnce({
        memory_update: { label: "baseline", text: oversized },
        coach_note: "note",
        reply: "ok",
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.memory_update?.text).toBe(oversized);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({
        stillOversized: expect.objectContaining({ field: "memory_update.text" }),
        stillMissingNote: false,
      }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when the reply is already within every cap and coach_note is present", async () => {
    askGemini.mockResolvedValueOnce({
      memory_update: { label: "baseline", text: "Fine." },
      coach_note: "note",
      reply: "ok",
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// C2's enforcement rule: coach_note is required whenever another structured write also fired
// this turn. Same reprompt mechanism as the size-cap check above, exercised in isolation here.
describe("requestCoachReply missing-coach_note reprompt (C2)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts exactly once when profile_update fires with no coach_note, then commits the corrected reply", async () => {
    askGemini
      .mockResolvedValueOnce({
        profile_update: [{ field: "weight_kg", value: "76" }],
        reply: "ok",
      })
      .mockResolvedValueOnce({
        profile_update: [{ field: "weight_kg", value: "76" }],
        coach_note: "Athlete reported new weight: 76kg.",
        reply: "ok",
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.coach_note).toBe("Athlete reported new weight: 76kg.");
  });

  it("does not reprompt a filler turn with no other structured writes and no coach_note", async () => {
    askGemini.mockResolvedValueOnce({ reply: "Heavy legs happen, keep it honest today." });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when profile_update fires alongside a coach_note", async () => {
    askGemini.mockResolvedValueOnce({
      profile_update: [{ field: "weight_kg", value: "76" }],
      coach_note: "Athlete reported new weight: 76kg.",
      reply: "ok",
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// D1 (#736), layer 2: a hallucinated/stale quest_id or flag_id gets one corrective reprompt,
// naming the actual valid ids, before layer 3 (buildTurnWrites) would have to drop the action.
describe("requestCoachReply invalid-reference reprompt (D1 #736, layer 2)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts once on an invalid quest_id and commits the retry's corrected id", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Logged it.",
        coach_note: "Marked the quest.",
        quest_event: [{ quest_id: "q99", status: "completed" }],
      })
      .mockResolvedValueOnce({
        reply: "Logged it.",
        coach_note: "Marked the quest.",
        quest_event: [{ quest_id: "q1", status: "completed" }],
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_event).toEqual([
      { quest_id: "q1", status: "completed" },
    ]);
  });

  it("reprompts once on an invalid flag_id and commits the retry's corrected id", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted.",
        coach_note: "Updated an injury.",
        injury_event: [{ status: "resolved", flag_id: "inj_bogus" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted.",
        coach_note: "Updated an injury.",
        injury_event: [{ status: "resolved", flag_id: "inj_1" }],
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_event).toEqual([
      { status: "resolved", flag_id: "inj_1" },
    ]);
  });

  it("does not reprompt a second time if the retry is still bad, but logs it for layer 3 to drop", async () => {
    const stillBad = { quest_id: "q99", status: "completed" as const };
    askGemini
      .mockResolvedValueOnce({
        reply: "Logged it.",
        coach_note: "Marked the quest.",
        quest_event: [stillBad],
      })
      .mockResolvedValueOnce({
        reply: "Logged it.",
        coach_note: "Marked the quest.",
        quest_event: [stillBad],
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_event).toEqual([stillBad]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still referenced an invalid id after reprompt, layer 3 will drop it:",
      expect.objectContaining({ field: "quest_event", badId: "q99" }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when every referenced id is valid", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Logged it.",
      coach_note: "Marked the quest.",
      quest_event: [{ quest_id: "q1", status: "completed" }],
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Finding D (OpenRouter K1 retest) mitigation: a self-audit field, not a text heuristic. Same
// one-retry-cap discipline as the other reprompts above - exercised in isolation here.
describe("requestCoachReply unrecorded-facts reprompt (Finding D mitigation)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts once when unrecorded_facts is non-empty, then commits the corrected reply", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Got it, I've logged the new knee soreness.",
        coach_note: "Athlete mentioned new knee soreness.",
        unrecorded_facts: ["mentioned a new knee injury but set no injury_flag"],
      })
      .mockResolvedValueOnce({
        reply: "Got it, I've logged the new knee soreness.",
        coach_note: "Athlete mentioned new knee soreness.",
        injury_flag: [{ text: "New knee soreness" }],
        unrecorded_facts: [],
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag).toEqual([{ text: "New knee soreness" }]);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("mentioned a new knee injury but set no injury_flag");
  });

  it("does not reprompt a second time if unrecorded_facts is still non-empty, but logs it", async () => {
    const stillFlagged = ["mentioned a new goal but set no season_start"];
    askGemini
      .mockResolvedValueOnce({
        reply: "Sounds like a great goal.",
        coach_note: "Discussed a new goal.",
        unrecorded_facts: stillFlagged,
      })
      .mockResolvedValueOnce({
        reply: "Sounds like a great goal.",
        coach_note: "Discussed a new goal.",
        unrecorded_facts: stillFlagged,
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.unrecorded_facts).toEqual(stillFlagged);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillUnrecordedFacts: stillFlagged }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("ignores an unrecorded_facts array containing only blank entries", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      unrecorded_facts: ["   ", ""],
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-string entry in unrecorded_facts instead of throwing (review finding)", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "ok",
        coach_note: "note",
        profile_update: [{ field: "weight_kg", value: "76" }],
        // The schema declares string[], but Gemini's actual output is not runtime-checked here -
        // a non-string element must not crash .trim() and turn a usable reply into a false 500.
        unrecorded_facts: [null, 42, "a real fact"] as unknown as string[],
      })
      .mockResolvedValueOnce({
        reply: "ok",
        coach_note: "note",
        profile_update: [{ field: "weight_kg", value: "76" }],
        unrecorded_facts: [],
      });

    const result = await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(result).not.toBeInstanceOf(Response);
  });

  it("does not reprompt when unrecorded_facts is empty or absent", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      profile_update: [{ field: "weight_kg", value: "76" }],
      unrecorded_facts: [],
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Review finding: `\bach(?:e|ing)\b` only ever matches at a word's own start, but
// "headache"/"backache"/"stomachache"/"toothache" have no word boundary before "ach" at all -
// it sits mid-word - so the safety net silently never fired on exactly this phrasing.
describe("requestCoachReply missed-injury-language reprompt, compound ache words (review finding)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it.each(["I have a bad headache", "my back has a dull backache", "stomachache since lunch"])(
    "reprompts on %j (a first-session turn with no injury_flag set)",
    async (message) => {
      askGemini
        .mockResolvedValueOnce({ reply: "noted", coach_note: "note" })
        .mockResolvedValueOnce({
          reply: "noted",
          coach_note: "note",
          injury_flag: [{ text: "headache" }],
        });

      await requestCoachReply(
        baseTurnState({
          firstSession: true,
          validInjuryFlagIds: new Set<string>(),
          trimmed: message,
          geminiMessage: message,
        }),
      );

      expect(askGemini).toHaveBeenCalledTimes(2);
    },
  );

  it('does not false-positive on a word that merely contains "ach" mid-word', async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      baseTurnState({
        firstSession: true,
        validInjuryFlagIds: new Set<string>(),
        trimmed: "still reaching my weekly mileage target",
        geminiMessage: "still reaching my weekly mileage target",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Finding D (2026-09-10 pro baseline): findMissedInjuryLanguage's deterministic keyword safety
// net, extended to habits - same first-session + zero-pre-existing-referents scoping. All tests
// below use a first-session turn with an empty validQuestIds set, matching the scenario this was
// built for (a fresh athlete's dense first message).
describe("requestCoachReply missed-habit-language reprompt (Finding D, habit extension)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function firstSessionTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      firstSession: true,
      validQuestIds: new Set<string>(),
      trimmed: "Also I want to build a daily stretching habit.",
      geminiMessage: "Also I want to build a daily stretching habit.",
      ...overrides,
    });
  }

  it("reprompts once when habit language is present but no habit was captured", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Great, let's build that in.",
        coach_note: "Athlete wants a daily stretching habit.",
      })
      .mockResolvedValueOnce({
        reply: "Great, let's build that in.",
        coach_note: "Athlete wants a daily stretching habit.",
        quest_create: { quests: [{ name: "Daily Stretching", type: "daily_streak" as const }] },
      });

    const result = await requestCoachReply(firstSessionTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_create?.quests).toHaveLength(1);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no habit was captured this turn");
  });

  it("does not reprompt a second time if habit language is still uncaptured, but logs it", async () => {
    askGemini.mockResolvedValue({
      reply: "Great, let's build that in.",
      coach_note: "Athlete wants a daily stretching habit.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await requestCoachReply(firstSessionTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedHabitLanguage: "daily" }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt on a returning-athlete turn even with the same habit language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(
      firstSessionTurnState({ firstSession: false, validQuestIds: new Set<string>() }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when the athlete already has an active quest on file", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(firstSessionTurnState({ validQuestIds: new Set<string>(["q1"]) }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when a matching habit was already captured via season_start.new_habits", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      season_start: {
        name: "Season",
        start_date: "2026-09-10",
        end_date: "2026-12-01",
        main_quest: { name: "Goal", type: "count_target" as const, target: 1 },
        new_habits: [{ name: "Daily Stretching", type: "daily_streak" as const }],
      },
    });

    await requestCoachReply(firstSessionTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when the message contains no habit-shaped language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(
      firstSessionTurnState({
        // Deliberately avoids goal-declaring language too ("I want to run a marathon" is a real
        // trigger for the separate missed-season-language check below, not a false positive).
        trimmed: "Just checking in, nothing new to report today.",
        geminiMessage: "Just checking in, nothing new to report today.",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Finding A (OpenRouter K1 retest): plan_edit/session_reconcile/template_edit silently no-op'd
// while the reply still claimed success, because this prompt never told the model any real
// template_id/session_id to work from on an ordinary turn - activeTemplatesContext/
// activeWeekSessionsContext existed but were never wired into requestCoachReply. Live-model
// compliance is out of scope here (that needs a real API call); what this proves is the prompt
// itself now carries the real ids, which is the actual bug - not whether the model chooses to use
// them.
describe("requestCoachReply supplies real template/session context (Finding A fix)", () => {
  beforeEach(() => {
    askGemini.mockReset();
    askGemini.mockResolvedValue({ reply: "ok" });
  });

  it("fetches the templates manifest and current_week.json and folds real ids into extraContext", async () => {
    getFileRaw.mockImplementation(async (_repo: string, path: string) =>
      path.endsWith("_manifest.json")
        ? JSON.stringify({ template_ids: ["tpl-strength-a"] })
        : path.endsWith("current_week.json")
          ? JSON.stringify({
              days: [
                {
                  date: "2026-09-10",
                  sessions: [{ id: "sess_20260910_1", title: "Easy run", status: "planned" }],
                },
              ],
            })
          : null,
    );

    await requestCoachReply(baseTurnState({ trimmed: "swap tomorrow's session for a walk" }));

    const extraContext = askGemini.mock.calls[0]?.[8] as string;
    expect(extraContext).toContain("tpl-strength-a");
    expect(extraContext).toContain("sess_20260910_1");
  });

  it("skips the fetch entirely on a first-session turn", async () => {
    await requestCoachReply(baseTurnState({ firstSession: true }));

    expect(getFileRaw).not.toHaveBeenCalled();
  });
});

// Bug 3 Primary (2026-09-10 pro baseline): the reprompt-side half of pending-clarification
// tracking - see coachTurn.ts's findUnconfirmedAssumption for the full story.
describe("requestCoachReply unconfirmed-assumption reprompt (Bug 3 Primary)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts once when a pending clarification exists and the reply touches a schedule field", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Done, swapped it.",
        coach_note: "Swapped Saturday.",
        week_update: {
          days: [
            {
              date: "2026-09-12",
              sessions: [
                { session_id: "s_saturday", discipline: "walk", kind: "recovery", title: "Walk" },
              ],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        reply: "Actually, let me check first - dropping football or doing both?",
        coach_note: "Asked for clarification instead of assuming.",
      });

    const result = await requestCoachReply(
      baseTurnState({
        pendingClarification: "dropping football or doing both?",
        trimmed: "That covers it, wrap this up.",
        geminiMessage: "That covers it, wrap this up.",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.week_update).toBeUndefined();
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("dropping football or doing both?");
  });

  it("does not reprompt when the athlete's message contains a confirmation cue", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Done, swapped it.",
      coach_note: "Swapped Saturday.",
      week_update: {
        days: [
          {
            date: "2026-09-12",
            sessions: [
              { session_id: "s_saturday", discipline: "walk", kind: "recovery", title: "Walk" },
            ],
          },
        ],
      },
    });

    await requestCoachReply(
      baseTurnState({
        pendingClarification: "dropping football or doing both?",
        trimmed: "Yes, drop the football and do the walk.",
        geminiMessage: "Yes, drop the football and do the walk.",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when there is no pending clarification", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Done, swapped it.",
      coach_note: "Swapped Saturday.",
      week_update: {
        days: [
          {
            date: "2026-09-12",
            sessions: [
              { session_id: "s_saturday", discipline: "walk", kind: "recovery", title: "Walk" },
            ],
          },
        ],
      },
    });

    await requestCoachReply(baseTurnState({ pendingClarification: null }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when the reply touches no schedule-changing field", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Sure thing.",
      coach_note: "note",
      profile_update: [{ field: "weight_kg", value: "76" }],
    });

    await requestCoachReply(
      baseTurnState({
        pendingClarification: "dropping football or doing both?",
        trimmed: "That covers it, wrap this up.",
        geminiMessage: "That covers it, wrap this up.",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Live-verified (#727 review): reproduced twice in 5 real OpenRouter runs - a "reps"-type
// exercise with no reps field at all. Gemini's structured-output mode has no
// conditional-required support, so nothing stops the model from omitting it; this is a
// pre-emptive check before the write path's own refusal, one reprompt attempt to self-correct.
function malformedRepsSpec() {
  return {
    title: "Upper Body",
    workout_type: "strength",
    phases: [
      {
        name: "Main",
        exercises: [
          {
            name: "Dumbbell row",
            type: "reps",
            sets: 3,
            form_cue: "Squeeze the shoulder blade.",
            why: "Back strength.",
            // reps intentionally omitted - the live failure shape.
          },
        ],
      },
    ],
  };
}

describe("requestCoachReply malformed workout_create reprompt (#727 live-test finding)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts once when a reps-type exercise has no reps field", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Here's an upper body session.",
        coach_note: "Built a routine.",
        workout_create: malformedRepsSpec(),
      })
      .mockResolvedValueOnce({
        reply: "Here's an upper body session, saved to your page.",
        coach_note: "Built a routine.",
        workout_create: {
          ...malformedRepsSpec(),
          phases: [
            {
              name: "Main",
              exercises: [{ ...malformedRepsSpec().phases[0].exercises[0], reps: 10 }],
            },
          ],
        },
      });

    const result = await requestCoachReply(
      baseTurnState({
        trimmed: "Build me an upper body workout",
        geminiMessage: "Build me an upper body workout",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(
      (
        result as {
          reply: { workout_create?: { phases: { exercises: { reps?: number }[] }[] } };
        }
      ).reply.workout_create?.phases[0]?.exercises[0]?.reps,
    ).toBe(10);
  });

  it("does not reprompt when workout_create is well-formed", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Here's your session.",
      coach_note: "Built a routine.",
      workout_create: {
        ...malformedRepsSpec(),
        phases: [
          {
            name: "Main",
            exercises: [{ ...malformedRepsSpec().phases[0].exercises[0], reps: 10 }],
          },
        ],
      },
    });

    await requestCoachReply(
      baseTurnState({
        trimmed: "Build me an upper body workout",
        geminiMessage: "Build me an upper body workout",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when there is no workout_create at all", async () => {
    askGemini.mockResolvedValueOnce({ reply: "Sure, tell me more about what you want." });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// Live-verified (#727 review, 2026-09-13): reproduced live twice - a first-session athlete
// stated a goal (and often habits in the same message), coach_note/reply narrated the season as
// launched, but season_start was never set. Same shape as the habit-language check above, but
// keyed on goal-declaring language in the athlete's own message.
describe("requestCoachReply missed-season-language reprompt (#727 live-test finding)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function firstSessionGoalTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      firstSession: true,
      trimmed: "By end of 2026 I want to be stronger overall.",
      geminiMessage: "By end of 2026 I want to be stronger overall.",
      ...overrides,
    });
  }

  it("reprompts once when goal language is present but season_start was never set", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Season locked in.",
        coach_note: "Athlete committed to a strength season through end of 2026.",
      })
      .mockResolvedValueOnce({
        reply: "Season locked in.",
        coach_note: "Athlete committed to a strength season through end of 2026.",
        season_start: {
          name: "Strength Build",
          start_date: "2026-09-13",
          end_date: "2026-12-31",
          main_quest: { name: "Get stronger", type: "count_target" as const, target: 1 },
          new_habits: [],
        },
      });

    const result = await requestCoachReply(firstSessionGoalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.season_start?.name).toBe("Strength Build");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no season_start was set");
  });

  it("does not reprompt a second time if still uncaptured, but logs it and captures it to Sentry", async () => {
    askGemini.mockResolvedValue({
      reply: "Season locked in.",
      coach_note: "Athlete committed to a strength season through end of 2026.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureStillUnresolvedGuard.mockClear();

    await requestCoachReply(firstSessionGoalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedSeasonLanguage: expect.any(String) }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    // #1009 Sentry gap: the still-unresolved block now reaches Sentry alongside console.warn for
    // every existing detector, not just the new profile one - proven here on the season detector.
    expect(captureStillUnresolvedGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        detectors: expect.arrayContaining(["missedSeasonLanguage"]),
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt on a returning-athlete turn even with the same goal language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(firstSessionGoalTurnState({ firstSession: false }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when season_start was already captured", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      season_start: {
        name: "Season",
        start_date: "2026-09-13",
        end_date: "2026-12-31",
        main_quest: { name: "Goal", type: "count_target" as const, target: 1 },
        new_habits: [],
      },
    });

    await requestCoachReply(firstSessionGoalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on ordinary training chat with no goal-declaring language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      firstSessionGoalTurnState({
        trimmed: "still reaching my weekly mileage target",
        geminiMessage: "still reaching my weekly mileage target",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

describe("requestCoachReply missed-profile-language reprompt (#1009)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function firstSessionAgeTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      firstSession: true,
      trimmed: "I just turned 29 years old",
      geminiMessage: "I just turned 29 years old",
      context: { soul: "soul", profile: null },
      ...overrides,
    });
  }

  it("reprompts once when age language is present but profile_update was never set", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Got it, noted your age.",
        coach_note: "Athlete is 29.",
      })
      .mockResolvedValueOnce({
        reply: "Got it, noted your age.",
        coach_note: "Athlete is 29.",
        profile_update: [{ field: "dob", value: "1997-01-01" }],
      });

    const result = await requestCoachReply(firstSessionAgeTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.profile_update?.[0]?.field).toBe("dob");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no matching profile_update was set");
  });

  it("does not reprompt a second time if still uncaptured, but logs it and captures it to Sentry", async () => {
    askGemini.mockResolvedValue({
      reply: "Got it, noted your age.",
      coach_note: "Athlete is 29.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureStillUnresolvedGuard.mockClear();

    await requestCoachReply(firstSessionAgeTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedProfileLanguage: expect.any(String) }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    expect(captureStillUnresolvedGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        detectors: expect.arrayContaining(["missedProfileLanguage"]),
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt on a returning-athlete turn even with the same age language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(firstSessionAgeTurnState({ firstSession: false }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when profile_update was already captured this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      profile_update: [{ field: "dob", value: "1997-01-01" }],
    });

    await requestCoachReply(firstSessionAgeTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on adjacent-but-different phrasing (a distance, not a body metric)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      firstSessionAgeTurnState({
        trimmed: "ran 10km today, felt great",
        geminiMessage: "ran 10km today, felt great",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("reprompts for weight_kg when the athlete states both height and weight but the model only captures height_cm", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Got it, noted your height.",
        coach_note: "Athlete is 180cm and 75kg.",
        profile_update: [{ field: "height_cm", value: 180 }],
      })
      .mockResolvedValueOnce({
        reply: "Got it, noted your height and weight.",
        coach_note: "Athlete is 180cm and 75kg.",
        profile_update: [
          { field: "height_cm", value: 180 },
          { field: "weight_kg", value: 75 },
        ],
      });

    const result = await requestCoachReply(
      firstSessionAgeTurnState({
        trimmed: "I'm 180cm and 75kg",
        geminiMessage: "I'm 180cm and 75kg",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(
      "reply" in result && result.reply.profile_update?.some((u) => u.field === "weight_kg"),
    ).toBe(true);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no matching profile_update was set");
  });
});

describe("requestCoachReply missed-removal-language reprompt (#1009)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function returningRemovalTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      firstSession: false,
      trimmed: "delete my old strength routine, I don't use it anymore",
      geminiMessage: "delete my old strength routine, I don't use it anymore",
      ...overrides,
    });
  }

  it("reprompts once when removal language is present but workout_remove was never set", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Done, that routine is gone.",
        coach_note: "Removed the old strength routine.",
      })
      .mockResolvedValueOnce({
        reply: "Done, that routine is gone.",
        coach_note: "Removed the old strength routine.",
        workout_remove: { routine_id: "routine_1" },
      });

    const result = await requestCoachReply(returningRemovalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.workout_remove?.routine_id).toBe("routine_1");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no workout_remove was");
  });

  it("does not reprompt a second time if still uncaptured, but logs it and captures it to Sentry", async () => {
    askGemini.mockResolvedValue({
      reply: "Done, that routine is gone.",
      coach_note: "Removed the old strength routine.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureStillUnresolvedGuard.mockClear();

    await requestCoachReply(returningRemovalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedRemovalLanguage: expect.any(String) }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    expect(captureStillUnresolvedGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        detectors: expect.arrayContaining(["missedRemovalLanguage"]),
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt on a first-session turn even with the same removal language", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok" });

    await requestCoachReply(returningRemovalTurnState({ firstSession: true }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when workout_remove was already captured this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      workout_remove: { routine_id: "routine_1" },
    });

    await requestCoachReply(returningRemovalTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on adjacent-but-different phrasing (skipping a session, not removing a routine)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      returningRemovalTurnState({
        trimmed: "skip today's run, I'm not feeling it",
        geminiMessage: "skip today's run, I'm not feeling it",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

describe("requestCoachReply missed-sports-language reprompt (#1009)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function newSportTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      trimmed: "I started climbing this month alongside my usual running",
      geminiMessage: "I started climbing this month alongside my usual running",
      ...overrides,
    });
  }

  it("reprompts once when new-activity language is present but sports_update was never set", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Nice, climbing sounds fun.",
        coach_note: "Athlete picked up climbing.",
      })
      .mockResolvedValueOnce({
        reply: "Nice, climbing sounds fun.",
        coach_note: "Athlete picked up climbing.",
        sports_update: ["running", "climbing"],
      });

    const result = await requestCoachReply(newSportTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.sports_update).toEqual(["running", "climbing"]);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no sports_update was set");
  });

  it("does not reprompt a second time if still uncaptured, but logs it and captures it to Sentry", async () => {
    askGemini.mockResolvedValue({
      reply: "Nice, climbing sounds fun.",
      coach_note: "Athlete picked up climbing.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureStillUnresolvedGuard.mockClear();

    await requestCoachReply(newSportTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedSportsLanguage: expect.any(String) }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    expect(captureStillUnresolvedGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        detectors: expect.arrayContaining(["missedSportsLanguage"]),
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when sports_update was already captured this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      sports_update: ["running", "climbing"],
    });

    await requestCoachReply(newSportTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on an ordinary session report naming an existing sport with no update intent", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      newSportTurnState({
        trimmed: "badminton was rough today, legs are still tired",
        geminiMessage: "badminton was rough today, legs are still tired",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on adjacent-but-different phrasing (a PR, not a new sport)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      newSportTurnState({
        trimmed: "hit a new 5k PR this morning",
        geminiMessage: "hit a new 5k PR this morning",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

describe("requestCoachReply missed-injury-update-language reprompt (#1009)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function oneActiveFlagTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      trimmed: "my knee's still a little sore but it's definitely improving",
      geminiMessage: "my knee's still a little sore but it's definitely improving",
      activeInjuryFlagIds: new Set<string>(["inj_1"]),
      ...overrides,
    });
  }

  it("reprompts once when injury language is present, exactly one active flag exists, but neither injury_event nor injury_flag was set", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Great to hear the knee is coming along.",
        coach_note: "Knee improving.",
      })
      .mockResolvedValueOnce({
        reply: "Great to hear the knee is coming along.",
        coach_note: "Knee improving.",
        injury_event: [{ status: "resolved", flag_id: "inj_1" }],
      });

    const result = await requestCoachReply(oneActiveFlagTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_event?.[0]?.flag_id).toBe("inj_1");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("no injury_event or");
  });

  it("does not reprompt a second time if still uncaptured, but logs it and captures it to Sentry", async () => {
    askGemini.mockResolvedValue({
      reply: "Great to hear the knee is coming along.",
      coach_note: "Knee improving.",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    captureStillUnresolvedGuard.mockClear();

    await requestCoachReply(oneActiveFlagTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[coach-chat] reply still has a content violation after reprompt:",
      expect.objectContaining({ stillMissedInjuryUpdateLanguage: expect.any(String) }),
      expect.objectContaining({ traceId: "trace-1" }),
    );
    expect(captureStillUnresolvedGuard).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: "trace-1",
        detectors: expect.arrayContaining(["missedInjuryUpdateLanguage"]),
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not reprompt when injury_event was already captured this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      injury_event: [{ status: "resolved", flag_id: "inj_1" }],
    });

    await requestCoachReply(oneActiveFlagTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when injury_flag was already captured this turn (a genuinely new injury)", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      injury_flag: [{ text: "new shoulder tweak" }],
    });

    await requestCoachReply(oneActiveFlagTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on adjacent-but-different phrasing (no injury language at all)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      oneActiveFlagTurnState({
        trimmed: "had a great tempo run today, feeling strong",
        geminiMessage: "had a great tempo run today, feeling strong",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  // Deliberate scope boundary, not an oversight to fix later (see the code comment above
  // findMissedInjuryUpdateLanguage in coachTurn.ts): with 2+ active flags, "which injury" is
  // ambiguous and THIS detector stays silent rather than risk a false-positive reprompt naming a
  // specific flag_id on an ordinary mention of one of several known issues. That scope boundary is
  // still true. What changed in #1037 PR D: findUncountedInjuryLanguage now covers the "something
  // was said, nothing landed" case even with 2+ flags, without needing to resolve which flag - so
  // a reprompt now DOES fire here, just from the newer, broader detector rather than this one.
  it("findMissedInjuryUpdateLanguage itself stays silent with 2+ active flags, but findUncountedInjuryLanguage still reprompts (#1037)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" }).mockResolvedValueOnce({
      reply: "Noted, thanks for the update.",
      coach_note: "Knee still sore.",
      injury_event: [{ status: "active", flag_id: "inj_1" }],
    });

    const result = await requestCoachReply(
      oneActiveFlagTurnState({
        activeInjuryFlagIds: new Set<string>(["inj_1", "inj_2"]),
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_event?.[0]?.flag_id).toBe("inj_1");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    // Fired by the new detector, not the old one - the note text is generic ("fewer
    // injury_flag/injury_event entries..."), never a specific flag_id, since which of the 2+
    // flags is meant is still genuinely ambiguous.
    expect(repromptMessage).toContain("fewer injury_flag/injury_event entries");
  });
});

// Live-verified (#727 review, 2026-09-13): reproduced live - the Weekly Kick-off Ritual
// narrated a full 7-day plan in reply text (day-by-day bulleted breakdown) without ever setting
// week_update. isProseOnlyWeekPlan's weekday-name-count detector catches this deterministically;
// live reruns are too non-deterministic on their own to prove the reprompt fires on this exact
// shape (the model sometimes gets it right unprompted), so this is verified here instead.
function weekPlanProseReply(overrides: Record<string, unknown> = {}) {
  return {
    coach_note: "Full weekly plan laid out for the week ahead.",
    reply:
      "Here's your roadmap for the week:\n" +
      "- Monday: Easy Aerobic Run (40 min)\n" +
      "- Tuesday: Threshold Intervals (45 min)\n" +
      "- Wednesday: Badminton (60 min)\n" +
      "- Thursday: Easy Recovery Run (35 min)\n" +
      "- Friday: Badminton (60 min)\n" +
      "- Saturday: Long Run (60 min)\n" +
      "- Sunday: Rest & Recovery\n" +
      "Keep easy days strictly easy.",
    unrecorded_facts: [],
    ...overrides,
  };
}

describe("requestCoachReply prose-only week plan reprompt (#727 live-test finding)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  it("reprompts once when the reply narrates 5+ weekdays but week_update is absent", async () => {
    askGemini.mockResolvedValueOnce(weekPlanProseReply()).mockResolvedValueOnce({
      coach_note: "Full weekly plan laid out for the week ahead.",
      reply: "Plan is locked in for the week ahead.",
      week_update: {
        focus: "Aerobic build",
        guardrails: [],
        headline: "Week ahead",
        body: "Steady week.",
        days: Array.from({ length: 7 }, (_, i) => ({
          date: `2026-09-${14 + i}`,
          intent: "train",
          sessions: [],
        })),
      },
      unrecorded_facts: [],
    });

    const result = await requestCoachReply(
      baseTurnState({
        trimmed: "Lay out the full week for me",
        geminiMessage: "Lay out the full week for me",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect((result as { reply: { week_update?: unknown } }).reply.week_update).toBeDefined();
  });

  it("does not reprompt when week_update is already set alongside the weekday narration", async () => {
    askGemini.mockResolvedValueOnce(
      weekPlanProseReply({
        week_update: {
          focus: "Aerobic build",
          guardrails: [],
          headline: "Week ahead",
          body: "Steady week.",
          days: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-09-${14 + i}`,
            intent: "train",
            sessions: [],
          })),
        },
      }),
    );

    await requestCoachReply(
      baseTurnState({
        trimmed: "Lay out the full week for me",
        geminiMessage: "Lay out the full week for me",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt on a firstSession turn even with 5+ weekdays mentioned", async () => {
    askGemini.mockResolvedValueOnce(weekPlanProseReply());

    await requestCoachReply(baseTurnState({ firstSession: true }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("does not reprompt when fewer than 5 weekdays are mentioned", async () => {
    askGemini.mockResolvedValueOnce({
      coach_note: "Noted.",
      reply: "Let's plan Monday and Tuesday first, then see how it goes.",
      unrecorded_facts: [],
    });

    await requestCoachReply(baseTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });
});

// #1037 PR D: quest_event had no dedicated guard before this - see findMissedQuestLanguage in
// coachTurn.ts. Every test below is a returning-athlete turn (baseTurnState's default); the
// detector doesn't gate on firstSession at all, it only cares about active quests on file.
describe("requestCoachReply missed-quest-language reprompt (#1037)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  function twoQuestTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      context: {
        soul: "soul",
        quests: {
          quests: [
            { id: "q1", name: "Long Run", status: "active" },
            { id: "q2", name: "Mobility Work", status: "active" },
          ],
        },
      },
      // findInvalidReference (a different, pre-existing detector) treats any quest_id outside
      // this set as a bad reference and reprompts on it too - keep it in sync with the quests
      // above so these tests isolate findMissedQuestLanguage's own behavior.
      validQuestIds: new Set<string>(["q1", "q2"]),
      ...overrides,
    });
  }

  it("fires when 2 of 2 active quests are mentioned with status language but only 1 has a quest_event", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Nice work today.",
        coach_note: "Logged the run.",
        quest_event: [{ quest_id: "q1", status: "completed" }],
      })
      .mockResolvedValueOnce({
        reply: "Nice work today.",
        coach_note: "Logged the run and mobility work.",
        quest_event: [
          { quest_id: "q1", status: "completed" },
          { quest_id: "q2", status: "completed" },
        ],
      });

    const result = await requestCoachReply(
      twoQuestTurnState({
        trimmed: "finished my long run and did my mobility work today",
        geminiMessage: "finished my long run and did my mobility work today",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_event?.map((e) => e.quest_id).sort()).toEqual([
      "q1",
      "q2",
    ]);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("Mobility Work");
  });

  it("fires when 1 of 1 mentioned quest has no quest_event at all", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" }).mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      quest_event: [{ quest_id: "q3", status: "completed" }],
    });

    const result = await requestCoachReply(
      baseTurnState({
        context: {
          soul: "soul",
          quests: { quests: [{ id: "q3", name: "Strength Quest", status: "active" }] },
        },
        validQuestIds: new Set<string>(["q3"]),
        trimmed: "finished my strength quest today",
        geminiMessage: "finished my strength quest today",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_event?.[0]?.quest_id).toBe("q3");
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("Strength Quest");
  });

  it("stays silent when the message has no quest-status language at all (ordinary chat)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(twoQuestTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("stays silent when all mentioned quests already have a quest_event this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      quest_event: [
        { quest_id: "q1", status: "completed" },
        { quest_id: "q2", status: "completed" },
      ],
    });

    await requestCoachReply(
      twoQuestTurnState({
        trimmed: "finished my long run and did my mobility work today",
        geminiMessage: "finished my long run and did my mobility work today",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a quest name is mentioned with no status language nearby (purely descriptive)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      baseTurnState({
        context: {
          soul: "soul",
          quests: { quests: [{ id: "q3", name: "Strength Quest", status: "active" }] },
        },
        trimmed: "my strength quest usually happens Tuesdays",
        geminiMessage: "my strength quest usually happens Tuesdays",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  // The actual bug this fixes (#1037): a dense multi-fact turn where the model captures some but
  // not all of the quests it just narrated as done/missed/skipped. Before this PR, quest_event's
  // only backstop (synthesizeQuestEventFromUnrecordedFacts) bails entirely once 2+ dropped facts
  // each name-match a distinct quest - the exact case here.
  it("fires and names every uncaptured quest when a dense multi-quest turn only partially lands", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Solid day of training.",
        coach_note: "Run done, strength skipped.",
        quest_event: [{ quest_id: "q1", status: "completed" }],
      })
      .mockResolvedValueOnce({
        reply: "Solid day of training.",
        coach_note: "Run and mobility done, strength skipped.",
        quest_event: [
          { quest_id: "q1", status: "completed" },
          { quest_id: "q2", status: "completed" },
          { quest_id: "q3", status: "missed" },
        ],
      });

    const result = await requestCoachReply(
      baseTurnState({
        context: {
          soul: "soul",
          quests: {
            quests: [
              { id: "q1", name: "Long Run", status: "active" },
              { id: "q2", name: "Mobility Work", status: "active" },
              { id: "q3", name: "Strength Quest", status: "active" },
            ],
          },
        },
        validQuestIds: new Set<string>(["q1", "q2", "q3"]),
        trimmed: "did my long run and my mobility work today, but skipped my strength quest",
        geminiMessage: "did my long run and my mobility work today, but skipped my strength quest",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.quest_event?.map((e) => e.quest_id).sort()).toEqual([
      "q1",
      "q2",
      "q3",
    ]);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("Mobility Work");
    expect(repromptMessage).toContain("Strength Quest");
  });
});

// #1037 PR D: findUncountedInjuryLanguage closes both injury_flag's returning-athlete gap and
// injury_event's 2+-flag gap in one function - see the code comment above it in coachTurn.ts for
// why one detector covers both. Every test below is a returning-athlete turn.
describe("requestCoachReply uncounted-injury-language reprompt (#1037)", () => {
  beforeEach(() => {
    askGemini.mockReset();
  });

  const twoDistinctInjuryMessage =
    "I tweaked my ankle this morning during warmup and then much later in the day I also" +
    " strained my shoulder lifting boxes";

  function injuryTurnState(overrides: Record<string, unknown> = {}) {
    return baseTurnState({
      activeInjuryFlagIds: new Set<string>(["inj_1", "inj_2"]),
      trimmed: twoDistinctInjuryMessage,
      geminiMessage: twoDistinctInjuryMessage,
      ...overrides,
    });
  }

  it("fires when injury language describes more than was captured this turn", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" }).mockResolvedValueOnce({
      reply: "Sorry to hear that - noted both.",
      coach_note: "New ankle tweak and shoulder strain.",
      injury_flag: [{ text: "tweaked ankle" }, { text: "strained shoulder" }],
    });

    const result = await requestCoachReply(injuryTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("fewer injury_flag/injury_event entries");
  });

  it("stays silent on a first-session turn (covered by findMissedInjuryLanguage instead)", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    // Keep the default validInjuryFlagIds (non-empty) so findMissedInjuryLanguage's own
    // zero-flags gate stays closed too - this test isolates findUncountedInjuryLanguage's
    // firstSession gate specifically.
    await requestCoachReply(injuryTurnState({ firstSession: true }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("stays silent when everything described was already captured this turn", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "ok",
      coach_note: "note",
      injury_flag: [{ text: "tweaked ankle" }, { text: "strained shoulder" }],
    });

    await requestCoachReply(injuryTurnState());

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the message has no injury language at all", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" });

    await requestCoachReply(
      injuryTurnState({
        trimmed: "had a great tempo run today, feeling strong",
        geminiMessage: "had a great tempo run today, feeling strong",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  it("fires and names the uncaptured injury on a partial-capture (2 injuries named, 1 landed)", async () => {
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the ankle.",
        coach_note: "New ankle tweak.",
        injury_flag: [{ text: "tweaked ankle" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted both.",
        coach_note: "New ankle tweak and shoulder strain.",
        injury_flag: [{ text: "tweaked ankle" }, { text: "strained shoulder" }],
      });

    const result = await requestCoachReply(injuryTurnState());

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("fewer injury_flag/injury_event entries");
  });

  // The false-positive guard the LLD explicitly required: one injury restated across two clauses
  // close together ("still hurts" ... "pretty sore" a few words later) must NOT be double-counted
  // as two separate injuries once it's already been captured once.
  it("does not fire on one injury restated with 2 nearby keyword hits, already captured once", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Glad it's improving.",
      coach_note: "Knee still sore, watching it.",
      injury_event: [{ status: "active", flag_id: "inj_1" }],
    });

    await requestCoachReply(
      injuryTurnState({
        trimmed: "my knee still hurts, and honestly it's been pretty sore all week",
        geminiMessage: "my knee still hurts, and honestly it's been pretty sore all week",
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  // The athlete's own original scenario (#1037's origin question): 2 pre-existing active flags
  // (shoulder, knee), one message stating the knee resolving AND a new ankle injury in the same
  // turn. Documented limitation: only "tweaked" matches INJURY_LANGUAGE_PATTERN in this exact
  // phrasing - "feeling a lot better" (the knee resolving) and "still bugging me" (the shoulder)
  // don't match any of its keywords, so this detector only ever sees 1 distinct mention here
  // regardless of how the real message is worded, and can only catch the case where the model
  // captures 0 of the 3 real facts, not "2 of 3" or "1 of 3" in this particular phrasing - the
  // detector is a lower bound on the message, not a fact-level oracle.
  const athleteOriginalMessage =
    "my knee's feeling a lot better now, but I think I tweaked my ankle earlier and my" +
    " shoulder's still bugging me too";

  it("the athlete's original scenario: fires only when the model captures 0 of the 3 real facts", async () => {
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" }).mockResolvedValueOnce({
      reply: "Got it, noted the ankle.",
      coach_note: "New ankle tweak.",
      injury_flag: [{ text: "tweaked ankle" }],
    });

    const result = await requestCoachReply(
      injuryTurnState({
        trimmed: athleteOriginalMessage,
        geminiMessage: athleteOriginalMessage,
      }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(1);
  });

  it("the athlete's original scenario: stays silent once the model captures even 1 of the 3 real facts", async () => {
    askGemini.mockResolvedValueOnce({
      reply: "Got it, noted the ankle.",
      coach_note: "New ankle tweak.",
      injury_flag: [{ text: "tweaked ankle" }],
    });

    await requestCoachReply(
      injuryTurnState({
        trimmed: athleteOriginalMessage,
        geminiMessage: athleteOriginalMessage,
      }),
    );

    // Only 1 distinct keyword mention exists in this phrasing ("tweaked"), so once 1 entry lands
    // the count check is already satisfied - even though the knee-resolving and shoulder facts
    // are still missing. This is the detector's known lower-bound limitation, not a bug: it can
    // only count what has injury-keyword language, and this phrasing only gives it one hit.
    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  // Code review finding on the #1037 PR D collapsing logic: the original word-distance-only
  // design compared each hit to the last RAW hit instead of the last COUNTED hit, and even fixing
  // that comparison-basis bug alone isn't enough, because three genuinely distinct injuries named
  // close together have keyword gaps similar to one injury restated nearby - pure word-distance
  // can't tell the two shapes apart. This is the review's own counterexample, verbatim: three real
  // injuries roughly 5 words apart pairwise, which the old design collapsed into 1 mention and
  // would have silently dropped 2 of them. The location-word-based rewrite must count all 3.
  it("counts three distinct injuries named close together (review's own counterexample)", async () => {
    const threeInjuryMessage = "My ankle hurts, my knee hurts too, and my shoulder is sore";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the ankle and knee.",
        coach_note: "Ankle and knee soreness.",
        injury_flag: [{ text: "ankle" }, { text: "knee" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted all three.",
        coach_note: "Ankle, knee, and shoulder soreness.",
        injury_flag: [{ text: "ankle" }, { text: "knee" }, { text: "shoulder" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: threeInjuryMessage, geminiMessage: threeInjuryMessage }),
    );

    // 2 captured against 3 real distinct mentions - only detectable if the detector counts all 3
    // rather than collapsing them down to 1 the way the old word-distance-only design did.
    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(3);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("fewer injury_flag/injury_event entries");
  });

  // Adapted version of the athlete's original scenario above with a phrasing that actually gives
  // the knee its own matching keyword ("still sore" instead of "feeling a lot better", which
  // INJURY_LANGUAGE_PATTERN doesn't match at all - see the documented limitation on the test
  // above). This variant has 2 real keyword hits with 2 different location words (knee, ankle),
  // which is what actually exercises the location-based collapsing on this scenario's shape.
  it("counts the knee and ankle as 2 distinct mentions when both carry matching keywords", async () => {
    const message =
      "my knee's still sore, but I think I tweaked my ankle earlier and my shoulder's" +
      " still bugging me too";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the ankle.",
        coach_note: "New ankle tweak.",
        injury_flag: [{ text: "tweaked ankle" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted the ankle and knee.",
        coach_note: "New ankle tweak, knee still sore.",
        injury_flag: [{ text: "tweaked ankle" }],
        injury_event: [{ status: "active", flag_id: "inj_1" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    const injuryFlagCount = ("reply" in result && result.reply.injury_flag?.length) || 0;
    const injuryEventCount = ("reply" in result && result.reply.injury_event?.length) || 0;
    expect(injuryFlagCount + injuryEventCount).toBe(2);
  });

  // Fallback path: neither hit has a location word anywhere nearby, so there's nothing for the
  // location-based signal to go on and the detector falls back to word-distance from the last
  // counted hit, same as the old design. Not claiming this fallback is perfect - just checking it
  // isn't obviously broken: two bare "hurting" mentions separated by a long, unrelated stretch of
  // text (well past the 12-word collapse window) should still count as 2 distinct mentions rather
  // than collapsing to 1.
  it("falls back to word-distance when no location word is present near either hit", async () => {
    const message =
      "it's really been hurting a lot today and I genuinely don't know why, it's been going" +
      " on like this for weeks now and honestly it just started hurting again in a totally" +
      " different way this afternoon";
    askGemini.mockResolvedValueOnce({ reply: "ok", coach_note: "note" }).mockResolvedValueOnce({
      reply: "Noted.",
      coach_note: "Ongoing discomfort, unclear cause.",
      injury_event: [{ status: "active", flag_id: "inj_1" }],
    });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    // 1 captured against 2 fallback-counted mentions - only fires if the word-distance fallback
    // still recognizes these as 2 distinct hits rather than collapsing them to 1.
    expect(askGemini).toHaveBeenCalledTimes(2);
    const injuryEventCount = ("reply" in result && result.reply.injury_event?.length) || 0;
    expect(injuryEventCount).toBe(1);
  });

  // Laterality fix: nearestLocationWord used to return the bare body-part word ("knee"), so both
  // sides of a paired injury collapsed onto the same key. Needs its own matching keyword per side
  // to exercise this - "and my right knee both hurt" has only one keyword hit total ("hurt"), which
  // countDistinctInjuryMentions can never split into 2 regardless of location matching, so this
  // phrases each side with its own hit ("hurts" ... "hurts too").
  it("counts left and right sides of the same body part as 2 distinct mentions", async () => {
    const message = "my left knee hurts and my right knee hurts too";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the left knee.",
        coach_note: "Left knee soreness.",
        injury_flag: [{ text: "left knee" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted both knees.",
        coach_note: "Left and right knee soreness.",
        injury_flag: [{ text: "left knee" }, { text: "right knee" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
    const repromptMessage = askGemini.mock.calls[1]?.[5] as string;
    expect(repromptMessage).toContain("fewer injury_flag/injury_event entries");
  });

  // Laterality is optional, never required - a single-sided mention with no "left"/"right" on
  // the other side must still behave exactly as before the fix (1 distinct mention).
  it("still counts a single-sided mention as 1 distinct mention (laterality unchanged when absent)", async () => {
    const message = "my left knee hurts";
    askGemini.mockResolvedValueOnce({
      reply: "Noted.",
      coach_note: "Left knee soreness.",
      injury_flag: [{ text: "left knee" }],
    });

    await requestCoachReply(injuryTurnState({ trimmed: message, geminiMessage: message }));

    expect(askGemini).toHaveBeenCalledTimes(1);
  });

  // Vocabulary fix: body-part terms outside the original ~40-word list (including 2-word terms
  // like "IT band" and "rotator cuff") now match LOCATION_PATTERN, so two mentions naming
  // different new terms count as 2 distinct injuries instead of falling back to the weaker
  // word-distance path. Each case needs its own keyword hit, same reasoning as the laterality
  // tests above.
  it("counts distinct mentions using newly-added vocabulary, including multi-word terms", async () => {
    const message = "my IT band is sore and my glute also hurts";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the IT band.",
        coach_note: "IT band soreness.",
        injury_flag: [{ text: "IT band" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted both.",
        coach_note: "IT band and glute soreness.",
        injury_flag: [{ text: "IT band" }, { text: "glute" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
  });

  it("counts distinct mentions across rotator cuff and plantar fascia (multi-word vocabulary)", async () => {
    const message = "my rotator cuff is sore and my plantar fascia also hurts";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the rotator cuff.",
        coach_note: "Rotator cuff soreness.",
        injury_flag: [{ text: "rotator cuff" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted both.",
        coach_note: "Rotator cuff and plantar fascia soreness.",
        injury_flag: [{ text: "rotator cuff" }, { text: "plantar fascia" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
  });

  it("counts distinct mentions across tendinitis and meniscus (false-plural-suffix vocabulary)", async () => {
    const message = "my tendinitis flared up and now my meniscus hurts too";
    askGemini
      .mockResolvedValueOnce({
        reply: "Noted the tendinitis.",
        coach_note: "Tendinitis flare.",
        injury_flag: [{ text: "tendinitis" }],
      })
      .mockResolvedValueOnce({
        reply: "Noted both.",
        coach_note: "Tendinitis and meniscus.",
        injury_flag: [{ text: "tendinitis" }, { text: "meniscus" }],
      });

    const result = await requestCoachReply(
      injuryTurnState({ trimmed: message, geminiMessage: message }),
    );

    expect(askGemini).toHaveBeenCalledTimes(2);
    expect("reply" in result && result.reply.injury_flag?.length).toBe(2);
  });
});
