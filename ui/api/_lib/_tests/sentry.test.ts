/**
 * sentry.ts::captureGeminiFailure — the payload a failed coach turn carries into Sentry.
 *
 * `@sentry/node` is the only fake: it stands in for the transport so the assertions are about
 * what gets attached to the event, not about the SDK delivering it. Each test re-imports the
 * module under `vi.resetModules()` because `initServerMonitoring()` latches after its first run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureException, flush, init } = vi.hoisted(() => ({
  captureException: vi.fn((_error: unknown, _context?: unknown): string => "event-id"),
  flush: vi.fn(async () => true),
  init: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException, flush, init }));

const DETAILS = {
  traceId: "ab12cd34",
  model: "gemini-flash-latest",
  upstreamStatus: 503,
  turnMode: "closing",
  athleteMessage: "legs felt heavy on the last interval",
};

async function loadSentry() {
  vi.resetModules();
  return import("../sentry.js");
}

describe("captureGeminiFailure", () => {
  beforeEach(() => {
    captureException.mockClear();
    flush.mockClear();
    init.mockClear();
    process.env.SENTRY_DSN = "https://public@o0.ingest.de.sentry.io/1";
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  it("tags the searchable fields and carries the athlete message in context", async () => {
    const { captureGeminiFailure } = await loadSentry();
    const error = Object.assign(new Error("Gemini request failed (503)"), { status: 503 });

    const result = await captureGeminiFailure(error, DETAILS);

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        trace_id: "ab12cd34",
        model: "gemini-flash-latest",
        upstream_status: 503,
        turn_mode: "closing",
      },
      contexts: { coach_turn: { athlete_message: DETAILS.athleteMessage } },
    });
    expect(result).toEqual({ eventId: "event-id", sent: true });
  });

  it("keeps the athlete message out of the tags, which Sentry truncates", async () => {
    const { captureGeminiFailure } = await loadSentry();
    const long = "a".repeat(400);

    await captureGeminiFailure(new Error("boom"), { ...DETAILS, athleteMessage: long });

    const [, context] = captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, unknown>; contexts: { coach_turn: { athlete_message: string } } },
    ];
    expect(Object.values(context.tags)).not.toContain(long);
    expect(context.contexts.coach_turn.athlete_message).toBe(long);
  });

  it("omits trace_id on the paths that mint no trace id", async () => {
    const { captureGeminiFailure } = await loadSentry();

    await captureGeminiFailure(new Error("boom"), { ...DETAILS, traceId: undefined });

    const [, context] = captureException.mock.calls[0] as [unknown, { tags: object }];
    expect(context.tags).not.toHaveProperty("trace_id");
  });

  it("flushes before returning, because Vercel freezes the function on return", async () => {
    const { captureGeminiFailure } = await loadSentry();

    await captureGeminiFailure(new Error("boom"), DETAILS);

    expect(flush).toHaveBeenCalledWith(2000);
    expect(captureException.mock.invocationCallOrder[0]).toBeLessThan(
      flush.mock.invocationCallOrder[0],
    );
  });

  it("reports the event lost when the queue does not drain inside the timeout", async () => {
    const { captureGeminiFailure } = await loadSentry();
    flush.mockResolvedValueOnce(false);

    expect(await captureGeminiFailure(new Error("boom"), DETAILS)).toEqual({
      eventId: "event-id",
      sent: false,
    });
  });

  it("captures nothing without a DSN, so local runs and fork deploys stay silent", async () => {
    delete process.env.SENTRY_DSN;
    const { captureGeminiFailure } = await loadSentry();

    expect(await captureGeminiFailure(new Error("boom"), DETAILS)).toEqual({ sent: false });
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("scrubs the event through sentryScrubber before it leaves the process", async () => {
    process.env.GEMINI_API_KEY = "configured-gemini-key";
    const { initServerMonitoring } = await loadSentry();
    initServerMonitoring();

    const { beforeSend } = init.mock.calls[0][0] as {
      beforeSend: (event: unknown) => { extra: { detail: string } };
    };
    const scrubbed = beforeSend({ extra: { detail: "key=configured-gemini-key" } });

    expect(scrubbed.extra.detail).toBe("key=[Filtered]");
    delete process.env.GEMINI_API_KEY;
  });
});
