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

/**
 * The scope one Rage Report is sent under: the athlete's own report of a failure that never threw.
 *
 * `fingerprint` is the same string `RageReportSubmission.swift` sets, so web and iOS reports land
 * in one Sentry issue instead of two; `surface` is what tells them apart inside it. `operation`
 * overrides the `web` set on `initialScope`, which is what the Rage Report alert rule matches on.
 */
const RAGE_REPORT_SCOPE = {
  fingerprint: ["rage_report"],
  tags: { operation: "rage_report", surface: "web" },
};

/**
 * Send one Rage Report, or nothing at all.
 *
 * `captureMessage` sends `event.type:default` at `level:info` — not an error, which is why the
 * alert rule must carry no `event.type` filter (`docs/eng-docs/sentry-runbook.md` § Traps). The
 * SDK staples the breadcrumb trail on, so the athlete needs to type only the complaint.
 *
 * Returns false and sends nothing on an empty box, which is the same outcome as Cancel: the
 * dialog never calls this on Cancel, and an empty submit is a cancel the athlete typed spaces
 * into.
 */
export function submitRageReport(message: string): boolean {
  const complaint = message.trim();
  if (!complaint) return false;
  Sentry.captureMessage(complaint, RAGE_REPORT_SCOPE);
  return true;
}
