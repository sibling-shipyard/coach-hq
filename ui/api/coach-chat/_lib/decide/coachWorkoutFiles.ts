/**
 * Routine/session file appliers: template_edit, session_plan, workout_create, workout_remove.
 * The automatic post-first-session template generator that used to live here - selecting 4-6
 * premade files from shared/workout-library/index.json + templates/ - is gone (A3, #727, bug 1's
 * actual fix). See coachFirstSessionBenchmark.ts and firstWeekCompile.ts for what replaced it: a
 * single benchmark workout_create plus a compiled first week, both dosed from the athlete's own
 * progressions, never a canned template.
 */
import { parseJsonOrNull } from "./coachChatFiles.js";
import type { ProgressionsJson } from "./coachQuestFiles.js";
import { validateWorkout } from "./workoutSchema.js";
import type { Workout } from "../../../../client/src/lib/workouts.js";
import { compileWorkout, type WorkoutSpec } from "../compile-workout.bundle.js";

export const TEMPLATES_PATH_PREFIX = "user_data/activities/workout_plans/templates/";
// coach-redesign workout-backend-wiring §4: session snapshot write path. Same directory
// B_engine.md's "Persisting Session Files" ritual already writes to by hand
// (sessions/YYYY-MM-DD_<workout_id>.json) - this just gives that path a named constant like
// TEMPLATES_PATH_PREFIX has, so coachTurn.ts doesn't hand-roll the string.
export const SESSIONS_PATH_PREFIX = "user_data/activities/workout_plans/sessions/";
// Write-once sentinel: no directory-listing API exists in this codebase's GitHub plumbing
// (githubGitData.ts only ever reads/writes single known paths), so rather than invent one, this
// mirrors coachSinceStamp.ts's write-once pattern (a single known file, checked with the existing
// getFileRaw) - a manifest listing the generated template ids, written alongside the templates in
// the same commit.
export const TEMPLATES_MANIFEST_PATH = `${TEMPLATES_PATH_PREFIX}_manifest.json`;

// coach-redesign workout-backend-wiring §3: template_edit action field. The manifest
// (template_ids) is this codebase's only listing of which routines actually exist for an athlete -
// there's no directory-listing API in the GitHub plumbing (see this file's own header comment), so
// the manifest is the source of truth for "what template_ids can Gemini legitimately reference." A
// missing/unparseable manifest means no routines exist yet (pre-migration athlete, or First
// Session hasn't closed yet) - treated as "nothing is editable," never thrown, same defensive-
// default spirit as every other malformed-content case in this pipeline.
export function validTemplateIdsFromManifest(manifestContent: string | null): ReadonlySet<string> {
  const parsed = parseJsonOrNull<{ template_ids?: string[] }>(manifestContent);
  return new Set(Array.isArray(parsed?.template_ids) ? parsed.template_ids : []);
}

export function templatePath(templateId: string): string {
  return `${TEMPLATES_PATH_PREFIX}${templateId}.json`;
}

// A2 (#727): workout_create/workout_remove both need to rewrite the manifest's template_ids list
// (append on create, drop on remove) - same {generated_at, trace_id, template_ids} shape
// the old post-completion template generator's own manifest write already established.
export function buildManifestContent(templateIds: readonly string[], traceId: string): string {
  return JSON.stringify(
    { generated_at: new Date().toISOString(), trace_id: traceId, template_ids: [...templateIds] },
    null,
    2,
  );
}

/**
 * Applies a template_edit action field: a PERMANENT structural change to one of the athlete's own
 * templates, using the exact same mechanical primitives as session_plan (skip_exercise_nums/
 * skip_phases, resolved server-side, zero Gemini-generated content) - not a free-form rewrite.
 *
 * This was originally a free-form edit: Gemini captured {template_id, instruction} and a second,
 * separate Gemini call generated a whole new template from that instruction. Dropped after live
 * verification - that second call doubled the failure surface of every edit turn (both calls had
 * to succeed under Gemini's live 503 load, and one turn was observed losing a fully-valid primary
 * response when only the second call failed), and per direction, content-generation for templates
 * isn't wanted at all, not just for reliability - some requests (invent a new exercise, swap in
 * unrelated content) simply aren't supported anymore, matching this subsystem's original "Coach
 * must never modify templates" instinct from before this redesign existed.
 *
 * Validates template_id against the athlete's real, already-committed template ids
 * (validTemplateIds, built from the manifest by validTemplateIdsFromManifest) before doing
 * anything else - same "hallucinated id" guard applyQuestEvent already established for quest_id.
 * Validates the result structurally (validateWorkout) before returning - never commit invalid
 * data, same discipline as every other applier in this pipeline.
 */
