/**
 * A3 (#727): First Session's benchmark. On the profile-complete transition, code (not Gemini)
 * builds one workout_create spec tagged as the benchmark - 4-6 movement patterns pulled from the
 * A1b catalog (shared/workout-library/exercises.json), each carrying an easier and a harder
 * alternative in its own coaching cue. The athlete picks their real entry level for each exercise
 * inside the app; nothing branches here based on a guessed level, unlike the old template-dump
 * selector this replaces (bug 1).
 *
 * Also owns progression seeding: one progression record per benchmarked movement pattern, id/
 * name/current/target/unit/empty-history, current always null at this point ("not yet
 * benchmarked" - the athlete hasn't done the movement in the app yet). Invariant 2 (a starting
 * dose may not exceed the benchmarked value) is enforced by applyWorkoutCreate
 * (coachWorkoutFiles.ts) itself, unchanged from A2 - current: null is a no-op there by design.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InjuriesJson, MemoryJson, TrainingAvailability } from "./coachMemoryFiles.js";
import type { Progression, ProgressionsJson } from "./coachQuestFiles.js";
import type { WorkoutCreateSpec, WorkoutCreateSpecExercise } from "./coachWorkoutFiles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// ui/api/coach-chat/_lib/decide -> repo root is five levels up. Same convention
// coachWorkoutFiles.ts's now-deleted LIBRARY_DIR used for the old template shape.
const EXERCISES_PATH = path.resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "..",
  "shared",
  "workout-library",
  "exercises.json",
);

export interface ExerciseCatalogEntry {
  id: string;
  name: string;
  muscle_group: string;
  movement_pattern: string;
  type: "reps" | "timed";
  equipment: string[];
  sport_tags: string[];
  form_cue: string;
  why: string;
  progression_id?: string;
}

export function loadExerciseCatalog(): ExerciseCatalogEntry[] {
  const raw = fs.readFileSync(EXERCISES_PATH, "utf-8");
  return JSON.parse(raw) as ExerciseCatalogEntry[];
}

// The five patterns a benchmark needs to cover - push/pull/squat/hinge/core span the movements
// the first-week compiler (firstWeekCompile.ts) draws anchor sessions from, and every one of them
// has at least one catalog entry per A1b's coverage table.
export const BENCHMARK_MOVEMENT_PATTERNS = ["push", "pull", "squat", "hinge", "core"] as const;

// The benchmark's spec.title is always this exact string, so its slugified routine id is always
// this exact id (slugifyRoutineId has nothing to collide with on a repo's first-ever benchmark) -
// used by coachTurn.ts to check "has the benchmark already been written" directly, instead of
// "does any manifest exist at all" (P0, #727 review: carve-skeleton now seeds a manifest with the
// two starter templates at carve time, so that check was always true for a freshly carved repo).
export const BENCHMARK_ROUTINE_ID = "first_session_benchmark";

// The catalog has no explicit injury/contraindication tag, but muscle_group and an injury flag's
// own text are both plain English - a flag whose text names the same muscle group as a candidate
// (P1, #727 review: e.g. an active shoulder flag and a push-pattern candidate with
// muscle_group "shoulders") steers selection to a different candidate in the same movement
// pattern when one exists, without needing a new catalog field. Code still can't judge whether the
// alternative is actually safe - the spec's injury_ack still carries the real acknowledgment - this
// only avoids the plainly mismatched pick when a same-pattern alternative is on file.
function conflictsWithInjury(entry: ExerciseCatalogEntry, activeInjuryTexts: string[]): boolean {
  const muscleGroup = entry.muscle_group.toLowerCase();
  // Injury text is written in ordinary prose ("sore shoulder"), catalog muscle_group values are
  // plural ("shoulders") - check both forms so a real flag's wording still matches.
  const singular = muscleGroup.endsWith("s") ? muscleGroup.slice(0, -1) : muscleGroup;
  return activeInjuryTexts.some((text) => {
    const lower = text.toLowerCase();
    return lower.includes(muscleGroup) || lower.includes(singular);
  });
}

// Prefers the entry with the fewest equipment requirements (bodyweight/no-equipment first) so a
// benchmark is always answerable by a brand-new athlete who hasn't reported what they own yet -
// intake's equipment question lands later in the conversation than the benchmark does. Ties break
// on id for determinism. Among equally-cheap candidates, one that doesn't textually conflict with
// an active injury flag is preferred; if every candidate for this pattern conflicts, falls back to
// the equipment-only pick rather than dropping benchmark coverage for that pattern.
function pickPrimary(
  catalog: ExerciseCatalogEntry[],
  pattern: string,
  exclude: ReadonlySet<string>,
  activeInjuryTexts: string[],
): ExerciseCatalogEntry | null {
  const candidates = catalog
    .filter((e) => e.movement_pattern === pattern && !exclude.has(e.id))
    .sort((a, b) => a.equipment.length - b.equipment.length || a.id.localeCompare(b.id));
  const safe = candidates.filter((e) => !conflictsWithInjury(e, activeInjuryTexts));
  return safe[0] ?? candidates[0] ?? null;
}

// The easier/harder alternative folded into the exercise's own coaching cue (the LLD's explicit
// shape - "each exercise carrying an easier and a harder alternative in its coaching cue", not a
// separate schema field). Easier = the same pattern's lowest-equipment other entry; harder = the
// highest-equipment other entry. A pattern with only one catalog entry states there's no
// alternative on file rather than inventing one.
function alternativesFor(
  catalog: ExerciseCatalogEntry[],
  primary: ExerciseCatalogEntry,
): { easier: string; harder: string } {
  const siblings = catalog
    .filter((e) => e.movement_pattern === primary.movement_pattern && e.id !== primary.id)
    .sort((a, b) => a.equipment.length - b.equipment.length || a.id.localeCompare(b.id));
  if (siblings.length === 0) {
    return { easier: "no easier variant on file", harder: "no harder variant on file" };
  }
  const easier = siblings[0];
  const harder = siblings[siblings.length - 1];
  return { easier: easier.name, harder: harder.name };
}

function toSpecExercise(
  entry: ExerciseCatalogEntry,
  catalog: ExerciseCatalogEntry[],
): WorkoutCreateSpecExercise {
  const { easier, harder } = alternativesFor(catalog, entry);
  const formCue = `${entry.form_cue} Easier: ${easier}. Harder: ${harder}.`;
  const base = {
    name: entry.name,
    type: entry.type,
    form_cue: formCue,
    why: entry.why,
    sets: 3,
    progression_id: entry.progression_id,
    // Every benchmark movement is, by definition, a fresh progression the first time an athlete
    // is seen - applyWorkoutCreate (invariant 8) requires scaled_from whenever progression_id has
    // no existing entry yet, which is always true here.
    scaled_from: "first session benchmark",
  };
  // A benchmark exercise is a real, moderate starting dose to test against, not a maximal
  // effort - 8 reps / 20s is the same conservative default the old library's beginner templates
  // used, chosen so invariant 2 has real headroom once the athlete's actual current gets logged.
  return entry.type === "timed" ? { ...base, duration_secs: 20 } : { ...base, reps: 8 };
}

export function buildBenchmarkSpec(
  memory: MemoryJson,
  injuries: InjuriesJson,
  catalog: ExerciseCatalogEntry[] = loadExerciseCatalog(),
): WorkoutCreateSpec {
  const activeInjuryTexts = (injuries.flags ?? [])
    .filter((f) => f.status === "active")
    .map((f) => f.text);
  const used = new Set<string>();
  const exercises: WorkoutCreateSpecExercise[] = [];
  for (const pattern of BENCHMARK_MOVEMENT_PATTERNS) {
    const entry = pickPrimary(catalog, pattern, used, activeInjuryTexts);
    if (!entry) continue;
    used.add(entry.id);
    exercises.push(toSpecExercise(entry, catalog));
  }

  // Every active injury flag needs an ack (invariant 7) - this is a system-authored spec, not
  // Gemini's, so there's no real per-flag accommodation text to relay. Stating the mechanical
  // fact (this benchmark steered away from any movement naming the same muscle group, and used
  // the lowest-equipment variant otherwise) is honest about what actually happened, not a
  // fabricated coaching judgment.
  const injuryAck = (injuries.flags ?? [])
    .filter((f) => f.status === "active")
    .map((f) => ({
      flag: f.id,
      accommodation:
        "Benchmark avoids movements naming this flag's body part where an alternative was on file, and uses the lowest-impact variant otherwise; scale further in-app if this flares it up.",
    }));

  return {
    title: "First session benchmark",
    workout_type: "foundation",
    coaching_note:
      "A starting-point test, not a max effort - this sets the baseline everything else scales from.",
    phases: [{ name: "Benchmark", exercises }],
    injury_ack: injuryAck.length > 0 ? injuryAck : undefined,
  };
}

// Progression seeding: one record per benchmarked pattern, current always null ("not yet") since
// the athlete hasn't actually performed the movement in the app yet - the benchmark file is what
// they'll do that against. target/unit are left for the athlete's own real numbers to fill in
// over time (applyQuestEvent-adjacent appliers aren't part of this PR's file column); an empty
// string target and null unit are the same "nothing claimed yet" default profile.json/memory.json
// appliers elsewhere in this pipeline use for an unset field.
export function seedBenchmarkProgressions(
  existing: ProgressionsJson | null,
  spec: WorkoutCreateSpec,
  updatedAt: string,
  traceId: string,
): { content: string; seededIds: string[] } {
  const existingById = new Map((existing?.progressions ?? []).map((p) => [p.id, p]));
  const seededIds: string[] = [];

  for (const phase of spec.phases) {
    for (const ex of phase.exercises) {
      if (!ex.progression_id || existingById.has(ex.progression_id)) continue;
      const seeded: Progression = {
        id: ex.progression_id,
        name: ex.name,
        current: null,
        target: "",
        unit: null,
        history: [],
      };
      existingById.set(ex.progression_id, seeded);
      seededIds.push(ex.progression_id);
    }
  }

  const result: ProgressionsJson = {
    version: 1,
    _meta: { updated_at: updatedAt, updated_by: "model", trace_id: traceId },
    progressions: [...existingById.values()],
  };
  return { content: JSON.stringify(result, null, 2), seededIds };
}

// Deterministic parse of the days-per-week/which-days answer out of memory's existing free-text
// notes (fitness_baseline, coaching_priorities) - same keyword-matching spirit the old
// deleted template-selection helpers used before this PR removed them, applied to a new
// question. Intake already asks "how many days a week and which days do
// you train" as a natural question (both already-existing questions per the LLD); this just gives
// the answer a structured home instead of only prose. `null` when nothing parseable was ever
// said - a true "we don't know yet" state, distinct from a stated 0.
const DAYS_PATTERN = /(\d+)\s*(?:days?|x|times?)\s*(?:a|\/|per)?\s*week/i;

function parseDaysPerWeek(text: string): number | null {
  const match = text.match(DAYS_PATTERN);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 7) : null;
}

const WEEKDAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

function parsePreferredDays(text: string): TrainingAvailability["preferred_days"] {
  const found = new Set<string>();
  for (const match of text.matchAll(WEEKDAY_PATTERN)) {
    found.add(match[1].toLowerCase());
  }
  return [...found] as TrainingAvailability["preferred_days"];
}

export function inferTrainingAvailability(memory: MemoryJson): TrainingAvailability | null {
  const text = [
    memory.notes?.fitness_baseline?.text ?? "",
    memory.notes?.coaching_priorities?.text ?? "",
  ].join(" ");

  const daysPerWeek = parseDaysPerWeek(text);
  if (daysPerWeek == null) return null;

  return { days_per_week: daysPerWeek, preferred_days: parsePreferredDays(text) };
}
