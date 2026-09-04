/**
 * useRepoData — loads the dashboard's data, from either source:
 *
 * - Local dev (import.meta.env.DEV): the golden dataset's generated repo-data
 *   (`shared/golden-dataset/repo-data/*.json`, produced fresh on every `npm run dev` by
 *   `generate-repo-data.mjs` — see `shared/golden-dataset/README.md`), synchronously. Not
 *   `ui/client/src/data/*` — those files are exclusively pipeline-managed (AGENTS.md) and
 *   reflect whatever real repo is configured, not a stable local fixture.
 * - Hosted deployment: fetches /api/repo-file once (the signed-in user's resolved
 *   repo's gen/dashboard_snapshot.json), cached module-wide so navigating between pages
 *   doesn't refetch.
 *
 * Returned shape mirrors the old per-file static imports so each page only needs
 * to swap `const x = xData as Type` for `const x = data.x as Type` behind a
 * loading/error check - not a rewrite of page logic.
 */
import { useEffect, useRef, useState } from "react";
import dashboardSnapshotRaw from "../data/dashboard_snapshot.json";
import { captureFetchFailure } from "../lib/observability";
export interface RepoData {
  activities: unknown[];
  ledger?: any;
  workouts: unknown;
  sync_status: unknown;
  sleep_log: unknown[];
  quest_history: unknown;
  profile?: any;
  plugins?: { enabled?: string[] };
  badminton_analytics_available?: boolean;
  // Optional - not every repo's build pipeline populates a coach-authored current-week
  // plan. Absent for a repo with no user_data/ledger/current_week.json.
  current_week?: unknown;
  schema_version?: number;
}

const LOCAL_DATA = dashboardSnapshotRaw as RepoData;

// Bump when the dashboard snapshot shape changes in a way old dashboards can't render
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
    return {
      data: LOCAL_DATA,
      loading: false,
      error: null,
      schemaUnsupported: false,
      accessRevoked: false,
    };
  }
  if (cachedData) {
    return {
      data: cachedData,
      loading: false,
      error: null,
      schemaUnsupported: false,
      accessRevoked: false,
    };
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
        // A refusal never throws here — it becomes an error card, so nothing else in the client
        // records that the dashboard came up empty. The status is what separates a revoked
        // token (401, the athlete re-signs in) from a repo-file fault (502, ours to fix).
        captureFetchFailure("/api/repo-file", {
          kind: "server",
          status: res.status,
          detail: body.error,
        });
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
        setState({
          data: null,
          loading: false,
          error: null,
          schemaUnsupported: true,
          accessRevoked: false,
        });
        return;
      }

      cachedData = aggregate;
      setState({
        data: aggregate,
        loading: false,
        error: null,
        schemaUnsupported: false,
        accessRevoked: false,
      });
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      // Everything that lands here failed in transit: a rejected `fetch`, or a body that could
      // not be read because the connection dropped part-way through it. The API answered
      // nothing, so this event is the only record the dashboard went blank.
      captureFetchFailure("/api/repo-file", { kind: "network", error });
      setState({
        data: null,
        loading: false,
        error: "Failed to load your data",
        schemaUnsupported: false,
        accessRevoked: false,
      });
    });

  return () => {
    cancelled = true;
  };
}

export function useRepoData(): UseRepoDataResult {
  const [state, setState] = useState<UseRepoDataResult>(initialState);
  // Tracks the in-flight fetch's cancel closure across both effects below, so a pageshow-
  // triggered refetch cancels any still-pending request the same way the mount effect's own
  // cleanup does - not just discarded and left to resolve into a stale setState.
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV || cachedData) return;
    cancelRef.current = fetchRepoData(setState);
    return () => cancelRef.current?.();
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
      cancelRef.current?.();
      cachedData = null;
      setState({
        data: null,
        loading: true,
        error: null,
        schemaUnsupported: false,
        accessRevoked: false,
      });
      cancelRef.current = fetchRepoData(setState);
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      cancelRef.current?.();
    };
  }, []);

  return state;
}