export function applyTemplateEdit(
  templateContent: string | null,
  edit: {
    template_id: string;
    skip_exercise_nums?: number[];
    skip_phases?: string[];
    note?: string;
  },
  validTemplateIds: ReadonlySet<string>,
  traceId: string,
): string {
  if (!validTemplateIds.has(edit.template_id)) {
    throw new Error(
      `template_edit: no template with id "${edit.template_id}" in this athlete's templates`,
    );
  }

  const current = parseJsonOrNull<Workout>(templateContent);
  if (!current) {
    throw new Error(`template_edit: template "${edit.template_id}" could not be read`);
  }

  const skipNums = new Set(edit.skip_exercise_nums ?? []);
  for (const num of resolvePhaseNames(current.phases, edit.skip_phases ?? [], traceId))
    skipNums.add(num);
  const phases =
    skipNums.size > 0 ? renumberAfterSkip(current.phases, [...skipNums]) : current.phases;

  // A skip was asked for but matched nothing real (adversarial testing: "drop the burpees" when
  // no such exercise/phase exists, or a raw exercise number that was never real to begin with) -
  // appending the note anyway would permanently record a claim ("removed burpees per request")
  // for something that never actually happened. Compared by total exercise count rather than
  // skipNums.size, since skipNums.size alone is true even for a raw skip_exercise_nums entry that
  // never matched any real exercise (only resolvePhaseNames filters unmatched names out - a
  // number is trusted as-is until renumberAfterSkip actually runs). Only suppress the note in
  // that specific case - a note with no skip requested at all (a pure "just leaving context"
  // note) still gets appended normally.
  // Fragility note: skipHappened is count-based, not identity-based - it only checks whether the
  // total exercise count dropped, not which exercises actually left. That's fine today because
  // this code path only ever removes exercises (renumberAfterSkip has no path that adds any), so
  // a lower count can only mean a real skip landed. If a future change ever made this path both
  // add and remove exercises in the same call, a count comparison could stay equal while the
  // content genuinely changed, and this guard would wrongly suppress the note. Not a live bug -
  // just don't reuse this pattern for a path that can add exercises without revisiting it.
  const skipRequested =
    (edit.skip_exercise_nums?.length ?? 0) > 0 || (edit.skip_phases?.length ?? 0) > 0;
  const skipHappened = countExercises(phases) < countExercises(current.phases);
  const trimmedNote = edit.note?.trim();
  const coachingNote =
    trimmedNote && !(skipRequested && !skipHappened)
      ? `${current.coaching_note} — ${trimmedNote}`
      : current.coaching_note;

  const result: Workout = {
    ...current,
    phases,
    coaching_note: coachingNote,
    _meta: { updated_at: new Date().toISOString(), updated_by: "model", trace_id: traceId },
  };

  validateWorkout(result, `template_edit result for "${edit.template_id}"`);

  return JSON.stringify(result, null, 2);
}

// coach-redesign workout-backend-wiring §4: session_plan action field. Write path is dynamic per
// call (date + template_id baked into the filename), unlike every other applier in this file -
// callers build it with this helper rather than hand-rolling the string.
export function sessionPath(sessionDate: string, templateId: string): string {
  return `${SESSIONS_PATH_PREFIX}${sessionDate}_${templateId}.json`;
}

// Renumbers a workout's exercises after removing the nums in skipNums: filters each phase's
// exercises down, then walks every phase in order re-assigning num 1, 2, 3... sequentially across
// the whole workout (never gaps, never restarting per-phase) - B_engine.md's Persisting Session
// Files rule #3 ("exercises removed (re-numbered sequentially, no gaps)"). Matches original
// relative order since it only ever filters+re-labels, never reorders.
// A phase left with zero exercises after skipping is dropped entirely rather than kept and
// rejected by validateWorkout downstream - skipping every exercise in a phase (e.g. "skip the
// whole shoulder phase today, it's flared up") is a real, foreseeable request, not malformed
// input. The base Workout schema requires phases.exercises to be non-empty, so an empty phase
// was never a valid shape to keep around; dropping it is the correct mechanical response, not a
// workaround.
function countExercises(phases: Workout["phases"]): number {
  return phases.reduce((sum, p) => sum + p.exercises.length, 0);
}

