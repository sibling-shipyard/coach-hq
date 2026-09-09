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
