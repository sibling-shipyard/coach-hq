/**
 * useRepoData — loads the dashboard's data, from either source:
 *
 * - Local dev (import.meta.env.DEV): the golden dataset's generated repo-data
 *   (`shared/golden-dataset/repo-data/*.json`, produced fresh on every `npm run dev` by
 *   `generate-repo-data.mjs` — see `shared/golden-dataset/README.md`), synchronously. Not
 *   `ui/client/src/data/*` — those files are exclusively pipeline-managed (AGENTS.md) and
 *   reflect whatever real repo is configured, not a stable local fixture.
 * - Hosted deployment: fetches /api/repo-file once (the signed-in user's resolved
 *   repo's gen/aggregate.json), cached module-wide so navigating between pages
 *   doesn't refetch.
 *
 * Returned shape mirrors the old per-file static imports so each page only needs
 * to swap `const x = xData as Type` for `const x = data.x as Type` behind a
 * loading/error check - not a rewrite of page logic.
 */
import { useEffect, useState } from "react";
import activitiesData from "@golden/repo-data/activities.json";
import challengeDataRaw from "@golden/repo-data/challenge_v2.json";
import syncStatusData from "@golden/repo-data/sync_status.json";
import workoutsData from "@golden/repo-data/workouts.json";
import sleepLogRaw from "@golden/repo-data/sleep_log.json";
import questHistoryRaw from "@golden/repo-data/quest_history.json";
import currentWeekRaw from "@golden/repo-data/current_week.json";

export interface RepoData {
  activities: unknown[];
  challenge_v2: unknown;
  workouts: unknown;
  sync_status: unknown;
  sleep_log: unknown[];
  quest_history: unknown;
  // Optional - not every repo's build pipeline populates a coach-authored current-week
  // plan. Absent for a repo with no training/ledger/current_week.json.
  current_week?: unknown;
  schema_version?: number;
}

const LOCAL_DATA: RepoData = {
  activities: activitiesData as unknown[],
  challenge_v2: challengeDataRaw,
  workouts: workoutsData,
  sync_status: syncStatusData,
  sleep_log: sleepLogRaw as unknown[],
  quest_history: questHistoryRaw,
  current_week: currentWeekRaw,
};

// Bump when the aggregate shape changes in a way old dashboards can't render
// safely. Kept in sync with build-data.mjs's SCHEMA_VERSION.
const SUPPORTED_SCHEMA_VERSION = 1;

export interface UseRepoDataResult {
  data: RepoData | null;
  loading: boolean;
  error: string | null;
  schemaUnsupported: boolean;
}

let cachedData: RepoData | null = null;

function initialState(): UseRepoDataResult {
  if (import.meta.env.DEV) {
    return { data: LOCAL_DATA, loading: false, error: null, schemaUnsupported: false };
  }
  if (cachedData) {
    return { data: cachedData, loading: false, error: null, schemaUnsupported: false };
  }
  return { data: null, loading: true, error: null, schemaUnsupported: false };
}

export function useRepoData(): UseRepoDataResult {
  const [state, setState] = useState<UseRepoDataResult>(initialState);

  useEffect(() => {
    if (import.meta.env.DEV || cachedData) return;

    let cancelled = false;

    fetch("/api/repo-file")
      .then(async (res) => {
        if (cancelled) return;

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({
            data: null,
            loading: false,
            error: body.error ?? "Failed to load your data",
            schemaUnsupported: false,
          });
          return;
        }

        const aggregate = (await res.json()) as RepoData;
        if (
          typeof aggregate.schema_version === "number" &&
          aggregate.schema_version > SUPPORTED_SCHEMA_VERSION
        ) {
          setState({ data: null, loading: false, error: null, schemaUnsupported: true });
          return;
        }

        cachedData = aggregate;
        setState({ data: aggregate, loading: false, error: null, schemaUnsupported: false });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ data: null, loading: false, error: "Failed to load your data", schemaUnsupported: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