export function renumberAfterSkip(
  phases: Workout["phases"],
  skipNums: number[],
): Workout["phases"] {
  const skip = new Set(skipNums);
  let next = 1;
  return phases
    .map((phase) => ({
      ...phase,
      exercises: phase.exercises
        .filter((ex) => !skip.has(ex.num))
        .map((ex) => ({ ...ex, num: next++ })),
    }))
    .filter((phase) => phase.exercises.length > 0);
}

// Resolves plain-language phase names (skip_phases) to exercise nums, matched case-insensitively
// against the real template's own phase names - Gemini is never shown exercise numbers (see
// GeminiReply's comment on session_plan for why), so this is where a name like "shoulder & elbow"
// actually becomes a set of numbers to drop. An unrecognized name is logged and skipped rather
// than thrown - this is best-effort natural-language matching, not an id-hallucination guard like
// template_id/quest_id; a near-miss name shouldn't fail the whole session_plan when
// skip_exercise_nums or other matched phases might still be perfectly good.
function resolvePhaseNames(
  phases: Workout["phases"],
  phaseNames: string[],
  traceId: string,
): number[] {
  const nums: number[] = [];
  for (const name of phaseNames) {
    const target = name.trim().toLowerCase();
    const phase = phases.find((p) => p.name.trim().toLowerCase() === target);
    if (!phase) {
      console.warn(
        `[coach-chat] session_plan: no phase named "${name}" in this template - ignoring`,
        { traceId },
      );
      continue;
    }
    nums.push(...phase.exercises.map((ex) => ex.num));
  }
  return nums;
}

/**
 * Applies a session_plan action field: builds an injury/periodization-adjusted snapshot of one of
 * the athlete's own templates for a specific day (B_engine.md's Persisting Session Files ritual).
 * Validates template_id against the athlete's real, already-committed template ids
 * (validTemplateIds, same manifest-based set applyTemplateEdit already established) before doing
 * anything else - same hallucinated-id guard. No Gemini call: skip_exercise_nums/skip_phases are
 * purely mechanical (resolvePhaseNames + renumberAfterSkip), matching the plan's explicit "no
 * Gemini call needed" for this shape. Validates the final result structurally (validateWorkout)
 * before returning - never commit invalid data, same discipline as applyTemplateEdit. Returns
 * {path, content} rather than just content since, unlike every other applier here, the write path
 * itself is dynamic (per session_date + template_id), not a fixed constant.
 */
export function applySessionPlan(
  templateContent: string | null,
  plan: {
    template_id: string;
    session_date: string;
    skip_exercise_nums?: number[];
    skip_phases?: string[];
    note?: string;
  },
  validTemplateIds: ReadonlySet<string>,
  traceId: string,
): { path: string; content: string } {
  if (!validTemplateIds.has(plan.template_id)) {
    throw new Error(
      `session_plan: no template with id "${plan.template_id}" in this athlete's templates`,
    );
  }

  const base = parseJsonOrNull<Workout>(templateContent);
  if (!base) {
    throw new Error(`session_plan: template "${plan.template_id}" could not be read`);
  }

  const skipNums = new Set(plan.skip_exercise_nums ?? []);
  for (const num of resolvePhaseNames(base.phases, plan.skip_phases ?? [], traceId))
    skipNums.add(num);
  const phases = skipNums.size > 0 ? renumberAfterSkip(base.phases, [...skipNums]) : base.phases;

  // coaching_note: append the athlete-facing reason rather than replace it outright, so any
  // durable context already on the base template (e.g. general session guidance) survives the
  // modification note being layered on top - same "extend, don't clobber" spirit as
  // applyMemoryUpdate elsewhere in this pipeline. No note given: leave the base template's
  // coaching_note untouched, per B_engine.md's rule (a note is only required "for the changes",
  // i.e. only meaningful when something actually changed). A skip was requested but matched
  // nothing real (adversarial testing found this) - same guard as applyTemplateEdit, don't append
  // a note claiming a change that never happened.
  // Same count-based-not-identity-based fragility as applyTemplateEdit's skipHappened above: this
  // only checks whether the total count dropped, which is only a valid stand-in for "a real skip
  // happened" because this path never adds exercises. Revisit if that ever changes.
  const skipRequested =
    (plan.skip_exercise_nums?.length ?? 0) > 0 || (plan.skip_phases?.length ?? 0) > 0;
  const skipHappened = countExercises(phases) < countExercises(base.phases);
  const trimmedNote = plan.note?.trim();
  const coachingNote =
    trimmedNote && !(skipRequested && !skipHappened)
      ? `${base.coaching_note} — ${trimmedNote}`
      : base.coaching_note;

  const session: Workout = {
    ...base,
    phases,
    session_date: plan.session_date,
    based_on_template: templatePath(plan.template_id),
    coaching_note: coachingNote,
    _meta: { updated_at: new Date().toISOString(), updated_by: "model", trace_id: traceId },
  };

  validateWorkout(session, `session_plan result for "${plan.template_id}" on ${plan.session_date}`);

  return {
    path: sessionPath(plan.session_date, plan.template_id),
    content: JSON.stringify(session, null, 2),
  };
}

