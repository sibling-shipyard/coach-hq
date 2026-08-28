/**
 * sentry.ts — the payload a failed coach turn carries into Sentry, and the options `Sentry.init`
 * is handed.
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

// Only the transport-facing calls are faked. `continueTrace` and the scope APIs are the real
// ones, so the trace-continuation tests below assert on real propagation context, not on a stub.
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException,
  flush,
  init,
}));

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
        vercel_trace_id: "ab12cd34",
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

  it("omits vercel_trace_id on the paths that mint no trace id", async () => {
    const { captureGeminiFailure } = await loadSentry();

    await captureGeminiFailure(new Error("boom"), { ...DETAILS, traceId: undefined });

    const [, context] = captureException.mock.calls[0] as [unknown, { tags: object }];
    expect(context.tags).not.toHaveProperty("vercel_trace_id");
  });

  it("never tags the Vercel log id as trace_id, which is Sentry's own trace", async () => {
    const { captureGeminiFailure } = await loadSentry();

    await captureGeminiFailure(new Error("boom"), DETAILS);

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

describe("initServerMonitoring tracing", () => {
  beforeEach(() => {
    init.mockClear();
    process.env.SENTRY_DSN = "https://public@o0.ingest.de.sentry.io/1";
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  });

  async function initOptions() {
    const { initServerMonitoring } = await loadSentry();
    initServerMonitoring();
    return init.mock.calls[0][0] as {
      tracesSampleRate: number;
      tracePropagationTargets: unknown[];
      sendDefaultPii: boolean;
      beforeSend: (event: unknown) => { extra: { detail: string } };
    };
  }

  it("samples every trace when the var is unset, so a browser trace has an API half", async () => {
    expect((await initOptions()).tracesSampleRate).toBe(1);
  });

  it("reads SENTRY_TRACES_SAMPLE_RATE when the operator turns the rate down", async () => {
    process.env.SENTRY_TRACES_SAMPLE_RATE = "0.25";

    expect((await initOptions()).tracesSampleRate).toBe(0.25);
  });

  it("falls back to 1 and warns on a value Sentry would read as tracing-off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SENTRY_TRACES_SAMPLE_RATE = "all";

    expect((await initOptions()).tracesSampleRate).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("propagates no trace headers outbound, so Gemini and GitHub never see ours", async () => {
    expect((await initOptions()).tracePropagationTargets).toEqual([]);
  });

  it("keeps the scrubber and the PII opt-out on the same init that enables tracing", async () => {
    process.env.GEMINI_API_KEY = "configured-gemini-key";
    const options = await initOptions();

    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBe(1);
    expect(options.beforeSend({ extra: { detail: "key=configured-gemini-key" } }).extra.detail).toBe(
      "key=[Filtered]",
    );
    delete process.env.GEMINI_API_KEY;
  });
});

describe("withContinuedTrace", () => {
  const INCOMING_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
  const INCOMING = `${INCOMING_TRACE_ID}-b7ad6b7169203331-1`;

  beforeEach(() => {
    init.mockClear();
    process.env.SENTRY_DSN = "https://public@o0.ingest.de.sentry.io/1";
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
  });

  /** Reads what Sentry would stamp on any event captured inside the handler. */
  async function traceIdSeenBy(headers: Record<string, string>) {
    const { withContinuedTrace, Sentry } = await loadSentry();
    const req = new Request("https://coach.test/api/coach-chat", { headers });
    return withContinuedTrace(req, async () =>
      Sentry.getCurrentScope().getPropagationContext().traceId,
    );
  }

  it("continues the trace the browser started instead of beginning a new one", async () => {
    expect(await traceIdSeenBy({ "sentry-trace": INCOMING })).toBe(INCOMING_TRACE_ID);
  });

  it("starts its own trace when the caller sends no headers", async () => {
    const traceId = await traceIdSeenBy({});

    expect(traceId).not.toBe(INCOMING_TRACE_ID);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not leak the continued trace into the next request", async () => {
    const { withContinuedTrace, Sentry } = await loadSentry();
    const traced = new Request("https://coach.test/api/coach-chat", {
      headers: { "sentry-trace": INCOMING },
    });
    await withContinuedTrace(traced, async () => undefined);

    expect(Sentry.getCurrentScope().getPropagationContext().traceId).not.toBe(INCOMING_TRACE_ID);
  });

  it("runs the handler untouched with no DSN, so local and fork deploys behave as before", async () => {
    delete process.env.SENTRY_DSN;
    const { withContinuedTrace } = await loadSentry();
    const req = new Request("https://coach.test/api/coach-chat", {
      headers: { "sentry-trace": INCOMING },
    });

    await expect(withContinuedTrace(req, async () => "handler ran")).resolves.toBe("handler ran");
    expect(init).not.toHaveBeenCalled();
  });

  it("passes the handler's rejection through, so route error handling is unchanged", async () => {
    const { withContinuedTrace } = await loadSentry();
    const req = new Request("https://coach.test/api/coach-chat", {
      headers: { "sentry-trace": INCOMING },
    });

    await expect(
      withContinuedTrace(req, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
