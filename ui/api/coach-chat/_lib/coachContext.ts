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

export interface CoachContextStorage {
  profile: ProfileJson | null;
  memory: MemoryJson | null;
  injuries: InjuriesJson | null;
  coachLog: CoachLogJson | null;
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
    `- **Goal:** ${memory?.goal ?? ""}`,
    `- **Timeline / Upcoming events:** ${memory?.timeline ?? ""}`,
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