// A2 (#727): workout_create/workout_remove action fields. Coach sends a minimal exercise spec
// mid-conversation (never timer physics - compileWorkout() fills that in) and it's committed into
// the athlete's existing routine storage (the same TEMPLATES_PATH_PREFIX/TEMPLATES_MANIFEST_PATH
// template_edit/session_plan already write to - no rename in this stack, that's a later PR's job
// per the plan). The wire shape matches WorkoutSpec's SpecExercise/SpecPhase (compileWorkout.mts)
// closely but is not the same type: Coach never sends `id`/`subtitle`/timer-physics fields, and
// carries scaled_from/injury_ack, which compileWorkout doesn't know about.
export interface WorkoutCreateAck {
  flag: string;
  accommodation: string;
}

export interface WorkoutCreateSpecExercise {
  name: string;
  type: "reps" | "timed";
  form_cue: string;
  why: string;
  reps?: number;
  duration_secs?: number;
  sets: number;
  both_sides?: boolean;
  progression_id?: string;
  scaled_from?: string;
}

export interface WorkoutCreateSpecPhase {
  name: string;
  exercises: WorkoutCreateSpecExercise[];
}

export interface WorkoutCreateSpec {
  title: string;
  workout_type: Workout["workout_type"];
  location?: string;
  coaching_note?: string;
  equipment?: string[];
  phases: WorkoutCreateSpecPhase[];
  injury_ack?: WorkoutCreateAck[];
}

// Slugifies a title into a routine id, suffixing on collision with existingIds (applier step 1).
// Falls back to "routine" for a title with no ASCII alphanumerics at all (e.g. all emoji/symbols)
// rather than producing an empty string id.
export function slugifyRoutineId(title: string, existingIds: ReadonlySet<string>): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "routine";
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

// Progression.current (coachQuestFiles.ts) is free text written by Coach over time - real files
// hold things like "L 14s / R 11s (Aug 19, LEFT-first)" or "3x8 clean, no band (Aug 19)", not a
// bare number. Invariant 2 only has a mechanical dose to compare against when a leading number can
// actually be pulled out of that text; anything else (no digits, or a value that's plainly a
// composite like "3x8") is treated the same as no current value at all - see applyWorkoutCreate's
// call site for why that's the safe default, not a silent invariant skip.
function parseLeadingNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^\s*(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  // "3x8 clean, no band" - the leading digit is a set count, not a dose. Anything of the form
  // "<number>x<number>" right after the leading digit is exactly the composite case the comment
  // above already calls out as unparseable; matching only the first digit run (the old bug) read
  // the "3" out of "3x8" as if it were a real dose.
  if (/^\s*[x×]\s*\d/i.test(match[2])) return null;
  return Number(match[1]);
}

function exerciseDose(ex: WorkoutCreateSpecExercise): number {
  return ex.type === "timed" ? (ex.duration_secs ?? 0) * ex.sets : (ex.reps ?? 0) * ex.sets;
}

/**
 * Applies a workout_create action field: turns Coach's minimal spec into a compiled, validated
 * routine file, enforcing invariants 1/2/7/8 before anything is written.
 *
 * - Invariant 7 (injury ack): every active injury flag id must have a matching entry in
 *   spec.injury_ack (matched by id, the same identifier activeInjuryFlagsSection shows Coach in
 *   context - see coachContext.ts). The schema itself makes injury_ack structurally required
 *   whenever the athlete has an active flag (coachReplySchema.ts's withReferenceEnums); this is
 *   the real enforcement point, same defense-in-depth relationship applyTemplateEdit already has
 *   with its own schema-level `required`.
 * - Invariant 1/8 (progression id): a progression_id already in progressions.json resolves
 *   normally. One that doesn't exist yet is allowed only when the same exercise also carries
 *   scaled_from - otherwise this throws, since an invented id with no acknowledgment that it's a
 *   fresh start is exactly the hallucinated-reference class of bug this pipeline's other appliers
 *   already guard against.
 * - Invariant 2 (dose cap): for a progression_id that resolves to an existing progression with a
 *   parseable numeric current, the exercise's dose (reps or duration_secs, times sets) may not
 *   exceed it.
 *
 * Returns the new routine's id and its compiled, structurally-validated JSON content - never
 * writes anything itself, same "pure applier, I/O lives in turnWrites/" split as every other
 * function in this file.
 */
