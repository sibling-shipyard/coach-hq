/**
 * observability.ts — browser Sentry setup.
 *
 * Errors plus distributed tracing: `browserTracingIntegration` attaches `sentry-trace` and
 * `baggage` to outgoing requests that match `tracePropagationTargets`, so the API's Sentry events
 * land on the same trace as the browser's. Identity comes from `setAthleteUser`, called by
 * `AuthContext`; React render crashes come from `ErrorBoundary`'s `componentDidCatch`, data
 * fetches the client turns into an error screen come from `captureFetchFailure`, and failures
 * only the athlete can see come from `submitRageReport`, called by `RageReportDialog`.
 * Env: VITE_SENTRY_DSN (unset → no-op), optional VITE_SENTRY_RELEASE / VITE_SENTRY_ENVIRONMENT /
 * VITE_SENTRY_TRACES_SAMPLE_RATE. Release and environment are wired from Vercel at build time
 * by `ui/vite.config.ts`; a browser bundle has no other way to know which deploy it is.
 *
 * The browser SDK posts to Sentry's ingest host, so `connect-src` in `ui/vercel.json` has to
 * allow it — without that entry the CSP blocks every event and the SDK reports nothing.
 */
import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "../../../observability/sentryScrubber";

/**
 * Both values are baked in by `ui/vite.config.ts`, which resolves an explicit `VITE_SENTRY_*`
 * override, then Vercel's build-time `VERCEL_ENV` / `VERCEL_GIT_COMMIT_SHA` - see
 * `ui/observability/sentryBuildTags.ts`. The fallbacks below cover a build that never went
 * through that config, such as a unit test importing this module.
 */
export const clientRelease = import.meta.env.VITE_SENTRY_RELEASE || "development";

export const clientEnvironment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;

/**
 * Sample every trace. Right for four athletes; the runbook says to set the var explicitly before
 * that stops being true. An invalid value warns rather than falling back silently — Sentry
 * disables tracing for values outside 0...1 and says nothing.
 */
export const clientTracesSampleRate = ((raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`[sentry] VITE_SENTRY_TRACES_SAMPLE_RATE=${raw} must be from 0 to 1 - using 1`);
    return 1;
  }
  return parsed;
})(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE);

/**
 * Trace headers go to our own API and nowhere else. The client only ever calls same-origin
 * `/api/...` paths (`AuthContext.tsx`, `useRepoData.ts`, `useWidgetSnapshots.ts`,
 * `prefetchCoachContext.ts`, `WelcomeInviteCta.tsx`), and the browser SDK matches a relative
 * request against its resolved pathname, so this pattern covers all of them while keeping
 * `sentry-trace` off any third-party host we add later.
 */
const apiTracePropagationTargets = [/^\/api\//];

/**
 * Drop `console` breadcrumbs; keep every other kind.
 *
 * A breadcrumb trail is attached to whatever we capture next, and a Rage Report captures on
 * demand — so anything the app logs would ride along on a path ADR 0032 scoped to failed Gemini
 * calls only. The scrubber matches credentials, not chat text, so it is no help here.
 *
 * `ui.click`, `navigation`, `fetch` and `xhr` survive, and they are the trail worth having: they
 * are what the athlete did, not what we said about it.
 */
const RAGE_REPORT_TRAIL_CATEGORIES = new Set(["ui.click", "navigation", "fetch", "xhr"]);

function dropConsoleBreadcrumbs(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  return breadcrumb.category === "console" ? null : breadcrumb;
}

export function initClientMonitoring(): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: clientRelease,
    environment: clientEnvironment,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: clientTracesSampleRate,
    tracePropagationTargets: apiTracePropagationTargets,
    initialScope: { tags: { operation: "web" } },
    // ADR 0032: no automatic PII. Everything Sentry sees is added on purpose.
    sendDefaultPii: false,
    beforeBreadcrumb: dropConsoleBreadcrumbs,
    // `beforeSend` fires for error events only. Transactions and spans are separate payloads with
    // their own hooks, so all three are wired or ADR 0032's scrubbing rule holds for a third of
    // what we send. A browser span carries the request URL in `url.full`, which is exactly where
    // a credential in a query string would sit.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    beforeSendSpan: (span) => scrubSentryEvent(span),
  });
}

