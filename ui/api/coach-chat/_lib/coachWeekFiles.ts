/**
 * coach-redesign workout-backend-wiring §5: current_week.json wiring. Two action fields -
 * week_plan (weekly kickoff, full rewrite) and session_reconcile (per-workout, upsert-by-id) -
 * following the same "Gemini reports a small fact, server owns every bookkeeping field" principle
 * as coachWorkoutFiles.ts/coachIntents.ts. Both appliers build a full CurrentWeek object and run
 * it through parseCurrentWeek before returning - never commit something the strict schema v1
 * validator would reject (engine/lib/current-week.mts).
 *
 * Field-length/enum rules (title <=96 chars, guardrails <=6 items, etc.) are NOT re-validated
 * here - parseCurrentWeek is the single source of truth for those, and a violation is exactly the
 * "fails loudly rather than committing" case the plan's testing section asks for. This file only
 * handles the bookkeeping parseCurrentWeek can't compute for itself (ids, dates, timestamps) plus
 * a couple of judgment calls documented inline below.
 */
import {
  parseCurrentWeek,
  type CurrentWeek,
  type CurrentWeekDay,
  type CurrentWeekSession,
  type CurrentWeekSessionPriority,
} from "./current-week.bundle.js";
import { parseJsonOrNull } from "./coachChatFiles.js";
import { todayDateString } from "./coachDay.js";

export const CURRENT_WEEK_PATH = "user_data/ledger/current_week.json";

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

// The small shape Gemini actually reports for week_plan - see coachReplySchema.ts's GeminiReply.
// headline/body are the coach_read content, kept in this one small schema per the plan's explicit
// "don't add a second Gemini call for this" instruction.
export interface WeekPlanSession {
  discipline: string;
  kind: string;
  title: string;
  priority?: CurrentWeekSessionPriority | null;
  planned_duration_min?: number | null;
  template_id?: string | null;
}

export interface WeekPlanDay {
  date: string;
  intent?: string | null;
  sessions: WeekPlanSession[];
}

export interface WeekPlan {
  focus?: string | null;
  guardrails?: string[];
  headline: string;
  body: string;
  days: WeekPlanDay[];
}

// Default priority for a planned session Gemini left blank. parseCurrentWeek requires a
// non-null priority on every "planned"-origin session (week_plan never writes "unplanned" - those
// only ever come from a real completed-but-not-planned workout, which isn't this action field's
// job) - "support" is the safest default: not "anchor" (which would overstate a session Gemini
// didn't clearly prioritize) and not "optional" (which would understate a real planned session).
const DEFAULT_SESSION_PRIORITY: CurrentWeekSessionPriority = "support";

/**
 * Applies a week_plan action field: builds the full seven-day CurrentWeek object from Gemini's
 * small day/session shape, server-computing every bookkeeping field (week id/bounds, session ids,
 * origin/status/session_file, data_status, coach_read's valid_from/valid_until, updated_at/by/
 * trace_id) per gemini-flow.md's Action-field design rule. Validates the result with
 * parseCurrentWeek before returning - never commit something the strict validator would reject.
 *
 * Judgment calls (documented per the task's instruction, not silent):
 * - `template_id` on a session is checked against the athlete's real, already-committed template
 *   ids (validTemplateIds, same manifest-based set template_edit/session_plan already use). Unlike
 *   those two appliers - which throw on a hallucinated id because the whole action is *about* one
 *   template and is meaningless without a real one - here template_id is one optional field on one
 *   session inside a seven-day plan. Throwing would block the entire week's commit over one bad
 *   reference in an otherwise-good plan, and the contract confirms template_id is genuinely
 *   nullable (a session with no template, e.g. a badminton match, is valid). So an unrecognized id
 *   is nulled out with a console.warn instead of thrown - lenient here, strict everywhere else in
 *   this pipeline, because the failure mode this session belongs to is different in kind.
 * - `data_status` is always written "live", never "draft". The contract's draft/live split exists
 *   for a multi-turn confirmation flow ("draft while facts are still being confirmed"), but
 *   week_plan is a single closing-turn action field, same shape as every other action field in this
 *   pipeline (coach_note, quest_event, ...) - by the time Gemini reports it, the kickoff
 *   conversation already happened and the plan reflects what was actually discussed and agreed.
 *   There's no second "confirm" turn built into this schema, and leaving weeks permanently stuck
 *   at "draft" would defeat the point of writing this file at all. If a genuine multi-turn
 *   draft-then-confirm flow is wanted later, that's a deliberate schema/prompt change, not a
 *   workaround here.
 * - `updated_by` is "model" (matches _meta.updated_by across every other Gemini-driven applier in
 *   this pipeline - coachIntents.ts, coachWorkoutFiles.ts), not the contract doc's own example
 *   value "coach" (which describes a human/Claude-Code hand-write, the old path this replaces).
 */
