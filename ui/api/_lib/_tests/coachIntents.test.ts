import { describe, it, expect } from "vitest";
import {
  applySessionNote,
  applyQuestEvents,
  applySleepStateMd,
  applySleepLogJson,
  applyCoachNote,
  type QuestEvent,
} from "../coachIntents.js";

// Fixtures below are trimmed excerpts of REAL content read from coach-akash/user_data/... and
// coach-skanda-2003/user_data/... (sibling athlete repo clones, not part of this repo) - not
// synthetic strings. The two repos disagree on the exact Sleep Log table shape, which is
// deliberately exercised here (see the "normalizes an ad hoc / bullet-style" test below).

// ── session_note (coach-akash/user_data/coach/state.md) ─────────────────────

const AKASH_STATE_MD_EXCERPT = `## Current Phase / Block Context
- **Build Phase - 20-day cut:** Focused pre-travel cut.

## Recent Session Notes *(rolling — last 3 sessions, updated each session)*
- **Day 139 (Mon Aug 3) — Badminton #51, 6W-1L (86%):** ~2h44m, avg HR 134. Lost the first game tight, then won 6 straight.
- **Day 130 (Thu Jul 30) — Hit & Run #39 (friendly), 4W-3L (57%):** ~1h51m, avg HR 148. Special session with a close group.
- **Day 129 (Wed Jul 29) — Calisthenics #33: FL + Handstand, moderate:** ~44m, avg HR 101, peak 156.

## Fitness Baseline
*Last updated: 2026-03-17*
- Push-ups: 30
`;

describe("applySessionNote", () => {
  it("prepends the new note as newest and drops the oldest of 3 (rolling window)", () => {
    const result = applySessionNote(AKASH_STATE_MD_EXCERPT, "Day 140 (Tue Aug 4) — Rest day, legs sore.");
    expect(result).toContain("- Day 140 (Tue Aug 4) — Rest day, legs sore.");
    // Newest first, right under the heading
    const lines = result.split("\n");
    const headingIdx = lines.findIndex((l) => l.startsWith("## Recent Session Notes"));
    expect(lines[headingIdx + 1]).toBe("- Day 140 (Tue Aug 4) — Rest day, legs sore.");
    // Oldest (Day 129) dropped
    expect(result).not.toContain("Day 129 (Wed Jul 29)");
    // The other two survive
    expect(result).toContain("Day 139 (Mon Aug 3)");
    expect(result).toContain("Day 130 (Thu Jul 30)");
    // Untouched sections still present, unchanged
    expect(result).toContain("## Fitness Baseline");
    expect(result).toContain("## Current Phase / Block Context");
  });

  it("keeps all entries when starting under the 3-entry window", () => {
    const oneEntry = `## Recent Session Notes *(rolling — last 3 sessions)*
- Day 1 — first ever session.

## Fitness Baseline
`;
    const result = applySessionNote(oneEntry, "Day 2 — second session.");
    expect(result).toContain("- Day 2 — second session.");
    expect(result).toContain("- Day 1 — first ever session.");
  });

  it("trims incoming note whitespace", () => {
    const result = applySessionNote(AKASH_STATE_MD_EXCERPT, "  Day 140 — padded.  ");
    expect(result).toContain("- Day 140 — padded.\n");
    expect(result).not.toContain("-   Day 140");
  });

  it("returns content unchanged when the section heading is missing", () => {
    const noSection = "## Fitness Baseline\n- Push-ups: 30\n";
    expect(applySessionNote(noSection, "new note")).toBe(noSection);
  });
});

// ── quest_events (coach-akash and coach-skanda-2003 challenge_v2.json) ──────

