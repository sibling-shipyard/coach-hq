/**
 * Post-first-session template generation (coach-redesign workout-backend-wiring §2). On the
 * false→true profileComplete transition (same trigger as coachSinceStamp.ts's
 * injectCoachSinceIfNeeded / ADR 0018), coachTurn.ts calls generateInitialTemplates to pick 4-6
 * templates out of shared/workout-library/ for the athlete, lightly personalize them with one
 * small Gemini call, and commit them into the athlete's own
 * user_data/activities/workout_plans/templates/. Selection itself is deterministic - no Gemini
 * call decides *which* templates, only small text/number tweaks on the ones already picked, kept
 * intentionally small per the plan's "don't put Gemini under field pressure" instruction.
 *
 * shared/workout-library/ is HQ-side seed content, read straight off the coach-hq filesystem via
 * fs.readFileSync (same repo-relative-path convention _tests/workoutLibrary.test.ts already
 * uses) rather than bundled through a build step - ui/api runs as plain Node on Vercel, so a
 * relative fs read at request time works the same as it does in a test, and nothing else in this
 * codebase bundles static seed content unless it's shipped to a *browser* runtime (soul.ts is
 * bundled because it's needed both server-side and, historically, client-side; this is server-
 * only).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GEMINI_MODEL } from "../../_lib/geminiModel.js";
import { geminiAuthHeaders } from "../../_lib/geminiAuth.js";
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";
import { captureGeminiFailure, withGeminiSpan } from "../../_lib/sentry.js";
import type { FileEntry } from "../../_lib/githubGitData.js";
import type { ProfileJson, MemoryJson, InjuriesJson } from "./coachMemoryFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
import { validateWorkout } from "./workoutSchema.js";
import type { Workout } from "../../../client/src/lib/workouts.js";

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

export interface WorkoutLibraryIndexEntry {
  id: string;
  sport_tags: string[];
  equipment: string[];
  goal_tags: string[];
  level: "beginner" | "intermediate" | "advanced";
}

const here = path.dirname(fileURLToPath(import.meta.url));
// ui/api/coach-chat/_lib -> repo root is four levels up.
const LIBRARY_DIR = path.resolve(here, "..", "..", "..", "..", "shared", "workout-library");

export function loadWorkoutLibraryIndex(): WorkoutLibraryIndexEntry[] {
  const raw = fs.readFileSync(path.join(LIBRARY_DIR, "index.json"), "utf-8");
  return JSON.parse(raw) as WorkoutLibraryIndexEntry[];
}

export function loadWorkoutLibraryTemplate(id: string): Workout {
  const raw = fs.readFileSync(path.join(LIBRARY_DIR, "templates", `${id}.json`), "utf-8");
  return JSON.parse(raw) as Workout;
}

// Vocabulary shared_workout-library/README.md documents for goal_tags - used to pull a coarse
// goal signal out of memory.json's free-text notes, since there is no structured "goal" field
// (issue #408 dropped it from memory.json entirely; seasons.json's name + quests.json's
// main_quest represent it now, neither of which selectTemplates receives). Judgment call: rather
// than plumb quests.json through here too, this matches keywords in
// coaching_priorities/fitness_baseline text against the existing goal_tags vocabulary, defaulting
// to "general_fitness" when nothing matches - same "reasonable default, never throw" spirit as
// applyProfileUpdate's fallbacks elsewhere in this pipeline.
const GOAL_KEYWORDS: Record<string, string[]> = {
  build_strength: ["strength", "muscle", "strong", "lift", "power"],
  endurance: ["endurance", "stamina", "cardio", "distance", "marathon", "run"],
  injury_prevention: ["injury", "prehab", "rehab", "pain", "prevent"],
  mobility: ["mobility", "flexib", "stretch"],
  skill_development: ["skill", "handstand", "pull-up", "pullup", "technique"],
  general_fitness: [],
};

function inferGoalTags(memory: MemoryJson): string[] {
  const text = [
    memory.notes?.coaching_priorities?.text ?? "",
    memory.notes?.fitness_baseline?.text ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const matched = Object.entries(GOAL_KEYWORDS)
    .filter(
      ([goal, keywords]) => goal !== "general_fitness" && keywords.some((k) => text.includes(k)),
    )
    .map(([goal]) => goal);

  return matched.length > 0 ? matched : ["general_fitness"];
}

// Coarse level inference from memory's fitness_baseline note text - same keyword-matching spirit
// as inferGoalTags, defaulting to "beginner" (the safest default for someone at First Session
// close, where nothing else has been reported yet).
function inferLevel(memory: MemoryJson): "beginner" | "intermediate" | "advanced" {
  const text = (memory.notes?.fitness_baseline?.text ?? "").toLowerCase();
  if (/(advanced|experienced|years of training|competit)/.test(text)) return "advanced";
  if (/(intermediate|some experience|been training|regularly train)/.test(text))
    return "intermediate";
  return "beginner";
}

// Equipment vocabulary matches shared/workout-library/README.md exactly. memory.json's
// "equipment" note is free text (Coach writes it, not a fixed enum), so this is keyword matching
// against that vocabulary too - "bodyweight" is always included as a safe fallback since every
// athlete can do a bodyweight-only template regardless of what else they have.
const EQUIPMENT_KEYWORDS: Record<string, string[]> = {
  dumbbells: ["dumbbell"],
  full_gym: ["full gym", "gym membership", "barbell", "squat rack", "bench press"],
  resistance_band: ["resistance band", "bands"],
  pull_up_bar: ["pull-up bar", "pull up bar", "pullup bar"],
  parallettes: ["parallette"],
};

function inferEquipment(memory: MemoryJson): string[] {
  const text = (memory.notes?.equipment?.text ?? "").toLowerCase();
  const matched = Object.entries(EQUIPMENT_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => text.includes(k)))
    .map(([equip]) => equip);
  return ["bodyweight", ...matched];
}

// Simple keyword sniff test: does an active injury flag's free text plausibly conflict with a
// template tagged the way this one is? Keyword-based per the plan's explicit instruction ("simple
// keyword-based matching against the flag text is fine"). Maps a body-part/movement keyword found
// in the flag text to the sport_tags/goal_tags that would aggravate it - e.g. a flagged shoulder
// rules out realign_shoulder_prehab's own sport_tags (badminton/swimming/tennis, all
// overhead-heavy) and anything tagged skill_development in calisthenics (pull-ups, presses are
// shoulder-loaded), while NOT ruling out running/leg-focused templates.
const INJURY_CONFLICT_TAGS: { keyword: RegExp; conflictingSportTags: string[] }[] = [
  {
    keyword: /shoulder|rotator cuff|overhead/,
    conflictingSportTags: ["badminton", "swimming", "tennis", "calisthenics"],
  },
  { keyword: /knee/, conflictingSportTags: ["running"] },
  { keyword: /back|spine|lumbar/, conflictingSportTags: ["strength_training"] },
  { keyword: /ankle|foot/, conflictingSportTags: ["running"] },
  { keyword: /wrist|elbow/, conflictingSportTags: ["calisthenics"] },
];

function conflictsWithActiveInjuries(
  entry: WorkoutLibraryIndexEntry,
  injuries: InjuriesJson,
): boolean {
  const activeTexts = (injuries.flags ?? [])
    .filter((f) => f.status === "active")
    .map((f) => f.text.toLowerCase());
  if (activeTexts.length === 0) return false;

  for (const text of activeTexts) {
    for (const rule of INJURY_CONFLICT_TAGS) {
      if (!rule.keyword.test(text)) continue;
      if (entry.sport_tags.some((t) => rule.conflictingSportTags.includes(t))) return true;
    }
  }
  return false;
}

/**
 * Deterministic tag-matching selection against shared/workout-library/index.json. Filters out
 * anything an active injury flag rules out (conflictsWithActiveInjuries), then scores the
 * remainder by how many of sport/equipment/goal/level match the athlete, and returns 4-6 ids
 * spanning a spread of workout types where the library has variety (never all the same
 * template - realign/recovery entries always get a fair shot alongside foundation/strength ones
 * so an injury-aware pick doesn't get crowded out purely by score).
 */
