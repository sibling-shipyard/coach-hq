/**
 * observability.ts — browser Sentry setup.
 *
 * Errors plus distributed tracing: `browserTracingIntegration` attaches `sentry-trace` and
 * `baggage` to outgoing requests that match `tracePropagationTargets`, so the API's Sentry events
 * land on the same trace as the browser's. Identity comes from `setAthleteUser`, called by
 * `AuthContext`; React render crashes come from `ErrorBoundary`'s `componentDidCatch`, and
 * failures that never threw come from `submitRageReport`, called by `RageReportDialog`.
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
