/**
 * Run Warm Instrument snapshot models against a repo aggregate bundle (ADR 0005).
 * Used by /api/widget-snapshots — models stay in HQ, athlete repos hold data only.
 */
import type { ChallengeV2 } from "../../../client/src/lib/challenge.js";
import type { Activity } from "../../../client/src/lib/activities.js";
import type { CurrentWeekContract } from "../../../client/src/components/home-warm/currentWeek.fixture.js";
import { buildLiveWeekContract } from "../../../client/src/components/home-warm/liveWeekContract.js";
import { buildWidgetSnapshotsFile } from "../../../client/src/components/home-warm/warmHomeSnapshots.js";
import type { SyncStatusPayload } from "../../../client/src/components/home-warm/warmHomeModel.js";
import type { WidgetSnapshotsFile } from "../../../client/src/components/home-warm/snapshots.js";
import { splitLedgerAsChallenge } from "../../../client/src/lib/splitLedgerChallenge.js";
import type { ProgressJson, QuestsJson, SeasonsJson } from "../../coach-chat/_lib/coachQuestFiles.js";

export interface DashboardSnapshotInput {
  activities?: Activity[];
  challenge_v2?: ChallengeV2 | null;
  ledger?: { seasons: SeasonsJson; quests: QuestsJson; progress: ProgressJson; progressions: unknown } | null;
  current_week?: CurrentWeekContract | { data_status?: string };
  sync_status?: SyncStatusPayload;
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
function isPlaceholderWeekStale(week: { week?: { start_date?: unknown; end_date?: unknown } }): boolean {
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
): WidgetSnapshotsFile | null {
  const challenge = aggregate.ledger ? splitLedgerAsChallenge(aggregate.ledger) : aggregate.challenge_v2 ?? null;
  if (!challenge) return null;

  const activities = aggregate.activities ?? [];
  const syncStatus: SyncStatusPayload = aggregate.sync_status ?? {
    status: "none",
    timestamp: null,
    warnings: [],
  };

  const contract = needsLiveRecomputation(aggregate.current_week)
    ? buildLiveWeekContract(activities, challenge)
    : (aggregate.current_week as CurrentWeekContract);

  return buildWidgetSnapshotsFile(activities, challenge, syncStatus, contract, "live");
}

export { splitLedgerAsChallenge } from "../../../client/src/lib/splitLedgerChallenge.js";
