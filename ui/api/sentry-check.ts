/**
 * sentry-check.ts — throws on purpose so a deploy can be checked against a real Sentry project.
 *
 * TEMPORARY. Delete this file in Phase 2 of `docs/plans/sentry-lld.md`, once the coach-chat
 * Gemini failure path reports for real and there is nothing left for it to prove.
 *
 * GET /api/sentry-check → captures a deliberate error and answers 500 with the Sentry event id.
 * Unauthenticated on purpose: the point is to hit it from a phone against a Preview URL. It
 * takes no input, touches no athlete data, and does nothing but raise and report.
 *
 * NOT `_sentry-check.ts`: an underscore prefix excludes a file from routing at any depth
 * (`ui/api/README.md`), so that name would never be reachable.
 */
import { captureServerException, sentryEnvironment, sentryRelease } from "./_lib/sentry.js";

class SentryCheckError extends Error {
  constructor(marker: string) {
    super(`Deliberate Sentry check error (${marker})`);
    this.name = "SentryCheckError";
  }
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const marker = new Date().toISOString();
    const { eventId, sent } = await captureServerException(new SentryCheckError(marker));

    return Response.json(
      {
        error: "Deliberate Sentry check error",
        marker,
        release: sentryRelease,
        environment: sentryEnvironment,
        sentry_event_id: eventId ?? null,
        // `sent` is the honest signal: an id alone only means the event was queued.
        sent,
      },
      { status: 500 },
    );
  },
};
