import {
  activityMatches,
  candidateFile,
  isObject,
  requestedIdParts,
  type ActivityFileEntry,
} from "../../_lib/activityLookup.js";
import {
  parseCurrentWeek,
  type CurrentWeek,
} from "../../coach-chat/_lib/_generated/current-week.bundle.js";
import {
  CoachMessageError,
  finiteNumber,
  isValidConversationSeedId,
  parseJson,
  stringValue,
  validateActivityIdsPayload,
  validateGeneratedBody,
  valuesEqual,
} from "./activityRequest.js";
import type { CoachMessageDependencies } from "./coachMessage.js";

export interface LatestCoachMessage {
  id: string;
  created_at: string;
  activity_ids: string[];
  body: string;
  conversation_seed_id: string;
}

export interface LatestCoachMessageFile {
  schema_version: 1;
  message: LatestCoachMessage | null;
}

export interface ProactiveContext {
  activity_batch: Array<{
    activity_id: string;
    activity: Record<string, unknown>;
    heart_rate_summary?: Record<string, unknown>;
  }>;
  athlete: Record<string, unknown>;
  athlete_insights: Record<string, unknown> | null;
  current_live_week: CurrentWeek | null;
  active_injuries: Array<Record<string, unknown>>;
  recent_coach_continuity: Array<Record<string, unknown>>;
  previous_proactive_message: Pick<LatestCoachMessage, "created_at" | "body"> | null;
}

function parseLatestMessage(value: unknown): LatestCoachMessage | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = ["activity_ids", "body", "conversation_seed_id", "created_at", "id"];
  if (!valuesEqual(keys, expected)) return null;
  const id = stringValue(value.id, 120);
  const createdAt = stringValue(value.created_at, 40);
  const seedId = stringValue(value.conversation_seed_id, 180);
  if (
    !id ||
    !createdAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    !seedId ||
    !isValidConversationSeedId(seedId, id)
  ) {
    return null;
  }
  let activityIds: string[];
  let body: string;
  try {
    activityIds = validateActivityIdsPayload({
      activity_ids: value.activity_ids,
    });
    body = validateGeneratedBody(value.body);
  } catch {
    return null;
  }
  return {
    id,
    created_at: createdAt,
    activity_ids: activityIds,
    body,
    conversation_seed_id: seedId,
  };
}

export function parseLatestMessageFile(raw: string | null): LatestCoachMessageFile {
  if (raw == null) return { schema_version: 1, message: null };
  const value = parseJson(raw);
  if (!isObject(value) || value.schema_version !== 1 || !("message" in value)) {
    throw new CoachMessageError("latest_message.json is malformed", 500);
  }
  if (value.message === null) return { schema_version: 1, message: null };
  const message = parseLatestMessage(value.message);
  if (!message) {
    throw new CoachMessageError("latest_message.json contains an invalid message", 500);
  }
  return { schema_version: 1, message };
}

function projectHrZones(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  const projected: Record<string, unknown> = {};
  for (const zoneName of ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]) {
    const zone = value[zoneName];
    if (!isObject(zone)) continue;
    const seconds = finiteNumber(zone.seconds);
    if (seconds == null) continue;
    projected[zoneName] = {
      low: finiteNumber(zone.low),
      high: finiteNumber(zone.high),
      seconds,
    };
  }
  return Object.keys(projected).length > 0 ? projected : null;
}

