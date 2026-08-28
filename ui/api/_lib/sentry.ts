/**
 * sentry.ts — Sentry setup for the Vercel Node functions.
 *
 * Init is a function, not a module side effect: only the routes that opt in pay the SDK's
 * cold-start cost, and importing this module from a test does not open a transport.
 * Env: SENTRY_DSN (unset → no-op, so local and fork deploys stay silent),
 * optional SENTRY_RELEASE / SENTRY_ENVIRONMENT.
 *
 * Every capture must be followed by `flush()`. A Vercel function is frozen the moment it
 * returns, and the SDK sends on a background timer, so an unflushed event is dropped.
 */
import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "../../observability/sentryScrubber.js";

export const sentryRelease =
  process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development";

export const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/** Values that must never reach Sentry verbatim, passed to the scrubber per event. */
function configuredSecrets(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.SESSION_SECRET,
    process.env.GITHUB_APP_CLIENT_SECRET,
  ].filter((value): value is string => Boolean(value));
}

let initialized = false;

export function initServerMonitoring(): boolean {
  if (initialized) return true;
  if (!process.env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: sentryRelease,
    environment: sentryEnvironment,
    // ADR 0032: no automatic PII. Everything Sentry sees is added on purpose.
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event, configuredSecrets()),
  });
  initialized = true;
  return true;
}

export interface CaptureResult {
  /** Sentry's id for the event, and the string to search on in the UI. */
  eventId?: string;
  /** False means no DSN, or the queue did not drain inside the timeout — the event is lost. */
  sent: boolean;
}

/** Capture and send now. `sent: false` is the difference between queued and delivered. */
export async function captureServerException(error: unknown): Promise<CaptureResult> {
  if (!initServerMonitoring()) return { sent: false };
  const eventId = Sentry.captureException(error);
  const sent = await Sentry.flush(2000);
  return { eventId, sent };
}

export { Sentry };
