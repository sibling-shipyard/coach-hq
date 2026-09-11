#!/usr/bin/env node
/**
 * reconcile-current-week.mjs — deterministic reconciliation, ADR 0042's near-term stack.
 *
 * Matches synced activities to this week's planned sessions without a model call: a match marks
 * a session done, a planned day that's passed with nothing logged marks it skipped, and anything
 * genuinely ambiguous gets flagged on the session's own coach_note for Coach to ask about next
 * chat turn - never silently guessed. An activity with no planned match attaches as a new
 * unplanned session. Only ever acts on a session still at status "planned" - a status chat
 * already set is never touched.
 *
 * Runs as a step in the sync workflow (sync.user.yml), after activities have already synced into
 * user_data/activities/hist/. Writes nothing unless the result passes parseCurrentWeek, same
 * discipline as every coach-chat applier (coachWeekFiles.ts).
 *
 * Usage:
 *   node engine/scripts/reconcile-current-week.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { histDir, ledgerDir, repoRoot } from "../lib/repo-layout.mjs";
import { projectActivity } from "../lib/projectActivity.mjs";
import { parseCurrentWeek } from "../lib/current-week.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRoot(__dirname);

// Narrower than ui/client/src/lib/activities.ts's getTrainingCategory - engine/ is carved
// standalone into athlete repos with no ui/ present, so this can't import from there. Only needs
// to resolve to CurrentWeekSessionDiscipline's flat set (engine/lib/current-week.mts), not the
// UI's finer badminton/strength sub-categories, so name-regexes collapse straight to the
// discipline instead of through an intermediate TrainingCategory. Keep in sync by hand if the UI
// classifier's rules change - same self-contained-duplicate pattern coachWeekFiles.ts already
// uses for its own small date helpers.
const NAME_DISCIPLINE_PATTERNS = [
  [/^Run\s*#/i, "run"],
  [/^Foundation\s*#/i, "foundation"],
  [/^Strength\s+(A|B)/i, "strength"],
  [/^Weight Training\s*#/i, "weight_training"],
  [/^Calisthenics\s*#/i, "calisthenics"],
  [/^Recovery\s*#/i, "recovery"],
  [/^Realign\s*#/i, "recovery"],
  [/^Badminton:/i, "badminton"],
  [/^Swim\s*#/i, "swim"],
  [/cricket/i, "cricket"],
];

const SPORT_TYPE_DISCIPLINE = {
  Badminton: "badminton",
  Hike: "hike",
  Walk: "walk",
  Swim: "swim",
  Soccer: "football",
  Workout: "workout",
  Ride: "cycling",
  EBikeRide: "cycling",
  Run: "run",
};

export function classifyDiscipline(activity) {
  const name = activity.name ?? "";
  for (const [pattern, discipline] of NAME_DISCIPLINE_PATTERNS) {
    if (pattern.test(name)) return discipline;
  }
  const sportType = activity.sport_type;
  if (sportType in SPORT_TYPE_DISCIPLINE) return SPORT_TYPE_DISCIPLINE[sportType];
  if (sportType === "WeightTraining") {
    return (activity.elapsed_time ?? 0) < 1800 ? "foundation" : "weight_training";
  }
  return "other";
}

export function qualifiedActivityId(activity) {
  return `healthkit:${activity.id}`;
}

function activityDate(activity) {
  return typeof activity.start_date_local === "string" ? activity.start_date_local.slice(0, 10) : null;
}

/**
 * Pure reconciliation: current_week.json's parsed data, this week's activities (already filtered
 * or not - dates outside the week's own days simply never match anything), and today's date
 * string (athlete's own timezone, matching todayDateString's en-CA formatting elsewhere in this
 * pipeline). Returns a new CurrentWeek object; never mutates the input.
 */
