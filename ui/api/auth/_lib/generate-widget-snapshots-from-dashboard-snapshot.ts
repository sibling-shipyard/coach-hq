/**
 * Run Warm Instrument snapshot models against a repo aggregate bundle (ADR 0005).
 * Used by /api/widget-snapshots — models stay in HQ, athlete repos hold data only.
 */
import type { Activity } from "../../../client/src/lib/activities.js";
import type { CurrentWeekContract } from "../../../client/src/components/home-warm/currentWeek.fixture.js";
import { buildLiveWeekContract } from "../../../client/src/components/home-warm/liveWeekContract.js";
import { buildWidgetSnapshotsFile } from "../../../client/src/components/home-warm/warmHomeSnapshots.js";
import type { SyncStatusPayload } from "../../../client/src/components/home-warm/warmHomeModel.js";
import type {
  CoachMessageSnapshot,
  WidgetSnapshotsFile,
} from "../../../client/src/components/home-warm/snapshots.js";
import type {
  ProgressJson,
  QuestsJson,
  SeasonsJson,
} from "../../coach-chat/_lib/decide/coachQuestFiles.js";

export interface DashboardSnapshotInput {
  activities?: Activity[];
  ledger?: {
    seasons: SeasonsJson;
    quests: QuestsJson;
    progress: ProgressJson;
    progressions: unknown;
  } | null;
  current_week?: CurrentWeekContract | { data_status?: string };
  sync_status?: SyncStatusPayload;
}

interface LatestCoachMessageFile {
  schema_version: 1;
  message: {
    id: string;
    created_at: string;
    activity_ids: string[];
    body: string;
    conversation_seed_id: string;
  };
}

const HEALTHKIT_ACTIVITY_ID =
  /^healthkit:[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const STRAVA_ACTIVITY_ID = /^strava:[0-9]{1,32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isLatestCoachMessageFile(value: unknown): value is LatestCoachMessageFile {
  if (!isRecord(value) || !hasExactKeys(value, ["message", "schema_version"])) return false;
  if (value.schema_version !== 1 || value.message === null || !isRecord(value.message))
    return false;
  const message = value.message;
  if (!hasExactKeys(message, ["activity_ids", "body", "conversation_seed_id", "created_at", "id"]))
    return false;
  if (
    typeof message.id !== "string" ||
    !/^cm-[A-Za-z0-9-]{1,160}$/.test(message.id) ||
    typeof message.created_at !== "string" ||
    !Number.isFinite(Date.parse(message.created_at)) ||
    typeof message.body !== "string" ||
    message.body.trim().length === 0 ||
    message.body.length > 360 ||
    message.conversation_seed_id !== `local-proactive-${message.id}` ||
    !Array.isArray(message.activity_ids) ||
    message.activity_ids.length === 0 ||
    message.activity_ids.length > 20
  )
    return false;
  const activityIds = message.activity_ids;
  if (
    activityIds.some(
      (id) =>
        typeof id !== "string" ||
        id.length > 80 ||
        (!HEALTHKIT_ACTIVITY_ID.test(id) && !STRAVA_ACTIVITY_ID.test(id)),
    ) ||
    activityIds.some((id, index) => index > 0 && id <= activityIds[index - 1])
  )
    return false;
  return true;
}

export function projectLatestCoachMessage(value: unknown): CoachMessageSnapshot | undefined {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!isLatestCoachMessageFile(parsed)) return undefined;
  return {
    id: parsed.message.id,
    created_at: parsed.message.created_at,
    body: parsed.message.body,
    conversation_seed_id: parsed.message.conversation_seed_id,
  };
}

// Same "local calendar day" format buildLiveWeekContract itself uses for start_date/end_date
// (see liveWeekContract.ts's localDateKey) - comparing today against a stored week's range only
// makes sense if both sides are formatted the same way.
function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// A "placeholder" week is the real value the ledger ships when the coach planned a week - it's
// only stale, not inherently wrong, so we only force a live recompute when its stored
// start_date/end_date no longer brackets today. A currently-accurate placeholder is left as-is.
//
// This layer's own type contract has already proven unreliable at runtime once - the real
// coach-skanda ledger shipped `coach_read: null` despite CurrentWeekContract declaring it
// required (see PR #240's null-guard). So treat `week.week.start_date`/`end_date` the same way:
// don't trust the cast, check the shape. A malformed placeholder is itself a reason to recompute
// live, not a reason to throw and 500 all of Home.
function isPlaceholderWeekStale(week: {
  week?: { start_date?: unknown; end_date?: unknown };
}): boolean {
  const startDate = week.week?.start_date;
  const endDate = week.week?.end_date;
  if (typeof startDate !== "string" || typeof endDate !== "string") return true;
  const today = localDateKey(new Date());
  return today < startDate || today > endDate;
}

export function needsLiveRecomputation(week: DashboardSnapshotInput["current_week"]): boolean {
  if (!week || week.data_status === "unavailable") return true;
  if (week.data_status === "placeholder") {
    return isPlaceholderWeekStale(week as { week?: { start_date?: unknown; end_date?: unknown } });
  }
  return false;
}

export function generateWidgetSnapshotsFromDashboardSnapshot(
  aggregate: DashboardSnapshotInput,
  latestCoachMessageFile?: unknown,
): WidgetSnapshotsFile | null {
  const ledger = aggregate.ledger;
  if (!ledger) return null;

  const activities = aggregate.activities ?? [];
  const syncStatus: SyncStatusPayload = aggregate.sync_status ?? {
    status: "none",
    timestamp: null,
    warnings: [],
  };

  const contract = needsLiveRecomputation(aggregate.current_week)
    ? buildLiveWeekContract(activities)
    : (aggregate.current_week as CurrentWeekContract);

  return buildWidgetSnapshotsFile(
    activities,
    ledger as any,
    syncStatus,
    contract,
    "live",
    projectLatestCoachMessage(latestCoachMessageFile),
  );
}