const AKASH_CHALLENGE_JSON = JSON.stringify({
  version: 4,
  last_updated_by: "coach",
  last_updated_at: "2026-08-04",
  coach_since: "2026-03-18",
  main_quest: {
    id: "build_sessions",
    name: "Weekly Structured Sessions",
    type: "count_target",
    target: 43,
    count_pattern: "^WeightTraining\\s*#",
  },
  quests: [
    {
      id: "visualization",
      name: "Mental Visualization",
      type: "daily_streak",
      category: "side",
      start_date: "2026-08-04",
      status: "active",
      polarity: "default_not_done",
      tracking: "manual",
      completed_dates: [],
      excused_dates: [],
      notes: "5 min visualization, pre-badminton anchor.",
    },
    {
      id: "reading",
      name: "Inner Game of Tennis",
      type: "progress",
      category: "side",
      start_date: "2026-01-01",
      status: "active",
      tracking: "manual",
      current: 4,
      target: 10,
      unit: "chapters",
    },
  ],
});

const SKANDA_CHALLENGE_JSON = JSON.stringify({
  version: 4,
  last_updated_by: "coach",
  last_updated_at: "2026-08-05",
  quests: [
    {
      id: "cold_shower",
      name: "Cold Shower",
      type: "daily_streak",
      category: "side",
      start_date: "2026-06-18",
      status: "active",
      polarity: "default_not_done",
      tracking: "manual",
      completed_dates: ["2026-08-04", "2026-08-05"],
      excused_dates: ["2026-07-05"],
      notes: "End every shower cold.",
    },
    {
      id: "sleep",
      name: "7hrs Sleep",
      type: "daily_streak",
      category: "side",
      start_date: "2026-06-18",
      status: "active",
      polarity: "default_not_done",
      tracking: "manual",
      completed_dates: ["2026-08-03", "2026-08-04"],
      excused_dates: [],
      notes: "7-7.5hrs of sleep.",
    },
  ],
});