/**
 * Name the athlete on every browser event from here on, or clear them on sign-out.
 *
 * The id is the owner half of `owner/repo`, the same derivation the API
 * (`api/_lib/sentry.ts`) and iOS (`DiagnosticsManager.setAthlete`) use, so one athlete has one
 * `athlete_id` across all three. Not the GitHub login, which the API's iOS auth mode never sees.
 *
 * ADR 0032 keeps `sendDefaultPii: false`; this handle is the deliberate exception the LLD's tag
 * table already named. Nothing else about the person goes with it.
 *
 * Passing nothing clears both, mirroring iOS's `scope.setUser(nil)`. Web sign-out is a full
 * navigation to `/api/auth/logout`, so the SDK is torn down anyway — the clear is what covers a
 * session that expires under a live tab.
 */
export function setAthleteUser(repoFullName: string | null | undefined): void {
  const athleteId = repoFullName?.split("/")[0] || undefined;
  Sentry.setUser(athleteId ? { id: athleteId } : null);
  Sentry.setTag("athlete_id", athleteId);
}

/** Whether this build has an enabled Sentry client that can accept a Rage Report. */
export function isRageReportingAvailable(): boolean {
  return Sentry.isEnabled();
}

/**
 * The scope one Rage Report is sent under: the athlete's own report of a failure that never threw.
 *
 * `fingerprint` is the same string `RageReportSubmission.swift` sets, so web reports group
 * together the way iOS reports already do — each in its own project. `operation` overrides
 * the `web` set on `initialScope`, which is what the Rage Report alert rule matches on.
 */
const RAGE_REPORT_SCOPE = {
  fingerprint: ["rage_report"],
  tags: { operation: "rage_report", surface: "web" },
};

const TRAIL_DATA_KEYS = ["url", "method", "status_code", "statusCode", "from", "to"] as const;

export type RageReportTrailItem = {
  category?: string;
  message?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
};

function scopeBreadcrumbs(
  getScope: (() => { getScopeData?: () => { breadcrumbs?: Sentry.Breadcrumb[] } }) | undefined,
): Sentry.Breadcrumb[] {
  if (typeof getScope !== "function") return [];
  return getScope().getScopeData?.().breadcrumbs ?? [];
}

