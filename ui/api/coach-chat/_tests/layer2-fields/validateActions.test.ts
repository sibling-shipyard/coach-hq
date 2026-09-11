import { describe, it, expect } from "vitest";
import {
  validateQuestEvents,
  validateInjuryEvents,
  validateTemplateEdit,
  validateSessionPlan,
  validateWeekUpdate,
  synthesizeQuestEventFromUnrecordedFacts,
  type QuestForSynthesis,
  type ExistingSessionForDiff,
} from "../../_lib/decide/turnWrites/validateActions.js";

// D1 layer 3 (#736): pre-validate before any write is built, so a bad reference never reaches
// the applier's own throw-inside-commit guard in normal operation.
describe("validateQuestEvents", () => {
  it("keeps events whose quest_id is in the valid set", () => {
    const events = [{ quest_id: "q1", status: "completed" as const }];
    const { valid, dropped } = validateQuestEvents(events, new Set(["q1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose quest_id is not in the valid set, keeping the rest", () => {
    const good = { quest_id: "q1", status: "completed" as const };
    const bad = { quest_id: "q99", status: "completed" as const };
    const { valid, dropped } = validateQuestEvents([good, bad], new Set(["q1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([{ field: "quest_event", reason: expect.stringContaining('"q99"') }]);
  });
});

describe("validateInjuryEvents", () => {
  it("keeps events whose flag_id is in the valid set", () => {
    const events = [{ status: "resolved" as const, flag_id: "inj_1" }];
    const { valid, dropped } = validateInjuryEvents(events, new Set(["inj_1"]));
    expect(valid).toEqual(events);
    expect(dropped).toEqual([]);
  });

  it("drops events whose flag_id is not in the valid set, keeping the rest", () => {
    const good = { status: "resolved" as const, flag_id: "inj_1" };
    const bad = { status: "active" as const, flag_id: "inj_bogus" };
    const { valid, dropped } = validateInjuryEvents([good, bad], new Set(["inj_1"]));
    expect(valid).toEqual([good]);
    expect(dropped).toEqual([
      { field: "injury_event", reason: expect.stringContaining('"inj_bogus"') },
    ]);
  });
});

describe("validateTemplateEdit", () => {
  it("passes through a template_edit whose template_id is in the valid set", () => {
    const edit = { template_id: "t1", note: "swap in a bench press" };
    const { valid, dropped } = validateTemplateEdit(edit, new Set(["t1"]));
    expect(valid).toEqual(edit);
    expect(dropped).toEqual([]);
  });

  it("drops a template_edit whose template_id is not in the valid set", () => {
    const edit = { template_id: "t_bogus", note: "swap in a bench press" };
    const { valid, dropped } = validateTemplateEdit(edit, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "template_edit", reason: expect.stringContaining('"t_bogus"') },
    ]);
    expect(dropped[0].kind).toBeUndefined();
  });

  it("passes through undefined untouched", () => {
    const { valid, dropped } = validateTemplateEdit(undefined, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([]);
  });
});

describe("validateSessionPlan", () => {
  it("passes through a session_plan whose template_id is in the valid set", () => {
    const plan = { template_id: "t1" };
    const { valid, dropped } = validateSessionPlan(plan, new Set(["t1"]));
    expect(valid).toEqual(plan);
    expect(dropped).toEqual([]);
  });

  it("drops a session_plan whose template_id is not in the valid set", () => {
    const plan = { template_id: "t_bogus" };
    const { valid, dropped } = validateSessionPlan(plan, new Set(["t1"]));
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "session_plan", reason: expect.stringContaining('"t_bogus"') },
    ]);
  });
});

describe("validateWeekUpdate", () => {
  // Every patch test below targets 2026-08-17/2026-08-19, so this is the one real week those
  // dates belong to - passed as validDayDates unless a test is deliberately checking a date
  // outside it.
  const REAL_WEEK_DATES = new Set([
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ]);

  it("passes a full-week-kickoff-shaped update through untouched, no session_id or date checks", () => {
    const kickoff = {
      headline: "Steady week ahead.",
      body: "Focus on consistency.",
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-08-${17 + i}`,
        sessions: [],
      })),
    };
    const { valid, dropped } = validateWeekUpdate(kickoff, new Set(), new Set(), new Map(), "");
    expect(valid).toEqual(kickoff);
    expect(dropped).toEqual([]);
  });

  it("returns undefined, no drops, when update itself is undefined", () => {
    const { valid, dropped } = validateWeekUpdate(undefined, new Set(), new Set(), new Map(), "");
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([]);
  });

  it("keeps a patch entry whose session_id is in the valid set", () => {
    const update = {
      days: [{ date: "2026-08-17", sessions: [{ session_id: "s1", status: "done" as const }] }],
    };
    const { valid, dropped } = validateWeekUpdate(
      update,
      REAL_WEEK_DATES,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toEqual(update);
    expect(dropped).toEqual([]);
  });

  it("drops a patch entry whose session_id is not in the valid set, keeping the rest", () => {
    const good = { session_id: "s1", status: "done" as const };
    const bad = { session_id: "s_bogus", status: "skipped" as const };
    const { valid, dropped } = validateWeekUpdate(
      { days: [{ date: "2026-08-17", sessions: [good, bad] }] },
      REAL_WEEK_DATES,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toEqual({ days: [{ date: "2026-08-17", sessions: [good] }] });
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining('"s_bogus"') },
    ]);
  });

  it("keeps a brand-new session (no session_id) without checking it against valid ids", () => {
    const update = {
      days: [
        { date: "2026-08-19", sessions: [{ discipline: "run", kind: "easy", title: "Easy run" }] },
      ],
    };
    const { valid, dropped } = validateWeekUpdate(
      update,
      REAL_WEEK_DATES,
      new Set(),
      new Map(),
      "",
    );
    expect(valid).toEqual(update);
    expect(dropped).toEqual([]);
  });

  it("returns undefined when every entry gets dropped and nothing else is left", () => {
    const { valid, dropped } = validateWeekUpdate(
      {
        days: [
          { date: "2026-08-17", sessions: [{ session_id: "s_bogus", status: "done" as const }] },
        ],
      },
      REAL_WEEK_DATES,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toBeUndefined();
    expect(dropped).toHaveLength(1);
  });

  it("keeps a day that only patches intent, even with no sessions", () => {
    const update = { days: [{ date: "2026-08-17", intent: "recovery" }] };
    const { valid, dropped } = validateWeekUpdate(
      update,
      REAL_WEEK_DATES,
      new Set(),
      new Map(),
      "",
    );
    expect(valid).toEqual({ days: [{ date: "2026-08-17", intent: "recovery", sessions: [] }] });
    expect(dropped).toEqual([]);
  });

  // Review finding (P0): validateWeekUpdate never checked day.date or move_to_date against the
  // real week, so a hallucinated date sailed through to applyWeekUpdate's own throw instead of
  // being dropped here like every other bad reference.
  it("drops a whole day entry whose date isn't in the current week", () => {
    const update = {
      days: [{ date: "2099-01-01", sessions: [{ session_id: "s1", status: "done" as const }] }],
    };
    const { valid, dropped } = validateWeekUpdate(
      update,
      REAL_WEEK_DATES,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining('"2099-01-01"') },
    ]);
  });

  it("keeps valid days, drops only the one with a hallucinated date", () => {
    const good = { date: "2026-08-17", sessions: [{ session_id: "s1", status: "done" as const }] };
    const bad = { date: "2099-01-01", sessions: [{ session_id: "s2", status: "done" as const }] };
    const { valid, dropped } = validateWeekUpdate(
      { days: [good, bad] },
      REAL_WEEK_DATES,
      new Set(["s1", "s2"]),
      new Map(),
      "",
    );
    expect(valid).toEqual({ days: [good] });
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining('"2099-01-01"') },
    ]);
  });

  it("drops a session entry whose move_to_date isn't in the current week, keeping other sessions on the same day", () => {
    const good = { session_id: "s1", status: "done" as const };
    const bad = { session_id: "s2", move_to_date: "2099-01-01" };
    const { valid, dropped } = validateWeekUpdate(
      { days: [{ date: "2026-08-17", sessions: [good, bad] }] },
      REAL_WEEK_DATES,
      new Set(["s1", "s2"]),
      new Map(),
      "",
    );
    expect(valid).toEqual({ days: [{ date: "2026-08-17", sessions: [good] }] });
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining('"2099-01-01"') },
    ]);
  });

  it("keeps a move to a real day this week", () => {
    const update = {
      days: [{ date: "2026-08-17", sessions: [{ session_id: "s1", move_to_date: "2026-08-19" }] }],
    };
    const { valid, dropped } = validateWeekUpdate(
      update,
      REAL_WEEK_DATES,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toEqual(update);
    expect(dropped).toEqual([]);
  });
});

// Finding E (2026-09-10 pro baseline): the model confabulates a false refusal instead of
// complying with a correctly-detected, correctly-reprompted quest completion - a compliance
// failure a third model call has already been shown live not to fix. This synthesizes the
// completion deterministically instead, but only when unambiguous.
describe("synthesizeQuestEventFromUnrecordedFacts", () => {
  const proteinQuest: QuestForSynthesis = {
    id: "protein",
    name: "Protein Target",
    status: "active",
  };
  const coldShowerQuest: QuestForSynthesis = {
    id: "cold_shower",
    name: "Cold Shower",
    status: "active",
  };
  const retiredQuest: QuestForSynthesis = { id: "old_quest", name: "Old Quest", status: "retired" };

  it("returns null when there are no unrecorded facts", () => {
    expect(synthesizeQuestEventFromUnrecordedFacts(null, [proteinQuest], new Set())).toBeNull();
    expect(synthesizeQuestEventFromUnrecordedFacts([], [proteinQuest], new Set())).toBeNull();
  });

  it("returns null when no unrecorded fact reads as a completion claim", () => {
    const facts = ["Athlete mentioned moving to a new apartment next month."];
    expect(synthesizeQuestEventFromUnrecordedFacts(facts, [proteinQuest], new Set())).toBeNull();
  });

  it("synthesizes when the sole active quest's own name is referenced in the fact", () => {
    const facts = ["Completed protein target for today, but quest_event wasn't set."];
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [proteinQuest], new Set());
    expect(result).toEqual({ quest_id: "protein", status: "completed" });
  });

  // A single remaining active quest is not the winner by elimination on its own - a real name
  // match is required regardless of how many candidates exist, since the fact could plausibly be
  // about something else entirely that happens to use completion language.
  it("does not synthesize against the sole active quest when the fact never names it", () => {
    const facts = ["Finished packing my bags for the trip tomorrow."];
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [proteinQuest], new Set());
    expect(result).toBeNull();
  });

  it("synthesizes when multiple quests exist but exactly one name-matches the fact", () => {
    const facts = ["Hit the protein target again today, but no quest_event was set."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest, coldShowerQuest],
      new Set(),
    );
    expect(result).toEqual({ quest_id: "protein", status: "completed" });
  });

  it("returns null (genuine ambiguity) when multiple quests exist and none name-match", () => {
    const facts = ["Finished the workout today, but nothing was logged."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest, coldShowerQuest],
      new Set(),
    );
    expect(result).toBeNull();
  });

  it("excludes quests already handled this turn", () => {
    const facts = ["Completed protein target for today."];
    const result = synthesizeQuestEventFromUnrecordedFacts(
      facts,
      [proteinQuest],
      new Set(["protein"]),
    );
    expect(result).toBeNull();
  });

  it("excludes non-active quests entirely", () => {
    const facts = ["Completed the old quest again today."];
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [retiredQuest], new Set());
    expect(result).toBeNull();
  });

  // Review finding (P0): a quest name carrying regex metacharacters must not crash the whole
  // turn - defensive even though the current word-extraction step already strips them first.
  it("does not throw on a quest name containing regex metacharacters", () => {
    const weirdQuest: QuestForSynthesis = {
      id: "weird",
      name: "7hrs (Sleep) [target]+.*?",
      status: "active",
    };
    const facts = ["Hit my 7hrs sleep target again, but quest_event wasn't set."];
    expect(() =>
      synthesizeQuestEventFromUnrecordedFacts(facts, [weirdQuest], new Set()),
    ).not.toThrow();
    const result = synthesizeQuestEventFromUnrecordedFacts(facts, [weirdQuest], new Set());
    expect(result).toEqual({ quest_id: "weird", status: "completed" });
  });
});

// Bug 3 (2026-09-10 pro baseline, real diff-confirmed): a real conversation showed the coach ask
// an unanswered clarifying question, then silently overwrite a real scheduled football match with
// a recovery walk anyway - a real session_id, so the plain existence check never caught it. These
// tests exercise the content-diff guard, now shared by every patch entry that sets discipline -
// whether it's a plain content edit or a status change with actual differing from plan (ADR 0042
// collapsed both into the same session entry).
describe("validateWeekUpdate content-diff guard (Bug 3)", () => {
  const footballSession: ExistingSessionForDiff = {
    id: "s_saturday",
    discipline: "football",
    kind: "match",
  };
  const existingSessions = new Map([["s_saturday", footballSession]]);

  function patchOf(session: Record<string, unknown>) {
    return { days: [{ date: "2026-08-22", sessions: [session] }] };
  }
  const VALID_DATE = new Set(["2026-08-22"]);

  it("drops a category-changing edit when the athlete's message has no confirmation cue", () => {
    const session = {
      session_id: "s_saturday",
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining("unconfirmed assumption") },
    ]);
  });

  it("keeps a category-changing edit when the athlete's message contains a confirmation cue", () => {
    const session = {
      session_id: "s_saturday",
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "Yes, drop the football and do the walk instead.",
    );
    expect(valid).toEqual(patchOf(session));
    expect(dropped).toEqual([]);
  });

  // "drop the" alone is one of the confirmation phrases, so an explicit refusal containing those
  // words must still read as unconfirmed, not as agreement with the opposite of what was said.
  it("still drops the edit when the message negates the very phrase that would otherwise confirm it", () => {
    const session = {
      session_id: "s_saturday",
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "I'm not sure, don't drop the football.",
    );
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining("unconfirmed assumption") },
    ]);
  });

  it("keeps an edit that doesn't change the session's category, confirmation or not", () => {
    const session = {
      session_id: "s_saturday",
      discipline: "football",
      kind: "match",
      title: "Football - away game",
    };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toEqual(patchOf(session));
    expect(dropped).toEqual([]);
  });

  it("keeps an edit when no existing-session data is supplied - nothing to compare against, so nothing to gate", () => {
    const session = { session_id: "s1", discipline: "run", kind: "easy", title: "Easy run" };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s1"]),
      new Map(),
      "",
    );
    expect(valid).toEqual(patchOf(session));
    expect(dropped).toEqual([]);
  });

  // A status-only patch (mark done, no discipline field at all) never touches the diff guard -
  // there's nothing proposed to compare against the existing category.
  it("does not gate a status-only patch with no discipline field at all", () => {
    const session = { session_id: "s_saturday", status: "done" as const };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "Done, just as planned.",
    );
    expect(valid).toEqual(patchOf(session));
    expect(dropped).toEqual([]);
  });

  it("gates a status change with a differing actual the same way a plain content edit is gated", () => {
    const session = {
      session_id: "s_saturday",
      status: "done" as const,
      discipline: "walk",
      kind: "recovery",
      title: "Easy Recovery Walk",
    };
    const { valid, dropped } = validateWeekUpdate(
      patchOf(session),
      VALID_DATE,
      new Set(["s_saturday"]),
      existingSessions,
      "That covers it, wrap this up.",
    );
    expect(valid).toBeUndefined();
    expect(dropped).toEqual([
      { field: "week_update", reason: expect.stringContaining("unconfirmed assumption") },
    ]);
  });
});