describe("applyQuestEvents", () => {
  it("adds a date to completed_dates for a daily_streak quest, and stamps last_updated_*", () => {
    const events: QuestEvent[] = [{ quest_id: "visualization", date: "2026-08-06", status: "completed" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    expect(result.applied).toEqual(events);
    expect(result.skipped).toEqual([]);
    const doc = JSON.parse(result.content);
    expect(doc.last_updated_by).toBe("coach");
    expect(doc.last_updated_at).toBe("2026-08-06");
    const q = doc.quests.find((q: { id: string }) => q.id === "visualization");
    expect(q.completed_dates).toEqual(["2026-08-06"]);
  });

  it("moves a date between excused/completed/missed - never present in more than one array", () => {
    const events: QuestEvent[] = [{ quest_id: "cold_shower", date: "2026-08-04", status: "excused" }];
    const result = applyQuestEvents(SKANDA_CHALLENGE_JSON, events, "2026-08-06");
    const q = JSON.parse(result.content).quests.find((q: { id: string }) => q.id === "cold_shower");
    // Was in completed_dates in the fixture; the excused event should move it, not duplicate it
    expect(q.completed_dates).toEqual(["2026-08-05"]);
    expect(q.excused_dates.sort()).toEqual(["2026-07-05", "2026-08-04"]);
  });

  it("bumps current by 1 for a progress quest on status completed, clamped to target", () => {
    const events: QuestEvent[] = [{ quest_id: "reading", date: "2026-08-06", status: "completed" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    const q = JSON.parse(result.content).quests.find((q: { id: string }) => q.id === "reading");
    expect(q.current).toBe(5);
    expect(result.applied).toEqual(events);
  });

  it("does not bump a progress quest on a non-completed status", () => {
    const events: QuestEvent[] = [{ quest_id: "reading", date: "2026-08-06", status: "missed" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    const q = JSON.parse(result.content).quests.find((q: { id: string }) => q.id === "reading");
    expect(q.current).toBe(4);
    expect(result.skipped).toHaveLength(1);
    expect(result.applied).toEqual([]);
  });

  it("applies to main_quest when quest_id matches it (not just quests[])", () => {
    const events: QuestEvent[] = [{ quest_id: "build_sessions", date: "2026-08-06", status: "completed" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    const doc = JSON.parse(result.content);
    expect(doc.main_quest.completed_dates).toEqual(["2026-08-06"]);
    expect(result.applied).toEqual(events);
  });

  it("skips an event with an unknown quest_id, without touching the rest of the doc", () => {
    const events: QuestEvent[] = [{ quest_id: "does_not_exist", date: "2026-08-06", status: "completed" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/not found/);
    // last_updated_* still stamped even though nothing applied
    expect(JSON.parse(result.content).last_updated_at).toBe("2026-08-06");
  });

  it("skips an event with an unrecognized status for a daily_streak quest", () => {
    const events: QuestEvent[] = [{ quest_id: "visualization", date: "2026-08-06", status: "sort-of" }];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/unknown status/);
  });

  it("one bad event doesn't block other valid events in the same call", () => {
    const events: QuestEvent[] = [
      { quest_id: "nonexistent", date: "2026-08-06", status: "completed" },
      { quest_id: "visualization", date: "2026-08-06", status: "completed" },
    ];
    const result = applyQuestEvents(AKASH_CHALLENGE_JSON, events, "2026-08-06");
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it("returns the content unchanged (plus a skip per event) on invalid JSON input", () => {
    const events: QuestEvent[] = [{ quest_id: "visualization", date: "2026-08-06", status: "completed" }];
    const result = applyQuestEvents("{not valid json", events, "2026-08-06");
    expect(result.content).toBe("{not valid json");
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/not valid JSON/);
  });
});

// ── sleep (paired appliers) ──────────────────────────────────────────────────

// Real ad hoc format from coach-akash/user_data/coach/state.md: header line with no wrapping
// pipes, rows prefixed with "- " and pipe-delimited, no separator row.
const AKASH_SLEEP_SECTION = `## Fitness Baseline
- Push-ups: 30

## Sleep Log (rolling 7 days)
Date | Sleep | Score (1-10) | Resting HR | Notes
- 2026-04-06 | 7h19m | — | — | REM 24%, deep 12%
- 2026-04-07 | 6h54m | — | — | REM 28%, deep 14%. Cough disrupted sleep.
- 2026-04-08 | 8h4m | — | — | REM 24%, deep 8%. Recovery night.

## Active Injury Flags
- None.
`;

// Real standard-markdown-table format from coach-skanda-2003/user_data/coach/state.md.
const SKANDA_SLEEP_SECTION = `## Fitness Baseline
- Some baseline.

## Sleep Log (rolling 7 days)
*Rolling 7-day window. Drop oldest when adding new.*

| Date | Sleep | Resting HR | Notes |
|------|-------|------------|-------|
| 2026-07-31 | 8hrs | — | hit target |
| 2026-08-01 | 7h30m | — | hit target, wake-up excused |
| 2026-08-02 | 6h20m | — | below target, not excused |
| 2026-08-03 | 7h30m | — | project work |
| 2026-08-04 | 7hrs | — | hit target |
| 2026-08-05 | 8hrs | — | hit target, wake-up excused |

## Active Injury Flags
- Right elbow.
`;

describe("applySleepStateMd", () => {
  it("adds a new row, formats hours as XhYm, and normalizes the ad hoc bullet format to a standard table", () => {
    const result = applySleepStateMd(AKASH_SLEEP_SECTION, { date: "2026-04-09", hours: 6.5 });
    expect(result).toContain("| 2026-04-09 | 6h30m |");
    // Now a proper pipe table with a separator row
    expect(result).toMatch(/\|\s*Date\s*\|.*\n\|-+\|/);
    // Existing rows preserved
    expect(result).toContain("2026-04-06");
    expect(result).toContain("2026-04-08");
    // Untouched sections intact
    expect(result).toContain("## Fitness Baseline");
    expect(result).toContain("## Active Injury Flags");
  });

  it("upserts (replaces) a row for a date that's already logged instead of duplicating it", () => {
    const result = applySleepStateMd(SKANDA_SLEEP_SECTION, { date: "2026-08-05", hours: 9 });
    const matches = result.match(/2026-08-05/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(result).toContain("| 2026-08-05 | 9h |");
  });

  it("enforces the 7-row rolling window, dropping the oldest date once over the limit", () => {
    // SKANDA_SLEEP_SECTION already has 6 rows (07-31 .. 08-05); adding two new ones should push
    // out the oldest.
    let result = applySleepStateMd(SKANDA_SLEEP_SECTION, { date: "2026-08-06", hours: 7 });
    result = applySleepStateMd(result, { date: "2026-08-07", hours: 8 });
    expect(result).not.toContain("2026-07-31");
    expect(result).toContain("2026-08-01");
    expect(result).toContain("2026-08-07");
    const rowCount = (result.match(/\| 2026-/g) ?? []).length;
    expect(rowCount).toBe(7);
  });

  it("returns content unchanged when the Sleep Log section is missing", () => {
    const noSection = "## Fitness Baseline\n- Push-ups: 30\n";
    expect(applySleepStateMd(noSection, { date: "2026-08-06", hours: 7 })).toBe(noSection);
  });

  it("formats whole hours without minutes", () => {
    const result = applySleepStateMd(SKANDA_SLEEP_SECTION, { date: "2026-08-06", hours: 8 });
    expect(result).toContain("| 2026-08-06 | 8h |");
  });
});

describe("applySleepLogJson", () => {
  it("appends a new entry to an empty array (coach-akash's sleep_log.json is [])", () => {
    const result = applySleepLogJson("[]", { date: "2026-08-06", hours: 7.5 });
    const arr = JSON.parse(result);
    expect(arr).toEqual([{ date: "2026-08-06", hours: 7.5, resting_hr: null, notes: "" }]);
  });

  it("upserts hours for an existing date, preserving resting_hr/notes already on that record", () => {
    // Real shape from coach-skanda-2003/user_data/coach/sleep_log.json
    const existing = JSON.stringify([
      { date: "2026-08-04", hours: 7.0, resting_hr: 58, notes: "hit target, wake-up not excused" },
      { date: "2026-08-05", hours: 8.0, resting_hr: null, notes: "2am-10am, hit target" },
    ]);
    const result = applySleepLogJson(existing, { date: "2026-08-04", hours: 7.25 });
    const arr = JSON.parse(result);
    expect(arr).toHaveLength(2);
    const entry = arr.find((r: { date: string }) => r.date === "2026-08-04");
    expect(entry.hours).toBe(7.25);
    expect(entry.resting_hr).toBe(58);
    expect(entry.notes).toBe("hit target, wake-up not excused");
  });

  it("appends a new date and keeps the array sorted ascending", () => {
    const existing = JSON.stringify([{ date: "2026-08-01", hours: 7, resting_hr: null, notes: "" }]);
    const result = applySleepLogJson(existing, { date: "2026-07-30", hours: 6 });
    const arr = JSON.parse(result);
    expect(arr.map((r: { date: string }) => r.date)).toEqual(["2026-07-30", "2026-08-01"]);
  });

  it("treats malformed JSON as an empty log rather than throwing", () => {
    const result = applySleepLogJson("{not an array", { date: "2026-08-06", hours: 7 });
    const arr = JSON.parse(result);
    expect(arr).toEqual([{ date: "2026-08-06", hours: 7, resting_hr: null, notes: "" }]);
  });

  it("does not keep only a rolling window - full history is retained (unlike the state.md table)", () => {
    const many = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, hours: 7, resting_hr: null, notes: "" })),
    );
    const result = applySleepLogJson(many, { date: "2026-01-11", hours: 7 });
    expect(JSON.parse(result)).toHaveLength(11);
  });
});

// ── coach_note (coach-akash/user_data/coach/coach_notes.md) ─────────────────

const AKASH_COACH_NOTES_TAIL = `---
## Day 130 (Thu Jul 30) — Hit & Run #39 (friendly)

**Result: 4W-3L (57%).** Special session with a close group, one friend leaving London soon.
`;

describe("applyCoachNote", () => {
  it("appends a dated entry in the P0-specified format: \\n\\n## <date>\\n<note>", () => {
    const result = applyCoachNote(AKASH_COACH_NOTES_TAIL, "Sky mentioned new job stress affecting sleep.", "2026-08-06");
    expect(result).toBe(
      AKASH_COACH_NOTES_TAIL + "\n\n## 2026-08-06\nSky mentioned new job stress affecting sleep.",
    );
  });

  it("trims the note but does not otherwise reformat it", () => {
    const result = applyCoachNote("", "  padded note  ", "2026-08-06");
    expect(result).toBe("\n\n## 2026-08-06\npadded note");
  });
});
