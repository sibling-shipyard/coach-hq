import { Sentry } from "./sentry.js";

/**
 * Structured logger that writes to both Vercel logs (via console.log) and Sentry breadcrumbs.
 *
 * Replaces standalone console.log() calls so that when an error escapes, the Sentry event
 * carries the timeline of what the request did before it failed. `data` is copied onto the
 * breadcrumb as-is, so it must not hold chat text — ADR 0032 scopes that capture to failed
 * Gemini calls (`captureGeminiFailure`), and the scrubber does not strip messages.
 */
export function log(category: string, message: string, data?: Record<string, unknown>): void {
  // Output to standard console for Vercel/local debugging
  if (data) {
    console.log(`[${category}] ${message}`, data);
  } else {
    console.log(`[${category}] ${message}`);
  }

  // Attach to Sentry's current isolation scope so it rides with any errors on this request
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  });
}