function projectActivity(value: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of [
    "name",
    "category",
    "sport_type",
    "start_date_local",
    "device_name",
    "source",
    "source_app",
  ]) {
    const text = stringValue(value[key], 300);
    if (text != null) projected[key] = text;
  }
  for (const key of [
    "elapsed_time",
    "moving_time",
    "calories",
    "distance",
    "total_elevation_gain",
    "average_heartrate",
    "max_heartrate",
    "average_speed",
    "max_speed",
  ]) {
    const number = finiteNumber(value[key]);
    if (number != null) projected[key] = number;
  }
  if (typeof value.has_heartrate === "boolean") {
    projected.has_heartrate = value.has_heartrate;
  }
  const description = stringValue(value.description);
  if (description != null) projected.description = description;
  const hrZones = projectHrZones(value.hr_zones);
  if (hrZones) projected.hr_zones = hrZones;
  if (isObject(value.vs_usual)) {
    const vsUsual: Record<string, number> = {};
    for (const key of ["duration_median_s", "avg_hr_median", "above_threshold_median_s"]) {
      const number = finiteNumber(value.vs_usual[key]);
      if (number != null) vsUsual[key] = number;
    }
    if (Object.keys(vsUsual).length > 0) projected.vs_usual = vsUsual;
  }
  if (isObject(value.pre_mental_state)) {
    const score = finiteNumber(value.pre_mental_state.score);
    const word = stringValue(value.pre_mental_state.word, 80);
    if (score != null || word != null) {
      projected.pre_mental_state = { score, word };
    }
  }
  return projected;
}

function projectHeartRateSummary(value: unknown): Record<string, unknown> | undefined {
  if (!isObject(value) || !Array.isArray(value.effort_shape)) return undefined;
  const effortShape = value.effort_shape
    .slice(0, 12)
    .filter(isObject)
    .map((block) => {
      const projected: Record<string, unknown> = {};
      for (const key of [
        "start_seconds",
        "end_seconds",
        "median_bpm",
        "p90_bpm",
        "covered_seconds",
      ]) {
        const number = finiteNumber(block[key]);
        if (number != null) projected[key] = number;
      }
      const zone = stringValue(block.dominant_zone, 40);
      if (zone) projected.dominant_zone = zone;
      return projected;
    })
    .filter((block) => Object.keys(block).length > 0);
  if (effortShape.length === 0) return undefined;
  const projected: Record<string, unknown> = { effort_shape: effortShape };
  for (const key of [
    "elapsed_seconds",
    "source_sample_count",
    "covered_seconds",
    "uncovered_seconds",
  ]) {
    const number = finiteNumber(value[key]);
    if (number != null) projected[key] = number;
  }
  return projected;
}

function projectInsights(value: unknown): Record<string, unknown> | null {
  if (!isObject(value) || !isObject(value.sports)) return null;
  const sports: Record<string, unknown> = {};
  for (const [sport, rawInsight] of Object.entries(value.sports)) {
    if (!sport.trim() || !isObject(rawInsight)) continue;
    const insight: Record<string, unknown> = {};
    for (const key of [
      "sessions_365d",
      "sessions_per_week_recent_4w",
      "sessions_per_week_prior_12w",
      "longest_gap_days_365d",
      "days_since_last_session",
    ]) {
      const number = finiteNumber(rawInsight[key]);
      if (number != null) insight[key] = number;
    }
    if (isObject(rawInsight.duration_buckets)) {
      const buckets: Record<string, number> = {};
      for (const key of ["under_30m", "30_to_60m", "60_to_120m", "over_120m"]) {
        const number = finiteNumber(rawInsight.duration_buckets[key]);
        if (number != null) buckets[key] = number;
      }
      if (Object.keys(buckets).length > 0) insight.duration_buckets = buckets;
    }
    if (Object.keys(insight).length > 0) sports[sport] = insight;
  }
  if (Object.keys(sports).length === 0) return null;
  return {
    generated_at: stringValue(value.generated_at, 40),
    window_days: finiteNumber(value.window_days),
    sports,
  };
}

function noteText(value: unknown): string | null {
  return isObject(value) ? stringValue(value.text, 800) : null;
}

