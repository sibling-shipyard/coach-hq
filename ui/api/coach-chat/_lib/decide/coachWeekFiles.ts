/**
 * ADR 0042: current_week.json wiring. One action field - week_update - replaces the old
 * week_plan/session_reconcile/plan_edit trio. The same object patches an existing week (status
 * changes, content edits, moves) or, when it carries a full headline/body/7-day payload, commits a
 * fresh week outright (the old week_plan behavior). Same "Gemini reports a small fact, server owns
 * every bookkeeping field" principle as coachWorkoutFiles.ts/coachIntents.ts. Both paths build a
 * full CurrentWeek object and run it through parseCurrentWeek before returning - never commit
 * something the strict schema v1 validator would reject (engine/lib/current-week.mts).
 *
 * Field-length/enum rules (title <=96 chars, guardrails <=6 items, etc.) are NOT re-validated
 * here - parseCurrentWeek is the single source of truth for those, and a violation is exactly the
 * "fails loudly rather than committing" case the plan's testing section asks for. This file only
 * handles the bookkeeping parseCurrentWeek can't compute for itself (ids, dates, timestamps) plus
 * a couple of judgment calls documented inline below.
 */
import {
  parseCurrentWeek,
  SESSION_DISCIPLINES,
  type CurrentWeek,
  type CurrentWeekDay,
  type CurrentWeekSession,
  type CurrentWeekSessionDiscipline,
  type CurrentWeekSessionPriority,
} from "../current-week.bundle.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
import { todayDateString } from "./coachDay.js";

export const CURRENT_WEEK_PATH = "user_data/ledger/current_week.json";

// ADR 0042: discipline is a closed enum, enforced at the JSON-schema level (coachReplySchema.ts's
// week_update.days[].sessions[].discipline enum) - Gemini genuinely can't emit an off-list value
// under normal structured-output compliance. This is real defense in depth, not the primary
// guard: live-verified before the schema enum was added, Gemini sent "hiking" for the real value
// "hike" and this caught it, same lenient-coerce-with-a-warning treatment template_id already
// gets below, not a thrown error. "other" is a real, pickable enum member, so a genuinely
// unrecognized string reads as a deliberate "none of the above," not a bug.
const DISCIPLINE_SET = new Set<string>(SESSION_DISCIPLINES);
// A near-miss (gerund, plural, a bare sport_type-style name) reads as a real intent worth
// recovering, not a genuine "none of the above" - "other" should mean the athlete's activity
// truly isn't one of these fifteen, not that Gemini phrased a real match slightly differently.
// Covers every sport in the enum on the same principle, not case-by-case: this is the same
// synonym set docs/plans/athlete-repo-migration-973.md's own migration transform uses for
// existing repo data, kept in sync with it by hand since one's Python and one's TypeScript.
const DISCIPLINE_SYNONYMS: Record<string, CurrentWeekSessionDiscipline> = {
  weighttraining: "weight_training",
  running: "run",
  ride: "cycling",
  bike: "cycling",
  realign: "recovery",
  mobility: "recovery",
  hiking: "hike",
  walking: "walk",
  soccer: "football",
  swimming: "swim",
  calisthenic: "calisthenics",
};
function coerceDiscipline(raw: string, traceId: string): CurrentWeekSessionDiscipline {
  const normalized = raw.trim().toLowerCase();
  if (DISCIPLINE_SET.has(normalized)) return normalized as CurrentWeekSessionDiscipline;
  const synonym = DISCIPLINE_SYNONYMS[normalized];
  if (synonym) return synonym;
  console.warn(`[coach-chat] discipline "${raw}" is not in the closed set - writing "other"`, {
    traceId,
  });
  return "other";
}

// Same nulling-with-a-warning pattern coerceDiscipline uses above, applied to template_id - a
// hallucinated or stale id is nulled out rather than thrown, since a session's template_id is one
// optional field, not the whole point of the write.
function coerceTemplateId(
  raw: string | null | undefined,
  validTemplateIds: ReadonlySet<string>,
  actionLabel: string,
  traceId: string,
): string | null {
  const templateId = raw?.trim() || null;
  if (templateId && !validTemplateIds.has(templateId)) {
    console.warn(
      `[coach-chat] ${actionLabel}: template_id "${templateId}" not in this athlete's templates - nulling it out`,
      { traceId },
    );
    return null;
  }
  return templateId;
}

