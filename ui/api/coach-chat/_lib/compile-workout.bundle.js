// ../engine/lib/compileWorkout.mts
var TABLE = {
  prepSecsTimed: 5,
  restBetweenReps: 60,
  restBetweenTimed: 45,
  restAfter: 30,
  restAfterLast: 0,
  defaultRest: 30,
  secsPerRep: 3
};
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== void 0;
}
function pick(override, fallback) {
  return override !== void 0 ? override : fallback;
}
function resolveDefaults(opts) {
  const d = opts.defaults ?? {};
  return {
    prepSecsTimed: pick(d.prep_secs_timed, TABLE.prepSecsTimed),
    restBetweenReps: pick(d.rest_between_sets_reps, TABLE.restBetweenReps),
    restBetweenTimed: pick(d.rest_between_sets_timed, TABLE.restBetweenTimed),
    restAfter: pick(d.rest_after_exercise_secs, TABLE.restAfter),
    restAfterLast: pick(d.rest_after_last_secs, TABLE.restAfterLast),
    defaultRest: pick(d.default_rest_secs, TABLE.defaultRest),
    secsPerRep: pick(d.secs_per_rep, TABLE.secsPerRep)
  };
}
function workSecs(ex, defaults) {
  const sides = ex.type === "timed" && ex.both_sides ? 2 : 1;
  if (ex.type === "timed") {
    return (ex.duration_secs ?? 0) * ex.sets * sides;
  }
  return (ex.reps ?? 0) * defaults.secsPerRep * ex.sets;
}
function filledPrep(ex, defaults) {
  if (hasOwn(ex, "prep_secs")) return ex.prep_secs;
  if (ex.type === "timed") return defaults.prepSecsTimed;
  return void 0;
}
function filledRestBetween(ex, defaults) {
  if (hasOwn(ex, "rest_between_sets_secs")) return ex.rest_between_sets_secs;
  if (ex.sets === 1) return void 0;
  return ex.type === "reps" ? defaults.restBetweenReps : defaults.restBetweenTimed;
}
function filledRestAfter(ex, isLastOfLastPhase, defaults) {
  if (hasOwn(ex, "rest_after_exercise_secs")) return ex.rest_after_exercise_secs;
  return isLastOfLastPhase ? defaults.restAfterLast : defaults.restAfter;
}
function minsRoundedUp(secs) {
  return Math.ceil(secs / 60);
}
function durationLabel(secs) {
  return `${minsRoundedUp(secs)} min`;
}
function compileExercise(ex, num, isLastOfLastPhase, defaults) {
  const restBetween = filledRestBetween(ex, defaults);
  const restAfter = filledRestAfter(ex, isLastOfLastPhase, defaults);
  const prep = filledPrep(ex, defaults);
  const work = workSecs(ex, defaults);
  const restBetweenTotal = ex.sets > 1 ? (restBetween ?? 0) * (ex.sets - 1) : 0;
  const secs = work + restBetweenTotal + restAfter;
  const exercise = {
    num,
    name: ex.name,
    type: ex.type,
    ...ex.type === "timed" ? { duration_secs: ex.duration_secs } : { reps: ex.reps },
    sets: ex.sets,
    ...restBetween !== void 0 ? { rest_between_sets_secs: restBetween } : {},
    rest_after_exercise_secs: restAfter,
    ...prep !== void 0 ? { prep_secs: prep } : {},
    ...hasOwn(ex, "optional") ? { optional: ex.optional } : {},
    ...hasOwn(ex, "both_sides") ? { both_sides: ex.both_sides } : {},
    form_cue: ex.form_cue,
    why: ex.why
  };
  return { exercise, secs, restBetween };
}
function compileWorkout(spec, opts = {}) {
  const defaults = resolveDefaults(opts);
  const lastPhaseIdx = spec.phases.length - 1;
  let nextNum = 1;
  let totalSecs = 0;
  const phases = spec.phases.map((phase, phaseIdx) => {
    const lastExIdx = phase.exercises.length - 1;
    const restBetweens = [];
    let roundSecs = 0;
    const exercises = phase.exercises.map((ex, exIdx) => {
      const isLastOfLastPhase = phaseIdx === lastPhaseIdx && exIdx === lastExIdx;
      const compiled = compileExercise(ex, nextNum, isLastOfLastPhase, defaults);
      nextNum += 1;
      roundSecs += compiled.secs;
      if (compiled.restBetween !== void 0) restBetweens.push(compiled.restBetween);
      return compiled.exercise;
    });
    const multiplier = phase.circuit ? phase.rounds ?? 1 : 1;
    const phaseSecs = roundSecs * multiplier;
    totalSecs += phaseSecs;
    const defaultRest = hasOwn(phase, "default_rest_secs") ? phase.default_rest_secs : restBetweens.length > 0 ? Math.max(...restBetweens) : defaults.defaultRest;
    const compiledPhase = {
      name: phase.name,
      duration: hasOwn(phase, "duration") ? phase.duration : durationLabel(phaseSecs),
      default_rest_secs: defaultRest,
      ...hasOwn(phase, "transition_rest_secs") ? { transition_rest_secs: phase.transition_rest_secs } : {},
      ...hasOwn(phase, "optional") ? { optional: phase.optional } : {},
      ...hasOwn(phase, "coaching_note") ? { coaching_note: phase.coaching_note } : {},
      ...hasOwn(phase, "circuit") ? { circuit: phase.circuit } : {},
      ...hasOwn(phase, "rounds") ? { rounds: phase.rounds } : {},
      exercises
    };
    return compiledPhase;
  });
  const workout = {
    id: spec.id,
    title: spec.title,
    subtitle: spec.subtitle,
    workout_type: spec.workout_type,
    estimated_duration_mins: hasOwn(spec, "estimated_duration_mins") ? spec.estimated_duration_mins : minsRoundedUp(totalSecs),
    location: spec.location,
    equipment: spec.equipment,
    coaching_note: spec.coaching_note,
    phases,
    ...hasOwn(spec, "progression_notes") ? { progression_notes: spec.progression_notes } : {}
  };
  return workout;
}
export {
  compileWorkout
};
