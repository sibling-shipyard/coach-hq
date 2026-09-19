/**
 * repoDataProfile.ts - a cheap, pure-read snapshot of what an athlete repo's coach-owned data
 * actually looks like right now: does the current week have real sessions, are there open
 * injury flags, is there a habit quest, what's the coaching style, how many workout templates
 * exist. A2 (#1105) uses this to check a scenario's `preconditions` before spending a real model
 * call on a repo that can't produce the behavior it's testing - see
 * docs/eng-docs/coach-chat-testing.md.
 *
 * This only reads files off disk (fs.readFileSync/readdirSync) against a local clone's path -
 * no network calls, no git operations, no GitHub API. Every field name and path here is taken
 * from docs/eng-docs/coach-data-schema.md and the real appliers it's sourced from
 * (coachWeekFiles.ts, coachQuestFiles.ts, coachWorkoutFiles.ts), not guessed.
 */
import fs from "node:fs";
import path from "node:path";

// Same prefix coachWorkoutFiles.ts's TEMPLATES_PATH_PREFIX defines - not re-imported directly
// since that file pulls in the whole compile-workout bundle transitively, which this script has
// no business loading just to count files in a directory.
const TEMPLATES_DIR = "user_data/activities/workout_plans/templates";

interface CurrentWeekProfile {
  dataStatus: "placeholder" | "live";
  sessionCount: number;
}

interface InjuriesProfile {
  activeCount: number;
  resolvedCount: number;
}

interface QuestsProfile {
  count: number;
  hasHabitQuest: boolean;
}

export interface RepoDataProfile {
  currentWeek: CurrentWeekProfile;
  injuries: InjuriesProfile;
  quests: QuestsProfile;
  coachingStyle: string | null;
  templateCount: number;
}

// Every read here goes through this - a missing file (a repo can genuinely lack any one of
// these, e.g. pre-First-Session or pre-migration) or unparseable JSON both return null rather
// than throwing, so one bad/missing file never takes down the whole profile.
function readJson<T>(repoPath: string, relativePath: string): T | null {
  const fullPath = path.join(repoPath, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8")) as T;
  } catch {
    return null;
  }
}

function profileCurrentWeek(repoPath: string): CurrentWeekProfile {
  const content = readJson<{
    data_status?: "placeholder" | "live";
    days?: { sessions?: unknown[] }[];
  }>(repoPath, "user_data/ledger/current_week.json");
  if (!content) return { dataStatus: "placeholder", sessionCount: 0 };

  const sessionCount = (content.days ?? []).reduce(
    (total, day) => total + (day.sessions?.length ?? 0),
    0,
  );
  return {
    dataStatus: content.data_status === "live" ? "live" : "placeholder",
    sessionCount,
  };
}

function profileInjuries(repoPath: string): InjuriesProfile {
  const content = readJson<{ flags?: { status?: "active" | "resolved" }[] }>(
    repoPath,
    "user_data/coach/injuries.json",
  );
  const flags = content?.flags ?? [];
  return {
    activeCount: flags.filter((f) => f.status === "active").length,
    resolvedCount: flags.filter((f) => f.status === "resolved").length,
  };
}

// A "habit quest" is anything quest_create or season_start's new_habits appended to quests[] -
// there's no explicit habit tag on the Quest shape (coachQuestFiles.ts's QuestType is
// daily_streak/progress/count_target/weekly_frequency, none of which say "habit"). The only
// entries in quests[] that AREN'T a real habit quest are former main_quest goals retired in by
// applySeasonStart, and those always land with status "retired" - so "active" is what actually
// distinguishes a live habit quest from a retired former goal here.
function profileQuests(repoPath: string): QuestsProfile {
  const content = readJson<{ quests?: { status?: "active" | "graduated" | "retired" }[] }>(
    repoPath,
    "user_data/ledger/quests.json",
  );
  const quests = content?.quests ?? [];
  return {
    count: quests.length,
    hasHabitQuest: quests.some((q) => q.status === "active"),
  };
}

function profileCoachingStyle(repoPath: string): string | null {
  const content = readJson<{
    coaching_style?: "accountability" | "encouragement" | "analysis" | null;
  }>(repoPath, "user_data/coach/memory.json");
  return content?.coaching_style ?? null;
}

// No manifest read here on purpose - _manifest.json is the source of truth for the hosted
// GitHub-API path only (coachWorkoutFiles.ts's own comment: no directory-listing API exists
// there), but this script has a real local clone and a real filesystem, so it just lists the
// directory directly and skips the manifest file itself.
function countTemplates(repoPath: string): number {
  const dir = path.join(repoPath, TEMPLATES_DIR);
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).length;
  } catch {
    return 0;
  }
}

/** Given a local athlete repo path, reads its coach data files and returns a profile snapshot. */
export function buildRepoDataProfile(repoPath: string): RepoDataProfile {
  return {
    currentWeek: profileCurrentWeek(repoPath),
    injuries: profileInjuries(repoPath),
    quests: profileQuests(repoPath),
    coachingStyle: profileCoachingStyle(repoPath),
    templateCount: countTemplates(repoPath),
  };
}
