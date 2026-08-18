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
}

const RECENT_SESSION_WINDOW = 3;

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
  return ["## Recent Session Notes *(rolling — last 3 sessions)*", body].join("\n");
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

// Part 2 ledger split: replaces gen/quest_log.md as the quest-context source. Reproduces the
// same rough shape (Current Season, Main Quest, Side Quests) generate_quest_log.py's markdown
// carries, built directly from seasons.json/quests.json/progress.json instead of a pre-computed
// file - this doesn't touch generate_quest_log.py itself, and doesn't try to match it byte for
// byte (pace/rate math is real work that script already does well; this just gives Gemini the
// raw facts and real ids it needs).
function questProgressCounts(progress: ProgressJson | null, questId: string): { completed: number; excused: number; missed: number; latestValue: string | null } {
  const rows = (progress?.rows ?? []).filter((r) => r.quest_id === questId);
  let completed = 0;
  let excused = 0;
  let missed = 0;
  let latestValue: string | null = null;
  let latestDate = "";
  for (const row of rows) {
    if (row.status === "completed") completed += 1;
    else if (row.status === "excused") excused += 1;
    else if (row.status === "missed") missed += 1;
    if (row.value != null && row.date >= latestDate) {
      latestDate = row.date;
      latestValue = String(row.value);
    }
  }
  return { completed, excused, missed, latestValue };
}

export function renderQuestContext(storage: QuestContextStorage): string {
  const { seasons, quests, progress, progressions } = storage;
  const currentSeason = seasons?.seasons.find((s) => s.id === seasons.current_season_id) ?? null;

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
    // value. Match the side-quest branching exactly.
    const { completed, latestValue } = questProgressCounts(progress, mainQuest.id);
    const progressText = mainQuest.type === "progress" ? `${latestValue ?? "0"}/${mainQuest.target}` : `${completed}/${mainQuest.target}`;
    mainQuestLines.push(`- **${mainQuest.name}** (id: ${mainQuest.id}, type: ${mainQuest.type}): ${progressText}`);
  } else {
    mainQuestLines.push("*(None set)*");
  }

  const sideQuests = (quests?.quests ?? []).filter((q) => q.status === "active");
  const sideQuestLines = ["## Side Quests"];
  if (sideQuests.length > 0) {
    for (const q of sideQuests) {
      const { completed, excused, missed, latestValue } = questProgressCounts(progress, q.id);
      const progressText =
        q.type === "progress" ? `${latestValue ?? "0"}/${q.target ?? "?"} ${q.unit ?? ""}`.trim() : `${completed} completed, ${excused} excused, ${missed} missed`;
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