export function applyWorkoutCreate(
  spec: WorkoutCreateSpec,
  existingRoutineIds: ReadonlySet<string>,
  activeInjuryFlagIds: ReadonlySet<string>,
  progressions: ProgressionsJson | null,
  traceId: string,
): { id: string; content: string } {
  const ackedFlags = new Set((spec.injury_ack ?? []).map((ack) => ack.flag));
  const unacked = [...activeInjuryFlagIds].filter((flagId) => !ackedFlags.has(flagId));
  if (unacked.length > 0) {
    throw new Error(
      `workout_create: active injury flag(s) not acknowledged: ${unacked.join(", ")}`,
    );
  }

  const progressionsById = new Map(
    (progressions?.progressions ?? []).map((progression) => [progression.id, progression]),
  );

  for (const phase of spec.phases) {
    for (const ex of phase.exercises) {
      if (!ex.progression_id) continue;
      const existing = progressionsById.get(ex.progression_id);
      if (!existing) {
        if (!ex.scaled_from?.trim()) {
          throw new Error(
            `workout_create: progression_id "${ex.progression_id}" on "${ex.name}" doesn't exist` +
              ' yet and has no "scaled_from" - a new progression must say what its dose was' +
              " scaled from",
          );
        }
        continue;
      }
      const currentDose = parseLeadingNumber(existing.current);
      // No parseable numeric current - real progressions.json often holds composite/prose values
      // (see parseLeadingNumber's comment); nothing mechanical to compare the dose against, so
      // this invariant is a no-op here rather than a guess. `current: null` (A3's "not yet
      // benchmarked" case) hits this same branch.
      if (currentDose == null) continue;
      const dose = exerciseDose(ex);
      if (dose > currentDose) {
        throw new Error(
          `workout_create: "${ex.name}" doses ${dose} above progression "${ex.progression_id}"'s` +
            ` current value (${existing.current})`,
        );
      }
    }
  }

  const id = slugifyRoutineId(spec.title, existingRoutineIds);
  // validateWorkout requires both subtitle and coaching_note to be non-empty strings, but the
  // schema leaves coaching_note optional (a real, useful routine can arrive with no note at all -
  // there's nothing forcing Coach to write one). Falling back to the title itself keeps the
  // compiled file structurally valid (invariant 5) without inventing coaching content that was
  // never actually said.
  const coachingNote = spec.coaching_note?.trim() || spec.title;
  const workoutSpec: WorkoutSpec = {
    id,
    title: spec.title,
    subtitle: coachingNote,
    workout_type: spec.workout_type,
    // validateWorkout requires a non-empty location too, but the schema leaves it optional -
    // same "location isn't specified" case as an equipment-free bodyweight routine that works
    // anywhere, so that's the fallback rather than an empty string.
    location: spec.location?.trim() || "Anywhere",
    equipment: spec.equipment ?? [],
    coaching_note: coachingNote,
    phases: spec.phases.map((phase) => ({
      name: phase.name,
      exercises: phase.exercises.map((ex) => ({
        name: ex.name,
        type: ex.type,
        reps: ex.reps,
        duration_secs: ex.duration_secs,
        sets: ex.sets,
        form_cue: ex.form_cue,
        why: ex.why,
        both_sides: ex.both_sides,
        progression_id: ex.progression_id,
      })),
    })),
  };

  const compiled = compileWorkout(workoutSpec);
  const result: Workout = {
    ...compiled,
    _meta: { updated_at: new Date().toISOString(), updated_by: "model", trace_id: traceId },
  };

  validateWorkout(result, `workout_create result for "${id}"`);

  return { id, content: JSON.stringify(result, null, 2) };
}

/**
 * Applies a workout_remove action field: resolves routine_id against the manifest (throwing on an
 * unknown one, the same hallucinated-id guard as everything else in this file) and returns the
 * updated manifest's template_ids with that id dropped. Callers build the actual file-delete +
 * manifest-write pair from this - progressions.json is deliberately left untouched (a removed
 * routine doesn't erase tracked history).
 */
export function applyWorkoutRemove(
  routineId: string,
  existingRoutineIds: ReadonlySet<string>,
): { remainingIds: string[] } {
  if (!existingRoutineIds.has(routineId)) {
    throw new Error(`workout_remove: no routine with id "${routineId}"`);
  }
  return { remainingIds: [...existingRoutineIds].filter((id) => id !== routineId) };
}
