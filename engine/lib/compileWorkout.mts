/**
 * Pure compiler: a minimal exercise list → timer-ready Workout JSON.
 * Defaults are overridable: a value already on the spec is never recomputed.
 * `progression_id` is spec-only and is dropped on emit (not a Workout field).
 */

export type ExerciseType = "reps" | "timed";
export type WorkoutType = "foundation" | "strength" | "recovery" | "realign" | "calisthenics";

export interface SpecExercise {
  name: string;
  type: ExerciseType;
  reps?: number;
  duration_secs?: number;
  sets: number;
  form_cue: string;
  why: string;
  both_sides?: boolean;
  optional?: boolean;
  progression_id?: string;
  prep_secs?: number;
  rest_between_sets_secs?: number;
  rest_after_exercise_secs?: number;
  num?: number;
}

export interface SpecPhase {
  name: string;
  exercises: SpecExercise[];
  circuit?: boolean;
  rounds?: number;
  coaching_note?: string;
  optional?: boolean;
  duration?: string;
  default_rest_secs?: number;
  transition_rest_secs?: number;
}

export interface WorkoutSpec {
  id: string;
  title: string;
  subtitle: string;
  workout_type: WorkoutType;
  location: string;
  equipment: string[];
  coaching_note: string;
  phases: SpecPhase[];
  progression_notes?: string;
  estimated_duration_mins?: number;
}

export interface CompileDefaults {
  prep_secs_timed?: number;
  rest_between_sets_reps?: number;
  rest_between_sets_timed?: number;
  rest_after_exercise_secs?: number;
  rest_after_last_secs?: number;
  default_rest_secs?: number;
  secs_per_rep?: number;
}

export interface CompileOpts {
  defaults?: CompileDefaults;
}

export interface CompiledExercise {
  num: number;
  name: string;
  type: ExerciseType;
  duration_secs?: number;
  reps?: number;
  sets: number;
  rest_between_sets_secs?: number;
  rest_after_exercise_secs?: number;
  prep_secs?: number;
  optional?: boolean;
  both_sides?: boolean;
  form_cue: string;
  why: string;
}

export interface CompiledPhase {
  name: string;
  duration: string;
  default_rest_secs: number;
  transition_rest_secs?: number;
  optional?: boolean;
  coaching_note?: string;
  circuit?: boolean;
  rounds?: number;
  exercises: CompiledExercise[];
}

export interface Workout {
  id: string;
  title: string;
  subtitle: string;
  workout_type: WorkoutType;
  estimated_duration_mins: number;
  location: string;
  equipment: string[];
  coaching_note: string;
  phases: CompiledPhase[];
  progression_notes?: string;
}

const TABLE = {
  prepSecsTimed: 5,
  restBetweenReps: 60,
  restBetweenTimed: 45,
  restAfter: 30,
  restAfterLast: 0,
  defaultRest: 30,
  secsPerRep: 3,
} as const;

type ResolvedDefaults = {
  prepSecsTimed: number;
  restBetweenReps: number;
  restBetweenTimed: number;
  restAfter: number;
  restAfterLast: number;
  defaultRest: number;
  secsPerRep: number;
};

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key) && (obj as Record<string, unknown>)[key] !== undefined;
}

function pick<T>(override: T | undefined, fallback: T): T {
  return override !== undefined ? override : fallback;
}

function resolveDefaults(opts: CompileOpts): ResolvedDefaults {
  const d = opts.defaults ?? {};
  return {
    prepSecsTimed: pick(d.prep_secs_timed, TABLE.prepSecsTimed),
    restBetweenReps: pick(d.rest_between_sets_reps, TABLE.restBetweenReps),
    restBetweenTimed: pick(d.rest_between_sets_timed, TABLE.restBetweenTimed),
    restAfter: pick(d.rest_after_exercise_secs, TABLE.restAfter),
    restAfterLast: pick(d.rest_after_last_secs, TABLE.restAfterLast),
    defaultRest: pick(d.default_rest_secs, TABLE.defaultRest),
    secsPerRep: pick(d.secs_per_rep, TABLE.secsPerRep),
  };
}

function workSecs(ex: SpecExercise, defaults: ResolvedDefaults): number {
  const sides = ex.type === "timed" && ex.both_sides ? 2 : 1;
  if (ex.type === "timed") {
    return (ex.duration_secs ?? 0) * ex.sets * sides;
  }
  return (ex.reps ?? 0) * defaults.secsPerRep * ex.sets;
}

function filledPrep(ex: SpecExercise, defaults: ResolvedDefaults): number | undefined {
  if (hasOwn(ex, "prep_secs")) return ex.prep_secs;
  if (ex.type === "timed") return defaults.prepSecsTimed;
  return undefined;
}

