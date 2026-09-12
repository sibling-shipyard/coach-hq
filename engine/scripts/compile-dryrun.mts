/**
 * Read-only: strip timer physics from live templates, recompile, print a per-file diff summary.
 * Writes nothing. Skips `_manifest.json` (index, not a workout).
 *
 * Usage: npx tsx engine/scripts/compile-dryrun.mts <repo-path>
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { compileWorkout, type SpecExercise, type SpecPhase, type WorkoutSpec } from "../lib/compileWorkout.mts";

const SKIP = new Set(["_manifest.json"]);

const REST_FIELDS = new Set(["rest_between_sets_secs", "rest_after_exercise_secs", "default_rest_secs"]);
const PREP_FIELDS = new Set(["prep_secs"]);
const DURATION_FIELDS = new Set(["duration", "estimated_duration_mins"]);

type DiffClass =
  | "hand_tuned_rest"
  | "compiler_filled_rest"
  | "prep_secs_default"
  | "transition_rest_secs_absent"
  | "duration_rounding"
  | "original_meta"
  | "unexplained";

const ORIGINAL_ONLY_ROOT = new Set(["_meta", "session_date", "based_on_template", "shoulder_modification"]);

type LeafDiff = {
  path: string;
  original: unknown;
  compiled: unknown;
  cls: DiffClass;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classify(path: string, original: unknown, compiled: unknown): DiffClass {
  const root = path.split(".")[0]?.split("[")[0] ?? "";
  if (ORIGINAL_ONLY_ROOT.has(root) && compiled === undefined && original !== undefined) {
    return "original_meta";
  }
  const field = path.split(".").pop() ?? "";
  if (field === "transition_rest_secs" && compiled === undefined && original !== undefined) {
    return "transition_rest_secs_absent";
  }
  if (REST_FIELDS.has(field)) {
    if (original === undefined && compiled !== undefined) return "compiler_filled_rest";
    return "hand_tuned_rest";
  }
  if (PREP_FIELDS.has(field)) return "prep_secs_default";
  if (DURATION_FIELDS.has(field)) return "duration_rounding";
  return "unexplained";
}

function walk(original: unknown, compiled: unknown, path: string, out: LeafDiff[]): void {
  if (original === compiled) return;
  if (Array.isArray(original) || Array.isArray(compiled)) {
    const origArr = Array.isArray(original) ? original : [];
    const compArr = Array.isArray(compiled) ? compiled : [];
    const n = Math.max(origArr.length, compArr.length);
    if (origArr.length !== compArr.length && !isObject(origArr[0]) && !isObject(compArr[0])) {
      out.push({ path, original, compiled, cls: "unexplained" });
      return;
    }
    for (let i = 0; i < n; i += 1) {
      walk(origArr[i], compArr[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (isObject(original) || isObject(compiled)) {
    const origObj = isObject(original) ? original : {};
    const compObj = isObject(compiled) ? compiled : {};
    const keys = new Set([...Object.keys(origObj), ...Object.keys(compObj)]);
    for (const key of keys) {
      const child = path ? `${path}.${key}` : key;
      if (!path && ORIGINAL_ONLY_ROOT.has(key) && origObj[key] !== undefined && compObj[key] === undefined) {
        out.push({ path: child, original: origObj[key], compiled: undefined, cls: "original_meta" });
        continue;
      }
      walk(origObj[key], compObj[key], child, out);
    }
    return;
  }
  out.push({ path, original, compiled, cls: classify(path, original, compiled) });
}

function toSpec(workout: Record<string, unknown>): WorkoutSpec {
  const phases = Array.isArray(workout.phases) ? workout.phases : [];
  return {
    id: String(workout.id ?? ""),
    title: String(workout.title ?? ""),
    subtitle: String(workout.subtitle ?? ""),
    workout_type: workout.workout_type as WorkoutSpec["workout_type"],
    location: String(workout.location ?? ""),
    equipment: Array.isArray(workout.equipment) ? (workout.equipment as string[]) : [],
    coaching_note: String(workout.coaching_note ?? ""),
    ...(typeof workout.progression_notes === "string" ? { progression_notes: workout.progression_notes } : {}),
    phases: phases.map((phase) => {
      const p = isObject(phase) ? phase : {};
      const exercises = Array.isArray(p.exercises) ? p.exercises : [];
      const specPhase: SpecPhase = {
        name: String(p.name ?? ""),
        ...(typeof p.circuit === "boolean" ? { circuit: p.circuit } : {}),
        ...(typeof p.rounds === "number" ? { rounds: p.rounds } : {}),
        ...(typeof p.coaching_note === "string" ? { coaching_note: p.coaching_note } : {}),
        ...(typeof p.optional === "boolean" ? { optional: p.optional } : {}),
        exercises: exercises.map((exercise) => {
          const e = isObject(exercise) ? exercise : {};
          const specEx: SpecExercise = {
            name: String(e.name ?? ""),
            type: e.type === "timed" ? "timed" : "reps",
            sets: typeof e.sets === "number" ? e.sets : 1,
            form_cue: String(e.form_cue ?? ""),
            why: String(e.why ?? ""),
            ...(e.type === "timed" && typeof e.duration_secs === "number" ? { duration_secs: e.duration_secs } : {}),
            ...(e.type === "reps" && typeof e.reps === "number" ? { reps: e.reps } : {}),
            ...(typeof e.both_sides === "boolean" ? { both_sides: e.both_sides } : {}),
            ...(typeof e.optional === "boolean" ? { optional: e.optional } : {}),
          };
          return specEx;
        }),
      };
      return specPhase;
    }),
  };
}

function tally(diffs: LeafDiff[]): Record<DiffClass, number> {
  const counts: Record<DiffClass, number> = {
    hand_tuned_rest: 0,
    compiler_filled_rest: 0,
    prep_secs_default: 0,
    transition_rest_secs_absent: 0,
    duration_rounding: 0,
    original_meta: 0,
    unexplained: 0,
  };
  for (const d of diffs) counts[d.cls] += 1;
  return counts;
}

function fmtVal(value: unknown): string {
  if (value === undefined) return "∅";
  return JSON.stringify(value);
}

function printFile(name: string, diffs: LeafDiff[]): boolean {
  const counts = tally(diffs);
  const unexplained = diffs.filter((d) => d.cls === "unexplained");
  const ok = unexplained.length === 0;
  const tag = ok ? "EXPLAINABLE" : "UNEXPLAINED";
  console.log(`  ${tag}  ${name}`);
  if (diffs.length === 0) {
    console.log("    (byte-identical after recompile)");
    return true;
  }
  console.log(
    `    rest: ${counts.hand_tuned_rest} hand-tuned, ${counts.compiler_filled_rest} compiler-filled (original omitted)`,
  );
  console.log(`    prep_secs: ${counts.prep_secs_default} default-fill diffs`);
  console.log(`    transition_rest_secs absent: ${counts.transition_rest_secs_absent}`);
  console.log(`    duration / estimated_duration_mins: ${counts.duration_rounding}`);
  console.log(`    original _meta / session fields (not on spec): ${counts.original_meta}`);
  if (unexplained.length > 0) {
    console.log(`    unexplained: ${unexplained.length}`);
    for (const d of unexplained) {
      console.log(`      ${d.path}: ${fmtVal(d.original)} → ${fmtVal(d.compiled)}`);
    }
  }
  return ok;
}

async function runRepo(repoPath: string): Promise<{ files: number; unexplained: number }> {
  const templatesDir = join(repoPath, "user_data/activities/workout_plans/templates");
  let names: string[];
  try {
    names = (await readdir(templatesDir)).filter((n) => n.endsWith(".json")).sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${templatesDir}: ${message}`);
    process.exit(1);
  }

  console.log(`# ${basename(repoPath)}`);
  console.log(`  dir: ${templatesDir}`);

  let files = 0;
  let unexplained = 0;
  const repoCounts: Record<DiffClass, number> = {
    hand_tuned_rest: 0,
    compiler_filled_rest: 0,
    prep_secs_default: 0,
    transition_rest_secs_absent: 0,
    duration_rounding: 0,
    original_meta: 0,
    unexplained: 0,
  };

  for (const name of names) {
    if (SKIP.has(name)) {
      console.log(`  SKIP  ${name} (not a workout)`);
      continue;
    }
    const raw = JSON.parse(await readFile(join(templatesDir, name), "utf8")) as Record<string, unknown>;
    const compiled = compileWorkout(toSpec(raw));
    const diffs: LeafDiff[] = [];
    walk(raw, compiled, "", diffs);
    files += 1;
    const ok = printFile(name, diffs);
    if (!ok) unexplained += 1;
    const counts = tally(diffs);
    for (const k of Object.keys(counts) as DiffClass[]) repoCounts[k] += counts[k];
  }

  console.log("  -- repo totals --");
  console.log(
    `  files=${files}  hand-tuned rest=${repoCounts.hand_tuned_rest}  compiler-filled rest=${repoCounts.compiler_filled_rest}  prep=${repoCounts.prep_secs_default}  transition_rest absent=${repoCounts.transition_rest_secs_absent}  duration=${repoCounts.duration_rounding}  original_meta=${repoCounts.original_meta}  unexplained=${repoCounts.unexplained}`,
  );
  console.log("");
  return { files, unexplained };
}

const repoArg = process.argv[2];
if (!repoArg) {
  console.error("Usage: npx tsx engine/scripts/compile-dryrun.mts <repo-path>");
  process.exit(2);
}

const result = await runRepo(resolve(repoArg));
if (result.unexplained > 0) {
  console.error(`FAIL ${basename(resolve(repoArg))}: ${result.unexplained} file(s) have unexplained diffs`);
  process.exit(1);
}
console.log(`PASS ${basename(resolve(repoArg))}: ${result.files} workout(s), all diffs explainable`);