export function reconcileWeek(currentWeek, activities, todayDateStr) {
  const activitiesByDate = new Map();
  for (const activity of activities) {
    const date = activityDate(activity);
    if (!date) continue;
    if (!activitiesByDate.has(date)) activitiesByDate.set(date, []);
    activitiesByDate.get(date).push(activity);
  }

  // Seeded from every completion_activity_id already on the week, not just ones matched during
  // THIS call - a session already marked done on a prior run is skipped by the loop below
  // (status !== "planned"), so its activity would look unclaimed and get attached a second time
  // as a duplicate unplanned session on every subsequent run without this.
  const claimed = new Set(
    currentWeek.days.flatMap((day) => day.sessions.flatMap((s) => s.completion_activity_ids ?? [])),
  );

  // Session ids are unique across the WHOLE week, not just within a day (parseCurrentWeek checks
  // every id against one Set spanning all seven days) - a moved session keeps the id it was
  // minted with on its original day, so a later day can be legitimately empty while that id is
  // still "in use" elsewhere in the week. Seeding this from every real id up front, and checking
  // it on every new id this pass mints, is what catches that instead of relying on a plain
  // date+index guess that assumes a day's own session count is the only source of collisions.
  const usedIds = new Set(
    currentWeek.days.flatMap((day) => day.sessions.map((s) => s.id)),
  );
  function mintSessionId(date) {
    const base = `sess_${date.replace(/-/g, "")}`;
    let n = 1;
    let id = `${base}_${n}`;
    while (usedIds.has(id)) {
      n += 1;
      id = `${base}_${n}`;
    }
    usedIds.add(id);
    return id;
  }

  const days = currentWeek.days.map((day) => {
    const dayActivities = activitiesByDate.get(day.date) ?? [];
    const sessions = day.sessions.map((session) => {
      if (session.status !== "planned") return session;

      const candidates = dayActivities.filter(
        (a) => !claimed.has(qualifiedActivityId(a)) && classifyDiscipline(a) === session.discipline,
      );

      if (candidates.length === 1) {
        const id = qualifiedActivityId(candidates[0]);
        claimed.add(id);
        return { ...session, status: "done", completion_activity_ids: [id] };
      }
      if (candidates.length > 1) {
        // Claim every candidate, not just the session it's flagged against - otherwise the
        // unmatched-activity pass below still finds them unclaimed and attaches each one a
        // second time as its own new unplanned session, turning one flagged ambiguity into
        // three total sessions instead of one.
        for (const candidate of candidates) claimed.add(qualifiedActivityId(candidate));
        return {
          ...session,
          coach_note:
            "Ambiguous: multiple logged activities could match this session - ask which one before marking it.",
        };
      }
      if (day.date < todayDateStr) {
        return { ...session, status: "skipped" };
      }
      return session;
    });
    return { ...day, sessions };
  });

  for (const day of days) {
    const dayActivities = activitiesByDate.get(day.date) ?? [];
    const unmatched = dayActivities.filter((a) => !claimed.has(qualifiedActivityId(a)));
    for (const activity of unmatched) {
      const id = qualifiedActivityId(activity);
      day.sessions.push({
        id: mintSessionId(day.date),
        origin: "unplanned",
        discipline: classifyDiscipline(activity),
        kind: "logged",
        title: activity.name || "Logged activity",
        priority: null,
        status: "done",
        planned_duration_min: null,
        template_id: null,
        session_file: null,
        coach_note: null,
        original_date: null,
        completion_activity_ids: [id],
      });
      claimed.add(id);
    }
  }

  return { ...currentWeek, days };
}

function todayInTimeZone(timeZone, now) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

function loadActivities(repoRootPath) {
  const historyDir = histDir(repoRootPath);
  if (!fs.existsSync(historyDir)) return [];
  return fs
    .readdirSync(historyDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => projectActivity(JSON.parse(fs.readFileSync(path.join(historyDir, f), "utf-8"))));
}

export function main(repoRootPath = REPO_ROOT, now = new Date()) {
  const currentWeekPath = path.join(ledgerDir(repoRootPath), "current_week.json");
  if (!fs.existsSync(currentWeekPath)) {
    console.log("[reconcile] no current_week.json - nothing to reconcile");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(currentWeekPath, "utf-8"));
  const runtime = parseCurrentWeek(raw, now);
  if (!runtime.data) {
    console.log("[reconcile] current_week.json isn't schema-valid - leaving it untouched");
    return;
  }
  if (runtime.data.data_status !== "live") {
    console.log(`[reconcile] data_status is "${runtime.data.data_status}", not live - skipping`);
    return;
  }

  const activities = loadActivities(repoRootPath);
  const today = todayInTimeZone(runtime.data.timezone, now);
  const reconciled = reconcileWeek(runtime.data, activities, today);

  if (JSON.stringify(reconciled) === JSON.stringify(runtime.data)) {
    console.log("[reconcile] nothing changed");
    return;
  }

  const output = { ...reconciled, updated_at: now.toISOString(), updated_by: "reconciler" };
  const validated = parseCurrentWeek(output, now);
  if (!validated.data) {
    throw new Error(
      `reconcile-current-week: result failed validation, refusing to write: ${validated.issues.join("; ")}`,
    );
  }
  fs.writeFileSync(currentWeekPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`[reconcile] wrote ${path.relative(repoRootPath, currentWeekPath)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
