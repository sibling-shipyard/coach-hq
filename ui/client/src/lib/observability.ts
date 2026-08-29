/**
 * observability.ts — browser Sentry setup.
 *
 * Errors plus distributed tracing: `browserTracingIntegration` attaches `sentry-trace` and
 * `baggage` to outgoing requests that match `tracePropagationTargets`, so the API's Sentry events
 * land on the same trace as the browser's. No breadcrumb enrichment or error-boundary wiring yet.
 * Env: VITE_SENTRY_DSN (unset → no-op), optional VITE_SENTRY_RELEASE / VITE_SENTRY_ENVIRONMENT /
 * VITE_SENTRY_TRACES_SAMPLE_RATE.
 *
 * The browser SDK posts to Sentry's ingest host, so `connect-src` in `ui/vercel.json` has to
 * allow it — without that entry the CSP blocks every event and the SDK reports nothing.
 */
import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "../../../observability/sentryScrubber";

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