export function applyWeekPlan(
  plan: WeekPlan,
  validTemplateIds: ReadonlySet<string>,
  timezone: string,
  traceId: string,
  now: Date,
): string {
  if (!Array.isArray(plan.days) || plan.days.length !== 7) {
    throw new Error(`week_plan: expected exactly 7 days, got ${Array.isArray(plan.days) ? plan.days.length : "non-array"}`);
  }
  const headline = plan.headline?.trim();
  const body = plan.body?.trim();
  if (!headline || !body) {
    throw new Error("week_plan: headline and body are required");
  }

  for (const day of plan.days) {
    if (!isRealDateString(day.date)) {
      throw new Error(`week_plan: day date "${day.date}" is not a real YYYY-MM-DD date`);
    }
  }
  const startDate = plan.days[0].date;
  if (new Date(`${startDate}T00:00:00Z`).getUTCDay() !== 1) {
    throw new Error(`week_plan: first day (${startDate}) must be a Monday`);
  }
  plan.days.forEach((day, i) => {
    const expected = addDays(startDate, i);
    if (day.date !== expected) {
      throw new Error(`week_plan: day[${i}].date is "${day.date}", expected "${expected}" (days must be consecutive from Monday)`);
    }
  });
  const endDate = addDays(startDate, 6);

  const days: CurrentWeekDay[] = plan.days.map((day) => {
    const sessions: CurrentWeekSession[] = (day.sessions ?? []).map((session, sessIdx) => {
      let templateId = session.template_id?.trim() || null;
      if (templateId && !validTemplateIds.has(templateId)) {
        console.warn(`[coach-chat] week_plan: template_id "${templateId}" not in this athlete's templates - nulling it out`, { traceId });
        templateId = null;
      }
      const duration =
        typeof session.planned_duration_min === "number" && Number.isInteger(session.planned_duration_min) && session.planned_duration_min > 0
          ? session.planned_duration_min
          : null;
      const result: CurrentWeekSession = {
        id: `sess_${day.date.replace(/-/g, "")}_${sessIdx + 1}`,
        origin: "planned",
        discipline: session.discipline,
        kind: session.kind,
        title: session.title,
        priority: session.priority ?? DEFAULT_SESSION_PRIORITY,
        status: "planned",
        planned_duration_min: duration,
        // Contract + task instruction: planned_load is computed later from actual completions,
        // never estimated at plan-write time.
        planned_load: null,
        template_id: templateId,
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
      focus: plan.focus?.trim() || null,
      guardrails: plan.guardrails ?? [],
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
    // Dropped from the write path entirely per the plan's explicit go-ahead - Gemini never
    // populates it, always an empty array.
    coach_comments: [],
    updated_at: now.toISOString(),
    updated_by: "model",
    trace_id: traceId,
  };

  const parsed = parseCurrentWeek(result, now);
  if (!parsed.data) {
    throw new Error(`week_plan: result failed current_week.json validation: ${parsed.issues.join("; ")}`);
  }
  return JSON.stringify(result, null, 2);
}

// The small shape Gemini actually reports for session_reconcile - see coachReplySchema.ts's
// GeminiReply. Array, mirrors quest_event's upsert-by-id shape almost exactly. `actual` is new
// (per direction): only set when what really happened differs from what was planned (planned a
// run, actually played badminton) - the session's discipline/kind/title get overwritten to match
// reality, not just its status. template_id inside `actual` is validated against the athlete's
// real templates the same way template_edit/session_plan/week_plan already do, so a relabel onto
// a real structured workout stays timer-app-usable.
export interface SessionReconcileEvent {
  session_id: string;
  status: "done" | "skipped";
  activity_ids?: string[];
  actual?: { discipline: string; kind: string; title: string; template_id?: string };
}

// session_reconcile and plan_edit both load an existing current_week.json and walk current.days /
// day.sessions before they've run it through parseCurrentWeek - a malformed file (days missing,
// not an array, or a day with a non-array sessions field) would otherwise crash inside .forEach()
// with a raw "Cannot read properties of undefined" instead of a message that says what's wrong.
// Same discipline as the other guards in this file: throw a descriptive Error, don't let a bad
// file surface a native TypeError.
function assertValidCurrentWeekShape(actionName: string, current: CurrentWeek): void {
  if (!Array.isArray(current.days)) {
    throw new Error(`${actionName}: current_week.json is malformed (days is not an array)`);
  }
  current.days.forEach((day, dayIndex) => {
    if (!Array.isArray(day?.sessions)) {
      throw new Error(`${actionName}: current_week.json is malformed (days[${dayIndex}].sessions is not an array)`);
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

/**
 * Applies a session_reconcile action field: loads the current current_week.json, finds each
 * event's session by id across all 7 days (throws on a hallucinated/stale session_id - same
 * discipline as applyQuestEvent's flag_id/quest_id guards), patches status and
 * completion_activity_ids in place, leaves everything else untouched, re-stamps updated_at/
 * trace_id at the root. When `actual` is present, also overwrites discipline/kind/title (and
 * template_id, re-validated against validTemplateIds - never trust it unchecked) so a relabeled
 * session reflects what genuinely happened, not the stale original plan. Validates the result
 * with parseCurrentWeek before returning.
 *
 * All event session_ids are checked to exist BEFORE any patch is applied, so a batch with one bad
 * id fails the whole call rather than silently applying a partial patch.
 */
export function applySessionReconcile(
  content: string | null,
  events: SessionReconcileEvent[],
  validTemplateIds: ReadonlySet<string>,
  traceId: string,
  now: Date,
): string {
  const current = parseJsonOrNull<CurrentWeek>(content);
  if (!current) {
    throw new Error("session_reconcile: current_week.json could not be read");
  }
  assertValidCurrentWeekShape("session_reconcile", current);

  const sessionLocation = new Map<string, { dayIndex: number; sessionIndex: number }>();
  current.days.forEach((day, dayIndex) => {
    day.sessions.forEach((session, sessionIndex) => {
      sessionLocation.set(session.id, { dayIndex, sessionIndex });
    });
  });

  for (const event of events) {
    if (!sessionLocation.has(event.session_id)) {
      throw new Error(`session_reconcile: no session with id "${event.session_id}" in current_week.json`);
    }
  }

  const days = current.days.map((day) => ({ ...day, sessions: day.sessions.map((s) => ({ ...s })) }));
  for (const event of events) {
    const loc = sessionLocation.get(event.session_id)!;
    const session = days[loc.dayIndex].sessions[loc.sessionIndex];
    session.status = event.status;
    session.completion_activity_ids =
      event.status === "done" ? (event.activity_ids ?? []).map(qualifyActivityId) : [];
    if (event.actual) {
      session.discipline = event.actual.discipline;
      session.kind = event.actual.kind;
      session.title = event.actual.title;
      const actualTemplateId = event.actual.template_id?.trim();
      if (actualTemplateId && !validTemplateIds.has(actualTemplateId)) {
        console.warn(`[coach-chat] session_reconcile: actual.template_id "${actualTemplateId}" not in this athlete's templates - nulling it out`, { traceId });
        session.template_id = null;
      } else {
        session.template_id = actualTemplateId ?? null;
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
    throw new Error(`session_reconcile: result failed current_week.json validation: ${parsed.issues.join("; ")}`);
  }
  return JSON.stringify(result, null, 2);
}

// The small shape Gemini reports for plan_edit - see coachReplySchema.ts's GeminiReply. Edits an
// EXISTING future (or today's) session's planned content in place, without touching the rest of
// the week - the missing piece week_plan (full 7-day rewrite) and session_reconcile (status-only
// patch) didn't cover: "swap tomorrow's badminton for football." session_id must be real, from
// context (activeWeekSessionsContext), same guard as session_reconcile. Does not touch status -
// a plan_edit session stays whatever status it already was (normally "planned").
export interface PlanEditEvent {
  session_id: string;
  discipline: string;
  kind: string;
  title: string;
  template_id?: string;
}

/**
 * Applies a plan_edit action field: finds each event's session by id (throws on a
 * hallucinated/stale id, same discipline as session_reconcile), overwrites discipline/kind/title
 * (and template_id, validated against validTemplateIds) in place, leaves status and everything
 * else on that session untouched. Validates the result with parseCurrentWeek before returning.
 */
export function applyPlanEdit(
  content: string | null,
  events: PlanEditEvent[],
  validTemplateIds: ReadonlySet<string>,
  traceId: string,
  now: Date,
): string {
  const current = parseJsonOrNull<CurrentWeek>(content);
  if (!current) {
    throw new Error("plan_edit: current_week.json could not be read");
  }
  assertValidCurrentWeekShape("plan_edit", current);

  const sessionLocation = new Map<string, { dayIndex: number; sessionIndex: number }>();
  current.days.forEach((day, dayIndex) => {
    day.sessions.forEach((session, sessionIndex) => {
      sessionLocation.set(session.id, { dayIndex, sessionIndex });
    });
  });

  for (const event of events) {
    if (!sessionLocation.has(event.session_id)) {
      throw new Error(`plan_edit: no session with id "${event.session_id}" in current_week.json`);
    }
  }

  const days = current.days.map((day) => ({ ...day, sessions: day.sessions.map((s) => ({ ...s })) }));
  for (const event of events) {
    const loc = sessionLocation.get(event.session_id)!;
    const session = days[loc.dayIndex].sessions[loc.sessionIndex];
    session.discipline = event.discipline;
    session.kind = event.kind;
    session.title = event.title;
    const templateId = event.template_id?.trim();
    if (templateId && !validTemplateIds.has(templateId)) {
      console.warn(`[coach-chat] plan_edit: template_id "${templateId}" not in this athlete's templates - nulling it out`, { traceId });
      session.template_id = null;
    } else {
      session.template_id = templateId ?? null;
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
    throw new Error(`plan_edit: result failed current_week.json validation: ${parsed.issues.join("; ")}`);
  }
  return JSON.stringify(result, null, 2);
}