function compactTrailData(
  data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of TRAIL_DATA_KEYS) {
    if (data[key] !== undefined) out[key] = data[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The click / navigation / fetch trail at this moment. Snapshot when the dialog opens so the list
 * the athlete sees is the list that gets sent, not clicks inside the dialog. The allow-list lives
 * here so normal crash reports can keep other useful breadcrumb categories.
 */
export function snapshotRageReportTrail(): RageReportTrailItem[] {
  const seen = new Set<Sentry.Breadcrumb>();
  const merged: Sentry.Breadcrumb[] = [];
  for (const crumb of [
    ...scopeBreadcrumbs(Sentry.getIsolationScope),
    ...scopeBreadcrumbs(Sentry.getCurrentScope),
  ]) {
    if (seen.has(crumb) || !crumb.category || !RAGE_REPORT_TRAIL_CATEGORIES.has(crumb.category)) {
      continue;
    }
    seen.add(crumb);
    merged.push(crumb);
  }
  return merged.slice(-20).map((crumb) => ({
    category: crumb.category,
    message: crumb.message,
    timestamp: crumb.timestamp,
    data: compactTrailData(crumb.data as Record<string, unknown> | undefined),
  }));
}

/**
 * Send one Rage Report, or nothing at all.
 *
 * `captureMessage` sends `event.type:default` at `level:info` — not an error, which is why the
 * alert rule must carry no `event.type` filter (`docs/eng-docs/sentry-runbook.md` § Traps). The
 * SDK also staples its own breadcrumb list on; `extra.trail` is the same snapshot the dialog
 * showed, so the event still has it if that list is collapsed.
 *
 * Returns false and sends nothing on an empty box, which is the same outcome as Cancel: the
 * dialog never calls this on Cancel, and an empty submit is a cancel the athlete typed spaces
 * into.
 */
export function submitRageReport(
  message: string,
  trail: RageReportTrailItem[] = snapshotRageReportTrail(),
): boolean {
  const complaint = message.trim();
  if (!complaint || !isRageReportingAvailable()) return false;
  Sentry.captureMessage(complaint, { ...RAGE_REPORT_SCOPE, extra: { trail } });
  return true;
}

/**
 * How a data fetch failed, and the two cases are not the same failure.
 *
 * `network` is a rejected `fetch()`: the request never got an HTTP response at all — the athlete
 * is in a tunnel, the tab is offline, DNS died, or the connection dropped mid-body so reading it
 * threw. Nothing about it reaches the server, so it exists nowhere else; the API side of the
 * trace has no row to join.
 *
 * `server` is a response we did not want: the API answered, so `withSentryRoute` already has its
 * own half of the trace and `status` says what it decided. This side is here for what the athlete
 * saw, and to make the pair findable from one search.
 */
export type FetchFailure =
  | { kind: "network"; error: unknown }
  | { kind: "server"; status: number; detail?: string };

/** Whether the browser thinks it has a connection. Absent outside a browser, such as in tests. */
function browserIsOnline(): boolean | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.onLine;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Report a data fetch the client turned into UI state instead of throwing.
 *
 * Only for a failure the athlete is shown — a blank dashboard, a bounce to the login screen. A
 * fetch that degrades on purpose (the latency warmers in `prefetchCoachContext.ts` and
 * `useWidgetSnapshots.ts`) stays silent: the athlete never learns it happened, and neither
 * should the issue stream.
 *
 * `endpoint` is the literal path, never the request URL — a URL can carry a query string, and a
 * tag value is not scrubbed the way an event body is.
 *
 * The `fingerprint` is what makes these usable. Nothing uploads source maps
 * (`docs/eng-docs/sentry-runbook.md`), so the stack is minified and grouping on it would scatter
 * one broken endpoint across issues named after whichever bundle chunk it unwound through.
 * Grouping on endpoint + kind + status instead means one revoked token is one issue an operator
 * can resolve once, and a real outage is a count that climbs.
 *
 * `level` carries the triage call the fingerprint cannot: a network drop is the athlete's
 * connection and a refusal is ours to explain, so the first is a warning and the second an error.
 */
export function captureFetchFailure(endpoint: string, failure: FetchFailure): void {
  if (failure.kind === "network") {
    const online = browserIsOnline();
    Sentry.captureException(new Error(`${endpoint} never reached the server`), {
      level: "warning",
      fingerprint: ["fetch_failure", endpoint, "network"],
      tags: {
        fetch_endpoint: endpoint,
        fetch_failure: "network",
        // The tunnel test, and the reason it is a tag rather than only context: `online:false`
        // is the athlete's connection and `online:true` is a request that left the device and
        // died somewhere we own. One search separates them.
        ...(online === undefined ? {} : { online: String(online) }),
      },
      contexts: {
        fetch: {
          endpoint,
          failure: "network",
          reason: describeError(failure.error),
          online,
        },
      },
    });
    return;
  }

  Sentry.captureException(new Error(`${endpoint} answered ${failure.status}`), {
    level: "error",
    fingerprint: ["fetch_failure", endpoint, "server", String(failure.status)],
    tags: {
      fetch_endpoint: endpoint,
      fetch_failure: "server",
      status_code: String(failure.status),
    },
    contexts: {
      fetch: { endpoint, failure: "server", status: failure.status, detail: failure.detail },
    },
  });
}