/**
 * Commit-boundary gate: same fail rule as `validate-current-week` — parseCurrentWeek
 * must accept the file, and availability must not be "invalid". Throws so a bad
 * payload cannot be handed to commitFilesAtomic.
 *
 * Hosted appliers stamp `updated_by: "model"`. The CLI `--coach-write` extra
 * (`updated_by` must be `"coach"`) is the BYOB/Claude-Code author check and is
 * not applied here — changing hosted stamps would reject every legitimate save.
 */
export function assertCurrentWeekCommitReady(content: string, now = new Date()): string {
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `current_week.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const runtime = parseCurrentWeek(input, now);
  if (runtime.issues.length > 0 || runtime.availability.status === "invalid" || !runtime.data) {
    const detail =
      runtime.issues.length > 0 ? runtime.issues.join("; ") : runtime.availability.reason;
    throw new Error(`current_week.json failed validation: ${detail}`);
  }
  return content;
}

// engine/lib/current-week.mts doesn't export its own date helpers (addDays/getIsoWeekId are
// private to the validator) - small local copies, same logic, so this file stays self-contained
// rather than reaching into another module's internals.
function isRealDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getIsoWeekId(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// The small shape Gemini reports for week_update - see coachReplySchema.ts's GeminiReply. One
// entry per session that changed; omitting session_id creates a new planned session on that day,
// same as week_plan's old per-day sessions array did. move_to_date relocates an existing session
// to a different day in the same week - the missing piece the old three-action split never had a
// field for (ADR 0042's finding 3): a move used to need two separate action-field entries.
export interface WeekUpdateSessionPatch {
  session_id?: string | null;
  discipline?: string;
  kind?: string;
  title?: string;
  priority?: CurrentWeekSessionPriority | null;
  planned_duration_min?: number | null;
  template_id?: string | null;
  status?: "done" | "skipped";
  activity_ids?: string[];
  move_to_date?: string | null;
}

export interface WeekUpdateDay {
  date: string;
  intent?: string | null;
  sessions?: WeekUpdateSessionPatch[];
}

export interface WeekUpdate {
  focus?: string | null;
  guardrails?: string[];
  headline?: string;
  body?: string;
  days: WeekUpdateDay[];
}

// Default priority for a planned session Gemini left blank. parseCurrentWeek requires a
// non-null priority on every "planned"-origin session (week_update never writes "unplanned" -
// those only ever come from a real completed-but-not-planned workout, which isn't this action
// field's job) - "support" is the safest default: not "anchor" (which would overstate a session
// Gemini didn't clearly prioritize) and not "optional" (which would understate a real planned one).
const DEFAULT_SESSION_PRIORITY: CurrentWeekSessionPriority = "support";

// Two independent, OR'd signals - neither alone is reliable on its own:
// - headline/body present: the JSON schema only requires `days`, so a genuine kickoff CAN arrive
//   missing both (Gemini isn't schema-forced to include them) - relying on this alone would
//   misroute that case into patch mode, where applyWeekPatch looks up the kickoff's brand-new
//   dates against the CURRENT (old) week's days, finds none, and throws a confusing "no day X in
//   the current week" instead of the direct "headline and body are required" a kickoff gives.
// - exactly 7 days: catches that missing-headline case. Checked alone (no day-count-only check),
//   a malformed kickoff that DOES carry headline/body but has the wrong day count would
//   otherwise misroute to patch mode too, masking ITS specific validation error the same way.
// Either signal alone routes to applyFullWeekKickoff, which does the real validation (headline/
// body required, exactly 7 days, Monday-start, consecutive) and throws its own specific reason.
// A patch legitimately hitting all seven days in one turn is a rare, acceptable false positive -
// it just gets an clear "headline and body are required" thrown instead of silently misapplied.
// Also used by buildCurrentWeekWrite (weekWrite.ts) to decide whether to fetch the existing file
// at all - a kickoff builds fresh.
export function isFullWeekKickoff(update: WeekUpdate | undefined): boolean {
  if (!update) return false;
  if (update.headline != null || update.body != null) return true;
  return Array.isArray(update.days) && update.days.length === 7;
}

/**
 * Applies a full-week-kickoff week_update: builds the full seven-day CurrentWeek object from
 * Gemini's day/session shape, server-computing every bookkeeping field (week id/bounds, session
 * ids, origin/status/session_file, data_status, coach_read's valid_from/valid_until, updated_at/
 * by/trace_id) per gemini-flow.md's Action-field design rule. Validates the result with
 * parseCurrentWeek before returning - never commit something the strict validator would reject.
 *
 * Judgment calls (documented per the task's instruction, not silent):
 * - `template_id` is nulled out with a console.warn on a hallucinated id rather than thrown - one
 *   optional field on one session inside a seven-day plan, not the whole point of the write, and
 *   the contract confirms template_id is genuinely nullable (a session with no template, e.g. a
 *   badminton match, is valid). Lenient here, strict everywhere else in this pipeline, because the
 *   failure mode this session belongs to is different in kind.
 * - `data_status` is always written "live" - "draft" was dropped from the enum entirely (ADR
 *   0042). It was structurally unreachable: by the time Gemini reports a kickoff the conversation
 *   already happened, and there was never a second "confirm" turn to leave a week parked in.
 * - `updated_by` is "model" (matches _meta.updated_by across every other Gemini-driven applier in
 *   this pipeline - coachIntents.ts, coachWorkoutFiles.ts), not the contract doc's own example
 *   value "coach" (which describes a human/Claude-Code hand-write, the old path this replaces).
 */
function applyFullWeekKickoff(
  update: WeekUpdate,
  validTemplateIds: ReadonlySet<string>,
  timezone: string,
  traceId: string,
  now: Date,
): string {
  if (update.days.length !== 7) {
    throw new Error(
      `week_update: expected exactly 7 days for a kickoff, got ${update.days.length}`,
    );
  }
  const headline = update.headline?.trim();
  const body = update.body?.trim();
  if (!headline || !body) {
    throw new Error("week_update: headline and body are required for a kickoff");
  }

  for (const day of update.days) {
    if (!isRealDateString(day.date)) {
      throw new Error(`week_update: day date "${day.date}" is not a real YYYY-MM-DD date`);
    }
  }
  const startDate = update.days[0].date;
  if (new Date(`${startDate}T00:00:00Z`).getUTCDay() !== 1) {
    throw new Error(`week_update: first day (${startDate}) must be a Monday`);
  }
  update.days.forEach((day, i) => {
    const expected = addDays(startDate, i);
    if (day.date !== expected) {
      throw new Error(
        `week_update: day[${i}].date is "${day.date}", expected "${expected}" (days must be consecutive from Monday)`,
      );
    }
  });
  const endDate = addDays(startDate, 6);

  const days: CurrentWeekDay[] = update.days.map((day) => {
    const sessions: CurrentWeekSession[] = (day.sessions ?? []).map((session, sessIdx) => {
      if (!session.discipline || !session.kind || !session.title) {
        throw new Error(
          `week_update: kickoff session on "${day.date}" needs discipline, kind, and title`,
        );
      }
      const duration =
        typeof session.planned_duration_min === "number" &&
        Number.isInteger(session.planned_duration_min) &&
        session.planned_duration_min > 0
          ? session.planned_duration_min
          : null;
      const result: CurrentWeekSession = {
        id: `sess_${day.date.replace(/-/g, "")}_${sessIdx + 1}`,
        origin: "planned",
        discipline: coerceDiscipline(session.discipline, traceId),
        kind: session.kind,
        title: session.title,
        priority: session.priority ?? DEFAULT_SESSION_PRIORITY,
        status: "planned",
        planned_duration_min: duration,
        template_id: coerceTemplateId(
          session.template_id ?? undefined,
          validTemplateIds,
          "week_update",
          traceId,
        ),
        session_file: null,
        coach_note: null,
        original_date: null,
        completion_activity_ids: [],
      };
      return result;
    });
    return {
      date: day.date,
      intent: day.intent?.trim() || null,
      coach_note: null,
      sessions,
    };
  });

  const today = todayDateString(timezone, now);
  const result: CurrentWeek = {
    schema_version: 1,
    data_status: "live",
    timezone,
    week: {
      id: getIsoWeekId(startDate),
      start_date: startDate,
      end_date: endDate,
      focus: update.focus?.trim() || null,
      guardrails: update.guardrails ?? [],
    },
    coach_read: {
      headline,
      body,
      // A coach_read can start partway through the week (current-week.mts's own comment on
      // CoachRead) - valid_from is today, not the week's start_date, so a mid-week kickoff never
      // back-dates its own commentary.
      valid_from: today,
      valid_until: endDate,
    },
    days,
    updated_at: now.toISOString(),
    updated_by: "model",
    trace_id: traceId,
  };

  const parsed = parseCurrentWeek(result, now);
  if (!parsed.data) {
    throw new Error(
      `week_update: kickoff result failed current_week.json validation: ${parsed.issues.join("; ")}`,
    );
  }
  return JSON.stringify(result, null, 2);
}

// week_update (patch mode) loads an existing current_week.json and walks current.days/
// day.sessions before it's run through parseCurrentWeek - a malformed file (days missing, not an
// array, or a day with a non-array sessions field) would otherwise crash inside .forEach() with a
// raw "Cannot read properties of undefined" instead of a message that says what's wrong. Same
// discipline as the other guards in this file: throw a descriptive Error, don't let a bad file
// surface a native TypeError.
function assertValidCurrentWeekShape(current: CurrentWeek): void {
  if (!Array.isArray(current.days)) {
    throw new Error("week_update: current_week.json is malformed (days is not an array)");
  }
  current.days.forEach((day, dayIndex) => {
    if (!Array.isArray(day?.sessions)) {
      throw new Error(
        `week_update: current_week.json is malformed (days[${dayIndex}].sessions is not an array)`,
      );
    }
  });
}

// completion_activity_ids must be source-qualified ("healthkit:<uuid>", "strava:<id>" - see
// current-week-contract.md). An id the athlete reports through chat (not synced automatically)
// has no real source to qualify it with, so this prefixes with "chat:" - a real, distinct source
// tag, not a placeholder - unless the id already carries its own qualifier (contains ":"), in
// which case it's passed through unchanged.
function qualifyActivityId(id: string): string {
  return id.includes(":") ? id : `chat:${id}`;
}

// Looked up fresh by id every time, rather than cached once from the pre-mutation array - a
// week_update patch can move a session between days in the same call (splicing it out of one
// day's array and pushing it into another's), which would invalidate a cached dayIndex/
// sessionIndex pair for anything after it in the same batch. The week is at most ~20 sessions, so
// a fresh scan per lookup costs nothing real.
function locateSession(
  days: CurrentWeekDay[],
  sessionId: string,
): { dayIndex: number; sessionIndex: number } | null {
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const sessionIndex = days[dayIndex].sessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex !== -1) return { dayIndex, sessionIndex };
  }
  return null;
}

/**
 * Applies a week_update patch to an existing week: per day (must already exist in the current
 * week), per session - a real session_id patches that session in place (status/completion,
 * content, template_id, priority, duration, or a move to a different day via move_to_date); no
 * session_id creates a new planned session on that day, same shape week_plan's per-day sessions
 * used to require. Every session_id and move_to_date target is checked to exist BEFORE any patch
 * is applied, so a batch with one bad reference fails the whole call rather than silently applying
 * a partial patch - same discipline applyQuestEvent's id guards use.
 *
 * A status change and a content change can land on the SAME entry (mark today's session done AND
 * record what actually happened, in one patch) - this is the collapse ADR 0042 asks for: the old
 * session_reconcile/plan_edit split needed two separate action-field entries for that.
 */
function applyWeekPatch(
  content: string | null,
  update: WeekUpdate,
  validTemplateIds: ReadonlySet<string>,
  traceId: string,
  now: Date,
): string {
  const current = parseJsonOrNull<CurrentWeek>(content);
  if (!current) {
    throw new Error("week_update: current_week.json could not be read");
  }
  assertValidCurrentWeekShape(current);

  const dayIndexByDate = new Map<string, number>();
  current.days.forEach((day, index) => dayIndexByDate.set(day.date, index));

  for (const day of update.days) {
    if (!dayIndexByDate.has(day.date)) {
      throw new Error(`week_update: no day "${day.date}" in the current week`);
    }
    for (const session of day.sessions ?? []) {
      if (session.session_id && !locateSession(current.days, session.session_id)) {
        throw new Error(
          `week_update: no session with id "${session.session_id}" in current_week.json`,
        );
      }
      if (session.move_to_date && !dayIndexByDate.has(session.move_to_date)) {
        throw new Error(
          `week_update: move_to_date "${session.move_to_date}" is not in the current week`,
        );
      }
      if (!session.session_id && (!session.discipline || !session.kind || !session.title)) {
        throw new Error(
          `week_update: a new session on "${day.date}" needs discipline, kind, and title`,
        );
      }
    }
  }

  const days: CurrentWeekDay[] = current.days.map((day) => ({
    ...day,
    sessions: day.sessions.map((s) => ({ ...s })),
  }));

  for (const patchDay of update.days) {
    const dayIndex = dayIndexByDate.get(patchDay.date)!;
    if (patchDay.intent !== undefined) {
      days[dayIndex] = { ...days[dayIndex], intent: patchDay.intent?.trim() || null };
    }

    for (const patch of patchDay.sessions ?? []) {
      if (!patch.session_id) {
        const newId = `sess_${patchDay.date.replace(/-/g, "")}_${days[dayIndex].sessions.length + 1}`;
        days[dayIndex].sessions.push({
          id: newId,
          origin: "planned",
          discipline: coerceDiscipline(patch.discipline!, traceId),
          kind: patch.kind!,
          title: patch.title!,
          priority: patch.priority ?? DEFAULT_SESSION_PRIORITY,
          status: "planned",
          planned_duration_min: patch.planned_duration_min ?? null,
          template_id: coerceTemplateId(
            patch.template_id ?? undefined,
            validTemplateIds,
            "week_update",
            traceId,
          ),
          session_file: null,
          coach_note: null,
          original_date: null,
          completion_activity_ids: [],
        });
        continue;
      }

      const loc = locateSession(days, patch.session_id)!;
      const session = days[loc.dayIndex].sessions[loc.sessionIndex];
      if (patch.status !== undefined) {
        session.status = patch.status;
        session.completion_activity_ids =
          patch.status === "done" ? (patch.activity_ids ?? []).map(qualifyActivityId) : [];
      }
      if (patch.discipline !== undefined)
        session.discipline = coerceDiscipline(patch.discipline, traceId);
      if (patch.kind !== undefined) session.kind = patch.kind;
      if (patch.title !== undefined) session.title = patch.title;
      if (patch.template_id !== undefined) {
        session.template_id = coerceTemplateId(
          patch.template_id,
          validTemplateIds,
          "week_update",
          traceId,
        );
      }
      if (patch.priority !== undefined) session.priority = patch.priority;
      if (patch.planned_duration_min !== undefined) {
        session.planned_duration_min = patch.planned_duration_min;
      }

      if (patch.move_to_date && patch.move_to_date !== days[loc.dayIndex].date) {
        const sourceDate = days[loc.dayIndex].date;
        days[loc.dayIndex].sessions.splice(loc.sessionIndex, 1);
        const targetIndex = dayIndexByDate.get(patch.move_to_date)!;
        days[targetIndex].sessions.push({ ...session, original_date: sourceDate });
      }
    }
  }

  const result: CurrentWeek = {
    ...current,
    days,
    updated_at: now.toISOString(),
    updated_by: "model",
    trace_id: traceId,
  };

  const parsed = parseCurrentWeek(result, now);
  if (!parsed.data) {
    throw new Error(
      `week_update: patch result failed current_week.json validation: ${parsed.issues.join("; ")}`,
    );
  }
  return JSON.stringify(result, null, 2);
}

/**
 * Applies a week_update action field - the single replacement for the old week_plan/
 * session_reconcile/plan_edit trio (ADR 0042). A full headline/body/7-day payload commits a fresh
 * week (isFullWeekKickoff); anything else patches the existing week named by `content`.
 */
export function applyWeekUpdate(
  content: string | null,
  update: WeekUpdate,
  validTemplateIds: ReadonlySet<string>,
  timezone: string,
  traceId: string,
  now: Date,
): string {
  if (isFullWeekKickoff(update)) {
    return applyFullWeekKickoff(update, validTemplateIds, timezone, traceId, now);
  }
  return applyWeekPatch(content, update, validTemplateIds, traceId, now);
}

// Same session_id set applyWeekPatch derives internally, but callable before it runs and
// non-throwing on a malformed file - coachTurn.ts uses this to validate week_update's session_ids
// up front (validateWeekUpdate in validateActions.ts), same "drop the one bad reference, don't let
// the whole atomic commit abort" discipline as validTemplateIdsFromManifest in
// coachWorkoutFiles.ts. A malformed or unreadable file just yields an empty set - every referenced
// session_id gets dropped as invalid, which is the right outcome either way.
export function validSessionIdsFromCurrentWeek(content: string | null): ReadonlySet<string> {
  const parsed = parseJsonOrNull<CurrentWeek>(content);
  if (!Array.isArray(parsed?.days)) return new Set();
  const ids = new Set<string>();
  for (const day of parsed.days) {
    if (!Array.isArray(day?.sessions)) continue;
    for (const session of day.sessions) {
      if (session?.id) ids.add(session.id);
    }
  }
  return ids;
}

/**
 * Same source file as validSessionIdsFromCurrentWeek above, but shaped for
 * coachPromptText.ts's activeWeekSessionsContext rather than for validation - the prompt needs a
 * session's date/title/status too so the model can match "tomorrow's session" to the right id,
 * not just know which ids are legal. Pulled out as its own function (coachTurn.ts§requestCoachReply,
 * Finding A fix) so an ordinary turn can supply this before asking Gemini, not just validate
 * against it after. A malformed or unreadable file yields an empty list, same defensive default as
 * validSessionIdsFromCurrentWeek.
 */
export function weekSessionsFromCurrentWeek(
  content: string | null,
): { id: string; date: string; title: string; status: string; discipline: string; kind: string }[] {
  const parsed = parseJsonOrNull<CurrentWeek>(content);
  if (!Array.isArray(parsed?.days)) return [];
  return parsed.days.flatMap((day) =>
    Array.isArray(day?.sessions)
      ? day.sessions
          .filter((session): session is CurrentWeekSession & { id: string } => Boolean(session?.id))
          .map((session) => ({
            id: session.id,
            date: day.date,
            title: session.title,
            status: session.status,
            // discipline/kind are what the Bug 3 content-diff guard (validateActions.ts) needs to
            // tell a category-changing week_update patch from a title tweak. This reader
            // deliberately skips parseCurrentWeek's schema validation (see this file's header
            // comment), so a session object here is only as trustworthy as the raw JSON - default
            // to "" rather than hand a caller `undefined` typed as `string`.
            discipline: session.discipline ?? "",
            kind: session.kind ?? "",
          }))
      : [],
  );
}

// Same source file and lenient-read discipline as weekSessionsFromCurrentWeek above, but for the
// week's own day dates rather than session content - validateWeekUpdate (validateActions.ts)
// needs every real day date to check a patch entry's `date`/`move_to_date` against, including
// days with zero sessions (an empty day is still a legal patch target). A malformed or
// unreadable file yields an empty list, same defensive default as the sibling readers in this
// file.
export function weekDayDatesFromCurrentWeek(content: string | null): string[] {
  const parsed = parseJsonOrNull<CurrentWeek>(content);
  if (!Array.isArray(parsed?.days)) return [];
  return parsed.days
    .map((day) => day?.date)
    .filter((date): date is string => typeof date === "string");
}
