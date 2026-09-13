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
import {
  exerciseDose,
  parseLeadingNumber,
  type WorkoutCreateSpec,
  type WorkoutCreateSpecExercise,
} from "./coachWorkoutFiles.js";

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

// Shared by buildBenchmarkSpec and buildFallbackBenchmarkSpec so both slugify to the exact same
// BENCHMARK_ROUTINE_ID above - the fallback is a stand-in for the same routine slot, not a
// different one, so coachTurn.ts's "has the benchmark already been written" check treats either
// origin as done.
const BENCHMARK_TITLE = "First session benchmark";

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

// Equipment *count* isn't the same as equipment *accessibility* - a one-item ["full_gym"] array
// and a one-item ["bodyweight"] array tied under the old "fewest items" sort, and full_gym could
// win the tie alphabetically (live-verified, #727 review: a fresh athlete who'd never confirmed
// owning any equipment got a cable-machine exercise in their benchmark). Ranked lowest-barrier
// first instead; an equipment array's cost is its most expensive item, so a mixed-equipment entry
// never looks cheaper than it really is.
const EQUIPMENT_COST: Record<string, number> = {
  bodyweight: 0,
  resistance_band: 1,
  dumbbells: 2,
  bench: 2,
  pull_up_bar: 2,
  full_gym: 3,
};

function equipmentCost(equipment: string[]): number {
  if (equipment.length === 0) return 0;
  return Math.max(...equipment.map((item) => EQUIPMENT_COST[item] ?? 3));
}

function byAccessibility(a: ExerciseCatalogEntry, b: ExerciseCatalogEntry): number {
  return equipmentCost(a.equipment) - equipmentCost(b.equipment) || a.id.localeCompare(b.id);
}

// Prefers the most accessible entry (bodyweight/no-equipment first) so a benchmark is always
// answerable by a brand-new athlete who hasn't reported what they own yet - intake's equipment
// question lands later in the conversation than the benchmark does. Ties break on id for
// determinism. Among equally-accessible candidates, one that doesn't textually conflict with an
// active injury flag is preferred; if every candidate for this pattern conflicts, falls back to
// the accessibility-only pick rather than dropping benchmark coverage for that pattern.
function pickPrimary(
  catalog: ExerciseCatalogEntry[],
  pattern: string,
  exclude: ReadonlySet<string>,
  activeInjuryTexts: string[],
): ExerciseCatalogEntry | null {
  const candidates = catalog
    .filter((e) => e.movement_pattern === pattern && !exclude.has(e.id))
    .sort(byAccessibility);
  const safe = candidates.filter((e) => !conflictsWithInjury(e, activeInjuryTexts));
  return safe[0] ?? candidates[0] ?? null;
}

// The easier/harder alternative folded into the exercise's own coaching cue (the LLD's explicit
// shape - "each exercise carrying an easier and a harder alternative in its coaching cue", not a
// separate schema field). Easier = the same pattern's most-accessible other entry; harder = the
// least-accessible. A pattern with only one catalog entry states there's no alternative on file
// rather than inventing one.
function alternativesFor(
  catalog: ExerciseCatalogEntry[],
  primary: ExerciseCatalogEntry,
): { easier: string; harder: string } {
  const siblings = catalog
    .filter((e) => e.movement_pattern === primary.movement_pattern && e.id !== primary.id)
    .sort(byAccessibility);
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
    title: BENCHMARK_TITLE,
    workout_type: "foundation",
    coaching_note:
      "A starting-point test, not a max effort - this sets the baseline everything else scales from.",
    phases: [{ name: "Benchmark", exercises }],
    injury_ack: injuryAck.length > 0 ? injuryAck : undefined,
  };
}