export function selectTemplates(
  profile: ProfileJson,
  memory: MemoryJson,
  injuries: InjuriesJson,
  library: WorkoutLibraryIndexEntry[],
): string[] {
  const sports = (memory.sports ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const goalTags = inferGoalTags(memory);
  const equipment = inferEquipment(memory);
  const level = inferLevel(memory);

  // An athlete with several active injury flags can, in principle, have every library entry
  // conflict with at least one of them (conflictsWithActiveInjuries filters per-entry, not
  // per-athlete, so nothing stops the intersection of "rules out" from covering the whole
  // library). Falling back to the unfiltered library rather than returning nothing means First
  // Session close never commits zero templates - a worse outcome for the athlete than a template
  // that technically brushes against one of their injury tags. console.warn so this is visible
  // rather than silently swallowed.
  let eligible = library.filter((entry) => !conflictsWithActiveInjuries(entry, injuries));
  if (eligible.length === 0) {
    console.warn(
      "[coach-chat] selectTemplates: every library entry conflicted with an active injury flag - falling back to the full library",
    );
    eligible = library;
  }
  const activeInjuryTexts = (injuries.flags ?? [])
    .filter((f) => f.status === "active")
    .map((f) => f.text.toLowerCase());

  // Score: +2 per matching sport_tag (or "general_fitness" tag as a universal partial match),
  // +2 per matching equipment the athlete actually has, +1 per matching goal_tag, +1 for an
  // exact level match, +0.5 for adjacent level, +3 if the template is an injury_prevention entry
  // whose goal_tags directly address an active flag (mirrors the Weekly Kick-off Ritual's
  // existing hand-applied "injury present -> pre-apply modifications" behavior) - never 0,
  // everything eligible is at least a plausible pick.
  const scored = eligible.map((entry) => {
    let score = 0;
    if (entry.sport_tags.some((t) => sports.includes(t) || t === "general_fitness")) score += 2;
    // entry.equipment.length === 0 is a bodyweight-only template - it needs nothing the athlete
    // lacks, so it deliberately gets the same "no equipment blocker" bonus as an exact equipment
    // match. Spelled out explicitly rather than leaning on .every() returning true on an empty
    // array, which would happen to produce the same score by accident.
    if (entry.equipment.length === 0 || entry.equipment.every((e) => equipment.includes(e)))
      score += 2;
    score += entry.goal_tags.filter((t) => goalTags.includes(t)).length;
    if (entry.level === level) score += 1;
    else if (Math.abs(LEVEL_RANK[entry.level] - LEVEL_RANK[level]) === 1) score += 0.5;
    if (entry.goal_tags.includes("injury_prevention") && activeInjuryTexts.length > 0) score += 3;
    return { entry, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Cover a spread: walk workout_type buckets round-robin-ish by taking the best scored entry
  // from each id-prefix (foundation_/strength_/recovery_/realign_/calisthenics_) before filling
  // remaining slots by raw score, so a single dominant sport doesn't crowd out variety.
  const TARGET = 6;
  const MIN = 4;
  const byPrefix = new Map<string, typeof scored>();
  for (const s of scored) {
    const prefix = s.entry.id.split("_")[0];
    const bucket = byPrefix.get(prefix) ?? [];
    bucket.push(s);
    byPrefix.set(prefix, bucket);
  }

  const picked: string[] = [];
  const pickedIds = new Set<string>();
  for (const bucket of byPrefix.values()) {
    const best = bucket[0];
    if (best && !pickedIds.has(best.entry.id)) {
      picked.push(best.entry.id);
      pickedIds.add(best.entry.id);
    }
  }
  for (const s of scored) {
    if (picked.length >= TARGET) break;
    if (pickedIds.has(s.entry.id)) continue;
    picked.push(s.entry.id);
    pickedIds.add(s.entry.id);
  }

  // MIN used to be "enforced" by a ternary that was actually a no-op (picked.slice(0, TARGET) and
  // picked are the same array whenever picked.length <= TARGET, so the "else" branch never fired
  // anything different). There's no larger pool to draw from here - picked is already every
  // eligible, scored entry - so there's nothing to relax into. Just warn when the athlete's real
  // library leaves us under MIN (e.g. injuries knocked out most of it) so it's visible, and return
  // what we have.
  if (picked.length < MIN) {
    console.warn(
      `[coach-chat] selectTemplates: only ${picked.length} eligible templates, below MIN (${MIN})`,
    );
  }
  return picked.slice(0, TARGET);
}

const LEVEL_RANK: Record<"beginner" | "intermediate" | "advanced", number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

// Small, separate schema - per the plan's explicit instruction to keep Gemini under minimal
// field pressure here. Not the main per-turn GeminiReply schema (coachReplySchema.ts) - this is its
// own light call with its own response shape.
interface TemplateAdjustment {
  template_id: string;
  coaching_note?: string;
  progression_notes?: string;
}

// Injectable so tests can supply a fake instead of hitting the real network - matches this
// codebase's existing pattern of the network call living in its own small function
// (geminiClient.ts's askGemini) that callers can swap out.
export type AdjustTemplatesFn = (
  apiKey: string,
  templates: Workout[],
  memory: MemoryJson,
) => Promise<TemplateAdjustment[]>;

export const adjustTemplatesWithGemini: AdjustTemplatesFn = async (apiKey, templates, memory) => {
  const level = inferLevel(memory);
  const prompt = [
    "The athlete just finished onboarding. Below are workout templates picked for them from a generic library.",
    `Athlete's inferred training level: ${level}.`,
    "For each template, you may lightly personalize coaching_note and progression_notes text " +
      "(e.g. tone the language to their level) - do not change exercises, sets, reps, or structure.",
    "Return an array with one entry per template_id, each with the (possibly unchanged) coaching_note/progression_notes.",
    JSON.stringify(
      templates.map((t) => ({
        id: t.id,
        coaching_note: t.coaching_note,
        progression_notes: t.progression_notes,
      })),
    ),
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: 1024,
      responseSchema: {
        type: "object",
        properties: {
          adjustments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                template_id: { type: "string" },
                coaching_note: { type: "string" },
                progression_notes: { type: "string" },
              },
              required: ["template_id"],
            },
          },
        },
        required: ["adjustments"],
      },
    },
  };

  return withGeminiSpan(GEMINI_MODEL, async (recordUsage) => {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...geminiAuthHeaders(apiKey) },
        body: JSON.stringify(body),
      },
      20_000,
    );
    if (!res.ok) {
      const detail = await res.text();
      throw Object.assign(
        new Error(`Gemini template-adjustment call failed (${res.status}): ${detail}`),
        { status: res.status },
      );
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    if (json.usageMetadata) {
      recordUsage({
        promptTokens: json.usageMetadata.promptTokenCount,
        completionTokens: json.usageMetadata.candidatesTokenCount,
        totalTokens: json.usageMetadata.totalTokenCount,
      });
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini template-adjustment call returned no content");
    const parsed = JSON.parse(text) as { adjustments?: TemplateAdjustment[] };
    return Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
  });
};

