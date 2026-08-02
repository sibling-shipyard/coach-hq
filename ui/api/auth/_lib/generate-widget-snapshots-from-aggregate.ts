/**
 * Run Warm Instrument snapshot models against a repo aggregate bundle (ADR 0005).
 * Used by /api/widget-snapshots — models stay in HQ, athlete repos hold data only.
 */
import type { ChallengeV2 } from "../../../client/src/lib/challenge.js";
import type { Activity } from "../../../client/src/lib/activities.js";
import type { CategoryConfigInput } from "../../../client/src/lib/categoryResolver.js";
import type { CurrentWeekContract } from "../../../client/src/components/home-warm/currentWeek.fixture.js";
import { buildLiveWeekContract } from "../../../client/src/components/home-warm/liveWeekContract.js";
import { buildWidgetSnapshotsFile } from "../../../client/src/components/home-warm/warmHomeSnapshots.js";
import type { SyncStatusPayload } from "../../../client/src/components/home-warm/warmHomeModel.js";
import type { WidgetSnapshotsFile } from "../../../client/src/components/home-warm/snapshots.js";

export interface RepoAggregateInput {
  activities?: Activity[];
  challenge_v2?: ChallengeV2 | null;
  current_week?: CurrentWeekContract | { data_status?: string };
  sync_status?: SyncStatusPayload;
  categories?: CategoryConfigInput;
}

function isUnavailableWeek(
  week: RepoAggregateInput["current_week"],
): week is { data_status: "unavailable" } | undefined {
  return !week || week.data_status === "unavailable";
}

import { setGlobalCategoryConfig, type CategoryConfigInput } from "../../../client/src/lib/categoryResolver.js";

export function generateWidgetSnapshotsFromAggregate(
  aggregate: RepoAggregateInput,
): WidgetSnapshotsFile | null {
  const challenge = aggregate.challenge_v2 ?? null;
  if (!challenge) return null;

  const activities = aggregate.activities ?? [];
  const syncStatus: SyncStatusPayload = aggregate.sync_status ?? {
    status: "none",
    timestamp: null,
    warnings: [],
  };
  const categories = aggregate.categories;
  if (categories) {
    setGlobalCategoryConfig(categories);
  }

  const contract = isUnavailableWeek(aggregate.current_week)
    ? buildLiveWeekContract(activities, challenge, categories)
    : (aggregate.current_week as CurrentWeekContract);

  return buildWidgetSnapshotsFile(activities, challenge, syncStatus, contract, "live", categories);
}
