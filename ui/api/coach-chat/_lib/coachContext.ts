/**
 * Translation layer between stored athlete data and the prompt text Gemini sees. Part 1 of the
 * coach-memory redesign (coach-redesign-part1-memory.md). Reads profile.json/memory.json/
 * injuries.json/coach_log.json and reproduces the same section shape (same headers, same content
 * under each) that state.md's prose used to carry - SOUL refers to these sections by name, never
 * by file path, so the section structure is the contract, not byte-for-byte prose.
 *
 * This is no longer byte-identical to the old state.md-based output (the underlying data source
 * changed - state.md is gone), but every section SOUL expects to find (Athlete Profile, Equipment,
 * Fitness Baseline, Coaching Priorities, Learned Patterns x3, Active Injury Flags, Recent Session
 * Notes) is still produced, under the same header text.
 *
 * Only reconstructs the sections backed by the four files this redesign step actually migrated.
 * state.md's Current Season / Phase-Block / RPE Calibration / Sleep Log / Current Week Plan
 * sections were never moved into profile/memory/injuries/coach_log - coach-redesign-part1-
 * memory.md scopes those to a later part - so they're not reproduced here. Flagged in the PR
 * report as a judgment call, not silently dropped.
 */
import type { ProfileJson, MemoryJson, InjuriesJson, CoachLogJson } from "./coachMemoryFiles.js";
import type { SeasonsJson, QuestsJson, ProgressJson, ProgressionsJson } from "./coachQuestFiles.js";

export interface CoachContextStorage {
  profile: ProfileJson | null;
  memory: MemoryJson | null;
  injuries: InjuriesJson | null;
  coachLog: CoachLogJson | null;
}

export interface QuestContextStorage {
  seasons: SeasonsJson | null;
  quests: QuestsJson | null;
  progress: ProgressJson | null;
  progressions: ProgressionsJson | null;
  // Athlete-local date (YYYY-MM-DD, same as todayDateString elsewhere) - needed to scope
  // weekly_frequency quests to the current ISO week. Found in review: this quest type had no
  // week-scoped handling at all before.
  today: string;
}

const RECENT_SESSION_WINDOW = 5;

function computeAge(dob: string | null): string {
  if (!dob) return "";
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return "";
  const today = new Date();
  let age = today.getUTCFullYear() - parsed.getUTCFullYear();
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > parsed.getUTCMonth() ||
    (today.getUTCMonth() === parsed.getUTCMonth() && today.getUTCDate() >= parsed.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return String(age);
}

function profileSection(profile: ProfileJson | null, memory: MemoryJson | null): string {
  const sports = memory?.sports?.filter((s) => s.trim()).join(", ") ?? "";
  const lines = [
    "## Athlete Profile",
    `- **Name:** ${profile?.name ?? ""}`,
    `- **Sport(s) / Activities:** ${sports}`,
    `- **Coaching style preference:** ${memory?.coaching_style ?? ""}`,
    `- **Age:** ${computeAge(profile?.dob ?? null)}`,
    `- **Height:** ${profile?.height_cm != null ? `${profile.height_cm} cm` : ""}`,
    `- **Weight:** ${profile?.weight_kg != null ? `${profile.weight_kg} kg` : ""}`,
    `- **Timezone:** ${profile?.timezone ?? "UTC"}`,
  ];
  return lines.join("\n");
}

function equipmentSection(memory: MemoryJson | null): string {
  const text = memory?.notes?.equipment?.text?.trim();
  return ["## Equipment", text || "*(None recorded)*"].join("\n");
}

function recentSessionNotesSection(coachLog: CoachLogJson | null): string {
  const rows = coachLog?.rows ?? [];
  const recent = rows.slice(-RECENT_SESSION_WINDOW).reverse(); // most recent first
  const body = recent.length > 0 ? recent.map((r) => `- **${r.date}:** ${r.text}`).join("\n") : "*(Empty)*";
  return [`## Recent Session Notes *(rolling — last ${RECENT_SESSION_WINDOW} sessions)*`, body].join("\n");
}

function fitnessBaselineSection(memory: MemoryJson | null): string {
  const text = memory?.notes?.fitness_baseline?.text?.trim();
  return ["## Fitness Baseline", text || "*(Not yet built)*"].join("\n");
}

function activeInjuryFlagsSection(injuries: InjuriesJson | null): string {
  const flags = (injuries?.flags ?? []).filter((f) => f.status === "active");
  const body =
    flags.length > 0
      ? flags.map((f) => `- **${f.id}:** ${f.text}`).join("\n")
      : "*(None)*";
  return ["## Active Injury Flags", body].join("\n");
}

function coachingPrioritiesSection(memory: MemoryJson | null): string {
  const text = memory?.notes?.coaching_priorities?.text?.trim();
  return ["## Coaching Priorities", text || "*(Not yet built)*"].join("\n");
}

function learnedPatternsSection(memory: MemoryJson | null): string {
  const training = memory?.notes?.["learned_patterns.training"]?.text?.trim();
  const nutrition = memory?.notes?.["learned_patterns.nutrition"]?.text?.trim();
  const mental = memory?.notes?.["learned_patterns.mental"]?.text?.trim();
  return [
    "## Learned Patterns",
    "**Training:**",
    training || "*(Not yet built)*",
    "**Nutrition:**",
    nutrition || "*(Not yet built)*",
    "**Mental / Performance:**",
    mental || "*(Not yet built)*",
  ].join("\n");
}

// Part 2 ledger split retired the precomputed quest artifact. renderQuestContext now builds the
// same useful sections (Current Season, Main Quest, Side Quests) directly from
// seasons.json/quests.json/progress.json, including the real ids Gemini needs for writes.
// Monday-Sunday ISO week containing `today` (a YYYY-MM-DD string) - plain date-string math in
// UTC, matching how ProgressRow.date is already compared elsewhere in this function, rather than
// pulling in a timezone since `today` is already resolved to the athlete's local date by the
// caller (todayDateString).
function isoWeekBounds(today: string): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const isoDay = d.getUTCDay() || 7; // Sunday from getUTCDay() is 0 - treat as 7 so Monday=1..Sunday=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - isoDay + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday) };
}

