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
import { GEMINI_MODEL } from "../../../_lib/geminiModel.js";
import { captureGeminiFailure } from "../../../_lib/sentry.js";
import {
  selectLlmAdapter,
  type LlmJsonSchema,
  type LlmJsonSchemaNode,
} from "../../../_lib/llmClient.js";
import type { FileEntry } from "../../../_lib/githubGitData.js";
import type { ProfileJson, MemoryJson, InjuriesJson } from "./coachMemoryFiles.js";
import type { ProgressionsJson } from "./coachQuestFiles.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
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

export interface WorkoutLibraryIndexEntry {
  id: string;
  sport_tags: string[];
  equipment: string[];
  goal_tags: string[];
  level: "beginner" | "intermediate" | "advanced";
}

const here = path.dirname(fileURLToPath(import.meta.url));
// ui/api/coach-chat/_lib/decide -> repo root is five levels up.
const LIBRARY_DIR = path.resolve(here, "..", "..", "..", "..", "..", "shared", "workout-library");

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

// The one array item's own properties - typed and checked in isolation (#713 M2 PR 3, same
// compiler-verified-completeness idiom as coachReplySchema.ts's RESPONSE_PROPERTIES) so the
// `satisfies` check catches a missing `additionalProperties` on any nested object node here,
// not just eyeballing. None of these three leaves are objects themselves, so there's nothing to
// nest today, but the check stays in place for whoever adds one next.
const ADJUSTMENT_ITEM_PROPERTIES = {
  template_id: { type: "string" },
  coaching_note: { type: "string" },
  progression_notes: { type: "string" },
} as const satisfies Record<string, LlmJsonSchemaNode>;

// The full strict-mode schema for this call, typed as LlmJsonSchema directly - that annotation
// alone makes the compiler demand `additionalProperties: false` on both the top-level object and
// the `adjustments` array's item object, at any depth, the same guarantee PR 2's separate
// `satisfies` step gave RESPONSE_PROPERTIES's 19 objects.
const TEMPLATE_ADJUSTMENT_RESPONSE_SCHEMA: LlmJsonSchema = {
  name: "template_adjustments",
  schema: {
    type: "object",
    properties: {
      adjustments: {
        type: "array",
        items: {
          type: "object",
          properties: ADJUSTMENT_ITEM_PROPERTIES,
          required: ["template_id"],
          additionalProperties: false,
        },
      },
    },
    required: ["adjustments"],
    additionalProperties: false,
  },
};

// #713 M2 PR 3: reaches the model through the same provider-neutral seam every other caller
// uses (llmClient.ts's selectLlmAdapter) instead of opening its own socket. `system: ""` because
// this call has no natural system/user split - one flat prompt, same as coach-message
// (geminiClient.ts's askGemini keeps this shape too, for the same reason). The env override
// mirrors askGemini's own convention: apiKey arrives as a parameter (threaded down from
// coach-chat.ts's process.env.GEMINI_API_KEY read) rather than this file reading env directly, so
// this stays a pure function of its arguments for tests. No cachePrefix (no stable prefix to
// cache) and no manual usage recording - both adapters already wrap `generate()` in their own
// Sentry span, so a second span here would double-count.
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

  const adapter = selectLlmAdapter({ ...process.env, GEMINI_API_KEY: apiKey });
  // Tags the resolved adapter's real model onto any throw below, same as geminiClient.ts's
  // askGemini - generateInitialTemplates's own catch reports this to Sentry and must not always
  // claim direct Gemini ran when LLM_PROVIDER=openrouter picked a different adapter. Wraps the
  // JSON.parse below too, not just adapter.generate() - a malformed 2xx body is otherwise an
  // untagged SyntaxError, the same mislabeling this file's other caller was fixed for.
  const withModelTag = <T>(err: T): T => {
    if (err && typeof err === "object" && !("model" in err)) {
      Object.assign(err, { model: adapter.model });
    }
    return err;
  };

  let result;
  try {
    result = await adapter.generate({
      system: "",
      messages: [{ role: "user", text: prompt }],
      maxOutputTokens: 1024,
      responseSchema: TEMPLATE_ADJUSTMENT_RESPONSE_SCHEMA,
      timeoutMs: 20_000,
    });
  } catch (err) {
    throw withModelTag(err);
  }

  let parsed: { adjustments?: TemplateAdjustment[] };
  try {
    parsed = JSON.parse(result.text) as { adjustments?: TemplateAdjustment[] };
  } catch (err) {
    throw withModelTag(err);
  }
  return Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
};

/**
 * Generates the athlete's initial workout templates on the turn that completes First Session:
 * deterministic selection (selectTemplates), one light Gemini adjustment pass, then a
 * FileEntry[] ready for commitFilesAtomic (a separate commit from the turn's own one - see
 * coachTurn.ts's generateTemplatesAfterCompletion). Never throws for a Gemini failure - falls
 * back to the unadjusted templates from the library so onboarding always produces *something*,
 * and the caller in coachTurn.ts is expected not to let this block or fail the athlete's
 * response either way.
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
      // adjustTemplatesWithGemini tags the resolved adapter's real model onto the error before it
      // propagates here - falls back to the direct-Gemini constant only if that never ran.
      model: (err as { model?: string }).model ?? GEMINI_MODEL,
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

// A2 (#727): workout_create/workout_remove both need to rewrite the manifest's template_ids list
// (append on create, drop on remove) - same {generated_at, trace_id, template_ids} shape
// generateInitialTemplates's own manifestWrite already establishes.
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
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
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
