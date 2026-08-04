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
  plugins?: { enabled?: string[] };
  badminton_analytics_available?: boolean;
  // Optional - not every repo's build pipeline populates a coach-authored current-week
  // plan. Absent for a repo with no user_data/ledger/current_week.json.
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
  plugins: { enabled: ["badminton"] },
  badminton_analytics_available: true,
};

// Bump when the aggregate shape changes in a way old dashboards can't render
// safely. Kept in sync with build-data.mjs's SCHEMA_VERSION.
const SUPPORTED_SCHEMA_VERSION = 1;

export interface UseRepoDataResult {
  data: RepoData | null;
  loading: boolean;
  error: string | null;
  schemaUnsupported: boolean;
  // True when repo-file.ts's 401 - GitHub access was revoked/expired mid-session, not a
  // generic fetch failure. RepoDataGate.tsx shows a specific "sign in again" message + button
  // for this instead of the generic error state's Sign out button.
  accessRevoked: boolean;
}

let cachedData: RepoData | null = null;

function initialState(): UseRepoDataResult {
  if (import.meta.env.DEV) {
    return { data: LOCAL_DATA, loading: false, error: null, schemaUnsupported: false, accessRevoked: false };
  }
  if (cachedData) {
    return { data: cachedData, loading: false, error: null, schemaUnsupported: false, accessRevoked: false };
  }
  return { data: null, loading: true, error: null, schemaUnsupported: false, accessRevoked: false };
}

function fetchRepoData(setState: (state: UseRepoDataResult) => void): () => void {
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
          accessRevoked: res.status === 401,
        });
        return;
      }

      const aggregate = (await res.json()) as RepoData;
      if (
        typeof aggregate.schema_version === "number" &&
        aggregate.schema_version > SUPPORTED_SCHEMA_VERSION
      ) {
        setState({ data: null, loading: false, error: null, schemaUnsupported: true, accessRevoked: false });
        return;
      }

      cachedData = aggregate;
      setState({ data: aggregate, loading: false, error: null, schemaUnsupported: false, accessRevoked: false });
    })
    .catch(() => {
      if (!cancelled) {
        setState({
          data: null,
          loading: false,
          error: "Failed to load your data",
          schemaUnsupported: false,
          accessRevoked: false,
        });
      }
    });

  return () => {
    cancelled = true;
  };
}

export function useRepoData(): UseRepoDataResult {
  const [state, setState] = useState<UseRepoDataResult>(initialState);

  useEffect(() => {
    if (import.meta.env.DEV || cachedData) return;
    return fetchRepoData(setState);
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    // Bfcache (the browser's back/forward cache) can restore this whole page - including this
    // module's live cachedData - without a real reload or network request. repo-file.ts's
    // response is no-store specifically so a fresh fetch() can't be served stale cross-account
    // data, but bfcache bypasses fetch() entirely, so it's the one path that fix doesn't cover.
    // event.persisted === true means "restored from bfcache, not a fresh load" - force a real
    // refetch in that case rather than trusting whatever account's data happened to be cached
    // when the page was frozen.
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      cachedData = null;
      setState({ data: null, loading: true, error: null, schemaUnsupported: false, accessRevoked: false });
      fetchRepoData(setState);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return state;
}