// Found in review, two separate gaps:
// 1. No season_id filter - progress.json accumulates rows across every season forever
//    (coach-redesign-part2-ledger.md: "seasons[] grows unbounded... season_id stamped on every
//    row"), so a quest reused in a later season had its counts computed across ALL history, not
//    just the current season. Now filters by season_id too, same as quest_id.
// 2. weekly_frequency had no distinct handling - it fell into the same all-time completed/
//    excused/missed tally as daily_streak, when its actual semantics ("a target count within the
//    current week") need a week-scoped count instead. Now returns thisWeekCompleted alongside
//    the all-time counts.
function questProgressCounts(
  progress: ProgressJson | null,
  questId: string,
  // "" (not null) is "no current season" - matches ProgressRow.season_id's non-nullable string
  // type and the write path's own fallback (coach-chat.ts). Found in review: this was typed
  // `string | null` while the write side never produces null, only "".
  seasonId: string,
  weekBounds: { start: string; end: string },
): { completed: number; excused: number; missed: number; latestValue: string | null; thisWeekCompleted: number } {
  // Found in review: `seasonId == null` used to bypass the season filter entirely (fall back to
  // showing ALL history), which is backwards - a missing current season should mean nothing
  // counts as "this season's" progress, not "show unscoped history across every season." That
  // fallback would have reintroduced the exact leakage this filter exists to prevent, just
  // triggered by a missing current_season_id instead of a genuinely reused quest_id. Dropping the
  // bypass: `r.season_id === seasonId` alone naturally yields zero rows when seasonId is null,
  // since no real row ever has a null season_id.
  const rows = (progress?.rows ?? []).filter((r) => r.quest_id === questId && r.season_id === seasonId);
  let completed = 0;
  let excused = 0;
  let missed = 0;
  let thisWeekCompleted = 0;
  let latestValue: string | null = null;
  let latestDate = "";
  for (const row of rows) {
    if (row.status === "completed") {
      completed += 1;
      if (row.date >= weekBounds.start && row.date <= weekBounds.end) thisWeekCompleted += 1;
    } else if (row.status === "excused") {
      excused += 1;
    } else if (row.status === "missed") {
      missed += 1;
    }
    if (row.value != null && row.date >= latestDate) {
      latestDate = row.date;
      latestValue = String(row.value);
    }
  }
  return { completed, excused, missed, latestValue, thisWeekCompleted };
}