/**
 * Generates the athlete's initial workout templates on First Session close: deterministic
 * selection (selectTemplates), one light Gemini adjustment pass, then a FileEntry[] ready for
 * commitFilesAtomic (a separate commit from the main closing-turn one - see coachTurn.ts).
 * Never throws for a Gemini failure - falls back to the unadjusted templates from the library
 * so onboarding always produces *something*, and the caller in coachTurn.ts is expected not to
 * let this block or fail the athlete's response either way.
 */
export async function generateInitialTemplates(
  profile: ProfileJson,
  memory: MemoryJson,
  injuries: InjuriesJson,
  timezone: string,
  traceId: string,
  apiKey: string,
  adjustFn: AdjustTemplatesFn = adjustTemplatesWithGemini,
): Promise<{ templates: FileEntry[] }> {
  const library = loadWorkoutLibraryIndex();
  const selectedIds = selectTemplates(profile, memory, injuries, library);
  const baseTemplates = selectedIds.map((id) => loadWorkoutLibraryTemplate(id));

  let adjustments: TemplateAdjustment[] = [];
  try {
    adjustments = await adjustFn(apiKey, baseTemplates, memory);
  } catch (err) {
    console.warn(
      "[coach-chat] template adjustment Gemini call failed - using unadjusted library templates",
      err,
      { traceId },
    );
    // Deliberately non-fatal: capture for visibility, then fall through to the unadjusted
    // library templates below so onboarding always produces something.
    await captureGeminiFailure(err, {
      traceId,
      model: GEMINI_MODEL,
      upstreamStatus: (err as { status?: number }).status ?? 500,
      turnMode: "template_adjust",
      // The adjustment pass personalizes library templates from athlete memory, not from
      // athlete-typed text - there is nothing to record here.
      athleteMessage: "",
    });
  }
  const byId = new Map(adjustments.map((a) => [a.template_id, a]));

  const now = new Date().toISOString();
  const finalTemplates: Workout[] = baseTemplates.map((t) => {
    const adj = byId.get(t.id);
    return {
      ...t,
      coaching_note: adj?.coaching_note?.trim() || t.coaching_note,
      progression_notes: adj?.progression_notes?.trim() || t.progression_notes,
      _meta: { updated_at: now, updated_by: "model", trace_id: traceId },
    };
  });

  const templateWrites: FileEntry[] = finalTemplates.map((t) => ({
    path: templatePath(t.id),
    content: JSON.stringify(t, null, 2),
  }));
  const manifestWrite: FileEntry = {
    path: TEMPLATES_MANIFEST_PATH,
    content: JSON.stringify(
      { generated_at: now, trace_id: traceId, template_ids: finalTemplates.map((t) => t.id) },
      null,
      2,
    ),
  };

  return { templates: [...templateWrites, manifestWrite] };
}

// coach-redesign workout-backend-wiring §3: template_edit action field. The manifest
// generateInitialTemplates writes above (template_ids) is this codebase's only listing of which
// templates actually exist for an athlete - there's no directory-listing API in the GitHub
// plumbing (see this file's own header comment), so the manifest is the source of truth for
// "what template_ids can Gemini legitimately reference." A missing/unparseable manifest means no
// templates exist yet (pre-migration athlete, or First Session hasn't closed yet) - treated as
// "nothing is editable," never thrown, same defensive-default spirit as every other malformed-
// content case in this pipeline.
export function validTemplateIdsFromManifest(manifestContent: string | null): ReadonlySet<string> {
  const parsed = parseJsonOrNull<{ template_ids?: string[] }>(manifestContent);
  return new Set(Array.isArray(parsed?.template_ids) ? parsed.template_ids : []);
}

export function templatePath(templateId: string): string {
  return `${TEMPLATES_PATH_PREFIX}${templateId}.json`;
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
