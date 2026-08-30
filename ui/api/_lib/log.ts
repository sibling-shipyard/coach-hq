import { Sentry } from "./sentry.js";

/**
 * Structured logger that writes to both Vercel logs (via console.log) and Sentry breadcrumbs.
 *
 * Replaces standalone console.log() calls so that when an error escapes, the Sentry event
 * carries the full timeline of what the request did before it failed.
 *
 * @param category - The component or domain (e.g., "coach-chat", "activity-sync")
 * @param message - The log message
 * @param data - Optional structured data to include in the log and breadcrumb
 */
export function log(category: string, message: string, data?: Record<string, any>): void {
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