function projectAthlete(profileValue: unknown, memoryValue: unknown): Record<string, unknown> {
  const profile = isObject(profileValue) ? profileValue : {};
  const memory = isObject(memoryValue) ? memoryValue : {};
  const notes = isObject(memory.notes) ? memory.notes : {};
  const sports = Array.isArray(memory.sports)
    ? memory.sports.flatMap((sport) => {
        const value = stringValue(sport, 120);
        return value ? [value] : [];
      })
    : [];
  return {
    name: stringValue(profile.name, 120),
    sports,
    coaching_priorities: noteText(notes.coaching_priorities),
    learned_patterns: {
      training: noteText(notes["learned_patterns.training"]),
      nutrition: noteText(notes["learned_patterns.nutrition"]),
      mental: noteText(notes["learned_patterns.mental"]),
    },
  };
}

function projectActiveInjuries(value: unknown): Array<Record<string, unknown>> {
  if (!isObject(value) || !Array.isArray(value.flags)) return [];
  return value.flags
    .filter((flag) => isObject(flag) && flag.status === "active")
    .map((flag) => ({
      id: stringValue(flag.id, 120),
      text: stringValue(flag.text, 500),
      opened_at: stringValue(flag.opened_at, 40),
    }));
}

function projectRecentContinuity(value: unknown): Array<Record<string, unknown>> {
  if (!isObject(value) || !Array.isArray(value.rows)) return [];
  return value.rows
    .slice(-5)
    .filter(isObject)
    .map((row) => ({
      date: stringValue(row.date, 20),
      text: stringValue(row.text, 600),
    }));
}

function parseCurrentLiveWeek(raw: string | null, now: Date): CurrentWeek | null {
  const value = parseJson(raw);
  if (value == null) return null;
  const parsed = parseCurrentWeek(value, now);
  return parsed.availability.available && parsed.data?.data_status === "live" ? parsed.data : null;
}

async function loadActivity(
  activityId: string,
  entries: ActivityFileEntry[],
  readFile: CoachMessageDependencies["readFile"],
): Promise<ProactiveContext["activity_batch"][number]> {
  const { source, localId } = requestedIdParts(activityId);
  const candidates = entries.filter((entry) => candidateFile(entry, localId));
  for (const entry of candidates) {
    const value = parseJson(await readFile(entry.path));
    if (!activityMatches(value, source, localId)) continue;
    const streamRaw =
      source === "healthkit"
        ? await readFile(`user_data/activities/streams/${localId}.json`)
        : null;
    const heartRateSummary = projectHeartRateSummary(parseJson(streamRaw));
    return {
      activity_id: activityId,
      activity: projectActivity(value),
      ...(heartRateSummary ? { heart_rate_summary: heartRateSummary } : {}),
    };
  }
  throw new CoachMessageError(`No authoritative activity found for ${activityId}`, 422);
}

export async function loadProactiveContext(
  activityIds: string[],
  deps: Pick<CoachMessageDependencies, "readFile" | "listActivityFiles">,
  now: Date,
  previousProactiveMessage: ProactiveContext["previous_proactive_message"] = null,
): Promise<ProactiveContext> {
  const [entries, profileRaw, memoryRaw, insightsRaw, weekRaw, injuriesRaw, coachLogRaw] =
    await Promise.all([
      deps.listActivityFiles(),
      deps.readFile("user_data/coach/profile.json"),
      deps.readFile("user_data/coach/memory.json"),
      deps.readFile("gen/athlete_insights.json"),
      deps.readFile("user_data/ledger/current_week.json"),
      deps.readFile("user_data/coach/injuries.json"),
      deps.readFile("user_data/coach/coach_log.json"),
    ]);
  const activityBatch = await Promise.all(
    activityIds.map((activityId) => loadActivity(activityId, entries, deps.readFile)),
  );
  return {
    activity_batch: activityBatch,
    athlete: projectAthlete(parseJson(profileRaw), parseJson(memoryRaw)),
    athlete_insights: projectInsights(parseJson(insightsRaw)),
    current_live_week: parseCurrentLiveWeek(weekRaw, now),
    active_injuries: projectActiveInjuries(parseJson(injuriesRaw)),
    recent_coach_continuity: projectRecentContinuity(parseJson(coachLogRaw)),
    previous_proactive_message: previousProactiveMessage,
  };
}