// #727 retry fix, fix 1: buildBenchmarkSpec is built entirely from data Coach already controls
// (the catalog plus this athlete's own progressions/injuries), so it should never actually trip
// applyWorkoutCreate's invariants - but "should never" isn't "structurally can't," and a thrown
// spec here used to mean the athlete got no benchmark and no first week, forever (the
// wasProfileComplete gate never retried). Repairs the spec in place against repo state
// buildBenchmarkSpec doesn't itself see fresh at call time:
//
// - Invariant 2 (dose cap): if this benchmark's progression_id already resolves to a real,
//   parseable numeric current (a retry after the athlete has since done other real workout_create
//   turns using the same catalog progression ids), clamp the exercise down to one set at that
//   capped value rather than throwing - collapsing to one set (instead of spreading the cap
//   across the original set count) is what guarantees the clamped dose can never overshoot once
//   the original set count is itself above the cap.
// - Invariant 1/8 (progression id): toSpecExercise always sets scaled_from today, but this is
//   defense in depth against that ever regressing - a progression_id with no matching entry and no
//   scaled_from gets one synthesized rather than throwing.
// - Invariant 7 (injury ack): buildBenchmarkSpec acks every flag in the same `injuries` object it
//   was given, so this should already be complete - but activeInjuryFlagIds here can in principle
//   come from a different snapshot (turn.context.injuries) than what built the spec, so any flag
//   still missing an ack gets a generic one added rather than the whole spec throwing.
export function repairBenchmarkSpecForInvariants(
  spec: WorkoutCreateSpec,
  progressions: ProgressionsJson | null,
  activeInjuryFlagIds: ReadonlySet<string>,
): WorkoutCreateSpec {
  const progressionsById = new Map((progressions?.progressions ?? []).map((p) => [p.id, p]));

  const phases = spec.phases.map((phase) => ({
    ...phase,
    exercises: phase.exercises.map((ex) => {
      if (!ex.progression_id) return ex;
      const existing = progressionsById.get(ex.progression_id);
      if (!existing) {
        return ex.scaled_from?.trim() ? ex : { ...ex, scaled_from: "first session benchmark" };
      }
      const currentDose = parseLeadingNumber(existing.current);
      // currentDose < 1 has no positive-integer dose that can satisfy invariant 2 at all (a
      // malformed "0" or fractional current) - leave the exercise alone and let the invariant
      // trip normally, cascading to the fixed fallback below rather than writing a 0-rep set.
      if (currentDose == null || currentDose < 1) return ex;
      // Collapses to a single set at the capped value rather than spreading the cap across the
      // spec's original set count - simplest way to guarantee exerciseDose() never exceeds
      // currentDose regardless of how many sets the generated spec asked for (dividing the cap
      // across multiple sets and flooring can still overshoot once sets > cap, e.g. sets: 3
      // against a cap of 1).
      const cappedValue = Math.floor(currentDose);
      const dose = exerciseDose(ex);
      if (dose <= currentDose) return ex;
      return ex.type === "timed"
        ? { ...ex, duration_secs: cappedValue, sets: 1 }
        : { ...ex, reps: cappedValue, sets: 1 };
    }),
  }));

  const acked = new Set((spec.injury_ack ?? []).map((ack) => ack.flag));
  const unacked = [...activeInjuryFlagIds].filter((flagId) => !acked.has(flagId));
  const injuryAck =
    unacked.length > 0
      ? [
          ...(spec.injury_ack ?? []),
          ...unacked.map((flag) => ({
            flag,
            accommodation:
              "Benchmark generation didn't have this flag's detail on hand when it acked the others - scale down or skip anything that flares it up.",
          })),
        ]
      : spec.injury_ack;

  return { ...spec, phases, injury_ack: injuryAck };
}

// #727 retry fix, fix 2: the guaranteed-safe fallback when spec repair still somehow leaves
// something that trips an invariant. One fixed bodyweight movement with no progression_id (so
// invariants 1/2/8 never apply) and an ack synthesized for every currently-active injury flag (so
// invariant 7 can't fail either, regardless of what the athlete's real flags say) - nothing here
// depends on catalog data, progressions, or injury text matching, so this cannot fail the same way
// a generated spec theoretically could. Same BENCHMARK_TITLE as buildBenchmarkSpec, so it slugifies
// to the same BENCHMARK_ROUTINE_ID and satisfies the same "benchmark exists" manifest check.
export function buildFallbackBenchmarkSpec(
  activeInjuryFlagIds: ReadonlySet<string>,
): WorkoutCreateSpec {
  return {
    title: BENCHMARK_TITLE,
    workout_type: "foundation",
    coaching_note:
      "A safe starting point while your full benchmark gets sorted out - no fixed dose to scale from yet, just a first move to test against.",
    phases: [
      {
        name: "Benchmark",
        exercises: [
          {
            name: "Bodyweight squat",
            type: "reps",
            form_cue:
              "Feet shoulder-width, sit back and down keeping your chest up, stop wherever feels controlled.",
            why: "A simple baseline movement to see where you're starting from.",
            reps: 8,
            sets: 3,
          },
        ],
      },
    ],
    injury_ack:
      activeInjuryFlagIds.size > 0
        ? [...activeInjuryFlagIds].map((flag) => ({
            flag,
            accommodation:
              "Fallback benchmark is bodyweight-only with no fixed dose - stop or scale back anything that aggravates this.",
          }))
        : undefined,
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
