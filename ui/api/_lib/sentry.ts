/**
 * sentry.ts — Sentry setup for the Vercel Node functions.
 *
 * Init is a function, not a module side effect: only the routes that opt in pay the SDK's
 * cold-start cost, and importing this module from a test does not open a transport.
 * Env: SENTRY_DSN (unset → no-op, so local and fork deploys stay silent),
 * optional SENTRY_RELEASE / SENTRY_ENVIRONMENT / SENTRY_TRACES_SAMPLE_RATE.
 *
 * `tracesSampleRate` turns on tracing so this side speaks the same wire format as the browser:
 * the client SDK attaches `sentry-trace` and `baggage` to its `/api/...` calls
 * (`ui/client/src/lib/observability.ts`) and an event on the continued trace joins the browser's
 * in the Sentry trace view, with no id of our own.
 *
 * Every capture must be followed by `flush()`. A Vercel function is frozen the moment it
 * returns, and the SDK sends on a background timer, so an unflushed event is dropped. **Spans
 * are dropped the same way**, so anything that opens one must end it and flush before the
 * handler returns — the `flush()` in the capture helpers below drains spans too.
 */
import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "../../observability/sentryScrubber.js";

export const sentryRelease =
  process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development";

export const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Sample every trace. Right for four athletes; the runbook says to set the var explicitly before
 * that stops being true. An unparseable value warns rather than falling back silently — Sentry
 * reads `NaN` as "tracing off" and says nothing.
 */
export const sentryTracesSampleRate = ((raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[sentry] SENTRY_TRACES_SAMPLE_RATE=${raw} is not a number - using 1`);
    return 1;
  }
  return parsed;
})(process.env.SENTRY_TRACES_SAMPLE_RATE);

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
    tracesSampleRate: sentryTracesSampleRate,
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

/** What a failed LLM call must carry to be debuggable from the Sentry UI alone. */
export interface GeminiFailureDetails {
  /** Correlates the event with the turn's log lines. Absent on paths that mint no trace id. */
  traceId?: string;
  /** Gemini model id, supplied by the caller so this module stays free of coach-chat internals. */
  model: string;
  /** Upstream HTTP status, or 500 when the throw carried none. */
  upstreamStatus: number;
  /**
   * `TurnMode` — greeting, ordinary, closing, activity_sync — for the three `askGemini` call
   * sites in coach-chat. Two more paths call `generateContent` directly and are not turns at
   * all: `proactive_message` (coach-message's `generateProactiveBody`) and `template_adjust`
   * (coach-chat's First Session template-adjustment pass in `coachWorkoutFiles.ts`).
   */
  turnMode: string;
  /** The exact text sent to Gemini for this turn. */
  athleteMessage: string;
}

/**
 * Capture a Gemini call that threw, with enough of the turn attached to debug it.
 *
 * ADR 0032 captures the athlete's message on purpose: a turn that fails never reaches
 * `commitClosingTurn`, so it is never written to `chat_history.json` and this event is the only
 * record it happened. It rides in the event context rather than a tag because Sentry truncates
 * tag values near 200 characters and would cut a real message without saying so.
 */
export async function captureGeminiFailure(
  error: unknown,
  details: GeminiFailureDetails,
): Promise<CaptureResult> {
  if (!initServerMonitoring()) return { sent: false };
  const eventId = Sentry.captureException(error, {
    tags: {
      ...(details.traceId ? { trace_id: details.traceId } : {}),
      model: details.model,
      upstream_status: details.upstreamStatus,
      turn_mode: details.turnMode,
    },
    contexts: { coach_turn: { athlete_message: details.athleteMessage } },
  });
  const sent = await Sentry.flush(2000);
  return { eventId, sent };
}

export { Sentry };