function filledRestBetween(ex: SpecExercise, defaults: ResolvedDefaults): number | undefined {
  if (hasOwn(ex, "rest_between_sets_secs")) return ex.rest_between_sets_secs;
  if (ex.sets === 1) return undefined;
  return ex.type === "reps" ? defaults.restBetweenReps : defaults.restBetweenTimed;
}

function filledRestAfter(
  ex: SpecExercise,
  isLastOfLastPhase: boolean,
  defaults: ResolvedDefaults,
): number {
  if (hasOwn(ex, "rest_after_exercise_secs")) return ex.rest_after_exercise_secs as number;
  return isLastOfLastPhase ? defaults.restAfterLast : defaults.restAfter;
}

function minsRoundedUp(secs: number): number {
  return Math.ceil(secs / 60);
}

function durationLabel(secs: number): string {
  return `${minsRoundedUp(secs)} min`;
}

function compileExercise(
  ex: SpecExercise,
  num: number,
  isLastOfLastPhase: boolean,
  defaults: ResolvedDefaults,
): { exercise: CompiledExercise; secs: number; restBetween: number | undefined } {
  const restBetween = filledRestBetween(ex, defaults);
  const restAfter = filledRestAfter(ex, isLastOfLastPhase, defaults);
  const prep = filledPrep(ex, defaults);
  const work = workSecs(ex, defaults);
  const restBetweenTotal = ex.sets > 1 ? (restBetween ?? 0) * (ex.sets - 1) : 0;
  const secs = work + restBetweenTotal + restAfter;

  const exercise: CompiledExercise = {
    num,
    name: ex.name,
    type: ex.type,
    ...(ex.type === "timed" ? { duration_secs: ex.duration_secs } : { reps: ex.reps }),
    sets: ex.sets,
    ...(restBetween !== undefined ? { rest_between_sets_secs: restBetween } : {}),
    rest_after_exercise_secs: restAfter,
    ...(prep !== undefined ? { prep_secs: prep } : {}),
    ...(hasOwn(ex, "optional") ? { optional: ex.optional } : {}),
    ...(hasOwn(ex, "both_sides") ? { both_sides: ex.both_sides } : {}),
    form_cue: ex.form_cue,
    why: ex.why,
  };

  return { exercise, secs, restBetween };
}

export function compileWorkout(spec: WorkoutSpec, opts: CompileOpts = {}): Workout {
  const defaults = resolveDefaults(opts);
  const lastPhaseIdx = spec.phases.length - 1;
  let nextNum = 1;
  let totalSecs = 0;

  const phases: CompiledPhase[] = spec.phases.map((phase, phaseIdx) => {
    const lastExIdx = phase.exercises.length - 1;
    const restBetweens: number[] = [];
    let roundSecs = 0;

    const exercises: CompiledExercise[] = phase.exercises.map((ex, exIdx) => {
      const isLastOfLastPhase = phaseIdx === lastPhaseIdx && exIdx === lastExIdx;
      const compiled = compileExercise(ex, nextNum, isLastOfLastPhase, defaults);
      nextNum += 1;
      roundSecs += compiled.secs;
      if (compiled.restBetween !== undefined) restBetweens.push(compiled.restBetween);
      return compiled.exercise;
    });

    const multiplier = phase.circuit ? (phase.rounds ?? 1) : 1;
    const phaseSecs = roundSecs * multiplier;
    totalSecs += phaseSecs;

    const defaultRest = hasOwn(phase, "default_rest_secs")
      ? (phase.default_rest_secs as number)
      : restBetweens.length > 0
        ? Math.max(...restBetweens)
        : defaults.defaultRest;

    const compiledPhase: CompiledPhase = {
      name: phase.name,
      duration: hasOwn(phase, "duration") ? (phase.duration as string) : durationLabel(phaseSecs),
      default_rest_secs: defaultRest,
      ...(hasOwn(phase, "transition_rest_secs") ? { transition_rest_secs: phase.transition_rest_secs } : {}),
      ...(hasOwn(phase, "optional") ? { optional: phase.optional } : {}),
      ...(hasOwn(phase, "coaching_note") ? { coaching_note: phase.coaching_note } : {}),
      ...(hasOwn(phase, "circuit") ? { circuit: phase.circuit } : {}),
      ...(hasOwn(phase, "rounds") ? { rounds: phase.rounds } : {}),
      exercises,
    };

    return compiledPhase;
  });

  const workout: Workout = {
    id: spec.id,
    title: spec.title,
    subtitle: spec.subtitle,
    workout_type: spec.workout_type,
    estimated_duration_mins: hasOwn(spec, "estimated_duration_mins")
      ? (spec.estimated_duration_mins as number)
      : minsRoundedUp(totalSecs),
    location: spec.location,
    equipment: spec.equipment,
    coaching_note: spec.coaching_note,
    phases,
    ...(hasOwn(spec, "progression_notes") ? { progression_notes: spec.progression_notes } : {}),
  };

  return workout;
}
