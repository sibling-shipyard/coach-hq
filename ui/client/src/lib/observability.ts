/**
 * observability.ts — browser Sentry setup.
 *
 * Bare init only: no spans, no breadcrumb enrichment, no error-boundary wiring yet.
 * Env: VITE_SENTRY_DSN (unset → no-op), optional VITE_SENTRY_RELEASE / VITE_SENTRY_ENVIRONMENT.
 *
 * The browser SDK posts to Sentry's ingest host, so `connect-src` in `ui/vercel.json` has to
 * allow it — without that entry the CSP blocks every event and the SDK reports nothing.
 */
import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "../../../observability/sentryScrubber";

export const clientRelease = import.meta.env.VITE_SENTRY_RELEASE || "development";

export const clientEnvironment = import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;

export function initClientMonitoring(): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: clientRelease,
    environment: clientEnvironment,
    // ADR 0032: no automatic PII. Everything Sentry sees is added on purpose.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