export function renderQuestContext(storage: QuestContextStorage): string {
  const { seasons, quests, progress, progressions, today } = storage;
  const currentSeason = seasons?.seasons.find((s) => s.id === seasons.current_season_id) ?? null;
  // Found in review: this used `?? null` while the write path (coach-chat.ts's quest_event
  // handler) uses `?? ""` - ProgressRow.season_id is typed as a non-nullable string, so a row
  // written with no active season gets `season_id: ""` on disk, and `"" !== null` meant that row
  // could never match here - orphaned forever. Match the write side's sentinel instead of
  // widening the type.
  const currentSeasonId = seasons?.current_season_id ?? "";
  const weekBounds = isoWeekBounds(today);

  const seasonLines = [
    "## Current Season",
    currentSeason
      ? `- **${currentSeason.name}:** ${currentSeason.start_date} to ${currentSeason.end_date} (${currentSeason.status})`
      : "*(No active season)*",
  ];

  const mainQuest = quests?.main_quest;
  const mainQuestLines = ["## Main Quest"];
  if (mainQuest) {
    // Found in review: this always used `completed` even for a progress-type main quest, same
    // bug the side-quest branch below already avoids - a progress-type main quest (e.g. tracking
    // a cumulative count) would render its completed-row count instead of its actual latest
    // value. Match the side-quest branching exactly. Also now scoped to the current season and
    // week-aware for weekly_frequency, same fixes as the side-quest branch below.
    const { completed, latestValue, thisWeekCompleted } = questProgressCounts(progress, mainQuest.id, currentSeasonId, weekBounds);
    const progressText =
      mainQuest.type === "progress"
        ? `${latestValue ?? "0"}/${mainQuest.target}`
        : mainQuest.type === "weekly_frequency"
          ? `${thisWeekCompleted}/${mainQuest.target} this week`
          : `${completed}/${mainQuest.target}`;
    mainQuestLines.push(`- **${mainQuest.name}** (id: ${mainQuest.id}, type: ${mainQuest.type}): ${progressText}`);
  } else {
    mainQuestLines.push("*(None set)*");
  }

  const sideQuests = (quests?.quests ?? []).filter((q) => q.status === "active");
  const sideQuestLines = ["## Side Quests"];
  if (sideQuests.length > 0) {
    for (const q of sideQuests) {
      const { completed, excused, missed, latestValue, thisWeekCompleted } = questProgressCounts(progress, q.id, currentSeasonId, weekBounds);
      const progressText =
        q.type === "progress"
          ? `${latestValue ?? "0"}/${q.target ?? "?"} ${q.unit ?? ""}`.trim()
          : q.type === "weekly_frequency"
            ? `${thisWeekCompleted}/${q.target ?? "?"} this week`
            : `${completed} completed, ${excused} excused, ${missed} missed`;
      sideQuestLines.push(`- **${q.name}** (id: ${q.id}, type: ${q.type}): ${progressText}`);
    }
  } else {
    sideQuestLines.push("*(None active)*");
  }

  const weeklyTargets = quests?.weekly_targets ?? {};
  const weeklyLines = ["## Weekly Targets"];
  const targetEntries = Object.entries(weeklyTargets);
  if (targetEntries.length > 0) {
    for (const [key, wt] of targetEntries) {
      weeklyLines.push(`- **${key}:** target ${wt.target}`);
    }
  } else {
    weeklyLines.push("*(None set)*");
  }

  // ADR 0016: stored as "progressions", stays "Milestone" everywhere Coach and the athlete talk
  // about it - the section header uses the athlete-facing word, same convention as "Active
  // Injury Flags" above rather than the raw file/field name.
  //
  // Found in review: progressions.json was fetched into CoachContext every turn but never
  // rendered into the prompt at all - Coach had zero visibility into milestone progress despite
  // paying for the fetch. Fixed.
  const milestoneEntries = progressions?.progressions ?? [];
  const milestoneLines = ["## Milestones"];
  if (milestoneEntries.length > 0) {
    for (const m of milestoneEntries) {
      const unit = m.unit ? ` ${m.unit}` : "";
      milestoneLines.push(`- **${m.name}** (id: ${m.id}): ${m.current}${unit} → target ${m.target}${unit}`);
    }
  } else {
    milestoneLines.push("*(None set)*");
  }

  return [seasonLines.join("\n"), mainQuestLines.join("\n"), sideQuestLines.join("\n"), weeklyLines.join("\n"), milestoneLines.join("\n")].join(
    "\n\n",
  );
}

// Builds the athlete-context block that goes where state.md's raw prose used to go in
// buildDynamicText's <state> block - same section headers, sourced from the four new files.
export function renderCoachContext(storage: CoachContextStorage): string {
  return [
    profileSection(storage.profile, storage.memory),
    equipmentSection(storage.memory),
    recentSessionNotesSection(storage.coachLog),
    fitnessBaselineSection(storage.memory),
    activeInjuryFlagsSection(storage.injuries),
    coachingPrioritiesSection(storage.memory),
    learnedPatternsSection(storage.memory),
  ].join("\n\n");
}
