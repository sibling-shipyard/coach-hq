/**
 * observability.ts — browser Sentry setup.
 *
 * Errors plus distributed tracing: `browserTracingIntegration` attaches `sentry-trace` and
 * `baggage` to outgoing requests that match `tracePropagationTargets`, so the API's Sentry events
 * land on the same trace as the browser's. Identity comes from `setAthleteUser`, called by
 * `AuthContext`; React render crashes come from `ErrorBoundary`'s `componentDidCatch`.
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
 * that stops being true. An unparseable value warns rather than falling back silently — Sentry
 * reads `NaN` as "tracing off" and says nothing.
 */
export const clientTracesSampleRate = ((raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[sentry] VITE_SENTRY_TRACES_SAMPLE_RATE=${raw} is not a number - using 1`);
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

export function initClientMonitoring(): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: clientRelease,
    environment: clientEnvironment,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: clientTracesSampleRate,
    tracePropagationTargets: apiTracePropagationTargets,
    // ADR 0032: no automatic PII. Everything Sentry sees is added on purpose.
    sendDefaultPii: false,
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
