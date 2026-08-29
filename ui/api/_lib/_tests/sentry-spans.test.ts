/**
 * sentry.ts spans and per-request identity — proof that a Vercel function sends its spans before
 * it is frozen, and that the athlete on one request is not still attached to the next one.
 *
 * Unlike `sentry.test.ts`, this file fakes nothing but the network: `init` is the real one with
 * a transport that keeps envelopes in an array, so `startSpan`, `continueTrace`, the span
 * pipeline, and `flush` are all the shipping code. The load-bearing assertion is timing —
 * envelopes must already be in that array by the time the wrapper's promise resolves, because
 * on Vercel nothing runs after that.
 *
 * The module is imported once, not per test: `Sentry.init` registers an OpenTelemetry context
 * manager in a global that survives `vi.resetModules()`, so a re-imported SDK ends up with a
 * tracer from the previous instance and child spans silently vanish from the transaction. The
 * no-DSN cases live in `sentry.test.ts` for the same reason — `initServerMonitoring()` latches.
 */
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Event } from "@sentry/node";

/** The envelope shape these assertions read. `@sentry/node` exports no type for it. */
type EnvelopeItem = [{ type?: string }, unknown];
type CapturedEnvelope = [unknown, EnvelopeItem[]];

const sentEnvelopes: CapturedEnvelope[] = [];

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  init.mockImplementation((options: Parameters<typeof actual.init>[0]) =>
    actual.init({
      ...options,
      // Stands in for the HTTP transport so nothing leaves the test, and so "sent" is an
      // observable moment rather than a network call.
      transport: () => ({
        send: async (envelope: unknown) => {
          sentEnvelopes.push(envelope as CapturedEnvelope);
          return {};
        },
        flush: async () => true,
      }),
    }),
  );
  return { ...actual, init };
});

const {
  captureGeminiFailure,
  captureServerException,
  setAthleteScope,
  withContinuedTrace,
  withGeminiSpan,
} = await import("../sentry.js");

/** Every error event the fake transport has received so far, in the order they were sent. */
function sentErrors(): Event[] {
  return sentEnvelopes.flatMap((envelope) =>
    envelope[1].filter(([header]) => header.type === "event").map(([, item]) => item as Event),
  );
}

/** Every transaction event the fake transport has received so far. */
function sentTransactions(): Event[] {
  return sentEnvelopes.flatMap((envelope) =>
    envelope[1]
      .filter(([header]) => header.type === "transaction")
      .map(([, item]) => item as Event),
  );
}

/**
 * Child spans do not ride inside `transaction.spans` on this SDK: v10 streams them as their own
 * `span` envelope items, with attribute values wrapped as `{ value, type }`. Same envelope, same
 * flush — but the assertions have to read them where they actually are.
 */
interface SpanItem {
  name: string;
  status?: string;
  parent_span_id?: string;
  attributes: Record<string, { value: unknown }>;
}

function sentSpans(): { name: string; status?: string; attributes: Record<string, unknown> }[] {
  return sentEnvelopes
    .flatMap((envelope) =>
      envelope[1]
        .filter(([header]) => header.type === "span")
        .flatMap(([, item]) => (item as { items?: SpanItem[] }).items ?? []),
    )
    .map((span) => ({
      name: span.name,
      status: span.status,
      attributes: Object.fromEntries(
        Object.entries(span.attributes).map(([key, wrapped]) => [key, wrapped.value]),
      ),
    }));
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://coach.test/api/coach-chat", { method: "POST", headers });
}

beforeAll(() => {
  process.env.SENTRY_DSN = "https://public@o0.ingest.de.sentry.io/1";
});

beforeEach(() => {
  sentEnvelopes.length = 0;
});

describe("withContinuedTrace server span", () => {
  it("has already sent the transaction by the time the handler's response is returned", async () => {
    const response = await withContinuedTrace(request(), async () => Response.json({ ok: true }));

    // Nothing runs after this line on Vercel — the function is frozen. So the assertion is
    // deliberately made here, with no await in between, not after a tick.
    expect(sentTransactions()).toHaveLength(1);
    expect(response.status).toBe(200);
  });

  it("names the span for the route and records a successful outcome", async () => {
    await withContinuedTrace(request(), async () => Response.json({ ok: true }));

    const [transaction] = sentTransactions();
    expect(transaction.transaction).toBe("POST /api/coach-chat");
    expect(transaction.contexts?.trace?.op).toBe("http.server");
    expect(transaction.contexts?.trace?.data).toMatchObject({
      "http.request.method": "POST",
      "url.path": "/api/coach-chat",
      "http.response.status_code": 200,
      outcome: "ok",
    });
    expect(transaction.contexts?.trace?.status).toBe("ok");
  });

  it("marks the span an error when the route answers with a failure status", async () => {
    await withContinuedTrace(request(), async () =>
      Response.json({ error: "Coach chat failed" }, { status: 500 }),
    );

    const [transaction] = sentTransactions();
    expect(transaction.contexts?.trace?.data).toMatchObject({ outcome: "error" });
    expect(transaction.contexts?.trace?.status).toBe("internal_error");
  });

  it("sends the span even when the handler throws, before the error propagates", async () => {
    await expect(
      withContinuedTrace(request(), async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const [transaction] = sentTransactions();
    expect(transaction.contexts?.trace?.data).toMatchObject({ outcome: "error" });
    expect(transaction.contexts?.trace?.status).toBe("internal_error");
  });

  it("hangs the span off the browser's trace, so both halves share one", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";

    await withContinuedTrace(
      request({ "sentry-trace": `${traceId}-b7ad6b7169203331-1` }),
      async () => Response.json({ ok: true }),
    );

    expect(sentTransactions()[0]?.contexts?.trace?.trace_id).toBe(traceId);
  });
});

describe("withGeminiSpan", () => {
  const USAGE = {
    promptTokens: 13_004,
    completionTokens: 412,
    totalTokens: 13_416,
    cachedPromptTokens: 12_800,
  };

  /** A Gemini span only ships inside a route transaction — that is the shape production uses. */
  async function geminiSpanFrom(
    run: (record: (usage: Partial<typeof USAGE>) => void) => Promise<unknown>,
  ) {
    await withContinuedTrace(request(), async () => {
      await withGeminiSpan("gemini-flash-latest", run).catch(() => undefined);
      return Response.json({ ok: true });
    });
    return sentSpans()[0];
  }

  it("carries the model and Sentry's gen_ai token attributes", async () => {
    const span = await geminiSpanFrom(async (record) => {
      record(USAGE);
      return "reply";
    });

    expect(span?.name).toBe("generate_content gemini-flash-latest");
    expect(span?.attributes).toMatchObject({
      "sentry.op": "gen_ai.generate_content",
      "gen_ai.system": "google_genai",
      "gen_ai.operation.name": "generate_content",
      "gen_ai.request.model": "gemini-flash-latest",
      "gen_ai.usage.input_tokens": 13_004,
      "gen_ai.usage.output_tokens": 412,
      "gen_ai.usage.total_tokens": 13_416,
      "gen_ai.usage.input_tokens.cached": 12_800,
      outcome: "ok",
    });
  });

  it("never carries prompt or reply text on a turn that worked (ADR 0032)", async () => {
    const span = await geminiSpanFrom(async (record) => {
      record(USAGE);
      return "legs felt heavy on the last interval";
    });

    expect(JSON.stringify(span?.attributes)).not.toContain("legs felt heavy");
  });

  it("omits the counts Gemini did not return rather than sending zeros", async () => {
    const span = await geminiSpanFrom(async (record) => {
      record({ promptTokens: 10 });
      return "reply";
    });

    expect(span?.attributes).toMatchObject({ "gen_ai.usage.input_tokens": 10 });
    expect(span?.attributes).not.toHaveProperty("gen_ai.usage.output_tokens");
  });

  it("marks the span an error and rethrows when the call fails", async () => {
    const span = await geminiSpanFrom(async () => {
      throw new Error("Gemini request failed (503)");
    });

    expect(span?.attributes).toMatchObject({ outcome: "error" });
    expect(span?.status).toBe("error");
  });

  it("rides out inside the route transaction, which is what flushes it", async () => {
    await withContinuedTrace(request(), async () => {
      await withGeminiSpan("gemini-flash-latest", async (record) => record(USAGE));
      return Response.json({ ok: true });
    });

    // Same freeze argument as above: both halves are already sent, with no flush of its own on
    // the Gemini span - the route's flush is what put it on the wire.
    expect(sentTransactions()).toHaveLength(1);
    expect(sentSpans().map((span) => span.name)).toEqual(["generate_content gemini-flash-latest"]);
  });
});

describe("captureServerException on a route that answers with a status", () => {
  const REPO = "skanda-athlete/coach-phelps";
  const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

  /**
   * The shape both wrapped routes have: the handler catches its own failure and answers with a
   * status, so nothing propagates out of it. Capture inside that catch is the only thing that
   * puts a GitHub or session failure in front of an operator.
   */
  function routeThatCatches(run: () => Promise<void>): Promise<Response> {
    return withContinuedTrace(
      request({ "sentry-trace": `${TRACE_ID}-b7ad6b7169203331-1` }),
      async () => {
        setAthleteScope(REPO);
        try {
          await run();
          return Response.json({ ok: true });
        } catch (error) {
          await captureServerException(error);
          return Response.json({ error: "failed" }, { status: 500 });
        }
      },
    );
  }

  const failCommit = async () => {
    throw new Error("GitHub commit failed");
  };

  it("has already sent the error by the time the status response is returned", async () => {
    const response = await routeThatCatches(failCommit);

    // Same freeze argument as the transaction above: the assertion is made here, with no await
    // in between, because on Vercel nothing runs after the handler resolves.
    expect(sentErrors()).toHaveLength(1);
    expect(response.status).toBe(500);
  });

  it("names the athlete and rides the browser's trace, so the two halves join up", async () => {
    await routeThatCatches(failCommit);

    const [event] = sentErrors();
    expect(event?.exception?.values?.[0]?.value).toBe("GitHub commit failed");
    expect(event?.tags).toMatchObject({ athlete_id: "skanda-athlete" });
    expect(event?.contexts?.trace?.trace_id).toBe(TRACE_ID);
  });

  it("captures what escapes the route's catch, such as an auth refresh that throws", async () => {
    await expect(
      withContinuedTrace(request(), async () => {
        throw new Error("session refresh failed");
      }),
    ).rejects.toThrow("session refresh failed");

    expect(sentErrors()).toHaveLength(1);
    expect(sentErrors()[0]?.exception?.values?.[0]?.value).toBe("session refresh failed");
  });

  it("sends one event, not two, when a Gemini failure is rethrown into that catch", async () => {
    // coach-message's `generateProactiveBody` captures and rethrows, so the same error object
    // reaches the route's generic catch. Only the first, detailed event may go out.
    await routeThatCatches(async () => {
      const err = Object.assign(new Error("Gemini request failed (503)"), { status: 503 });
      await captureGeminiFailure(err, {
        model: "gemini-flash-latest",
        upstreamStatus: 503,
        turnMode: "proactive_message",
        athleteMessage: "",
      });
      throw err;
    });

    const errors = sentErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.tags).toMatchObject({
      turn_mode: "proactive_message",
      model: "gemini-flash-latest",
      upstream_status: 503,
    });
  });
});

describe("setAthleteScope", () => {
  const REPO = "skanda-athlete/coach-phelps";

  it("names the athlete on an error captured later in the same request", async () => {
    await withContinuedTrace(request(), async () => {
      setAthleteScope(REPO);
      await captureServerException(new Error("commit failed"));
      return Response.json({ ok: true });
    });

    const [event] = sentErrors();
    expect(event?.user).toEqual({ id: "skanda-athlete" });
    expect(event?.tags).toMatchObject({ athlete_id: "skanda-athlete" });
  });

  it("names the athlete on the request's own transaction, not just its errors", async () => {
    await withContinuedTrace(request(), async () => {
      setAthleteScope(REPO);
      return Response.json({ ok: true });
    });

    const [transaction] = sentTransactions();
    expect(transaction.user).toEqual({ id: "skanda-athlete" });
    expect(transaction.tags).toMatchObject({ athlete_id: "skanda-athlete" });
  });

  it("uses the repo owner, the id iOS and the browser derive too, so one athlete has one id", async () => {
    await withContinuedTrace(request(), async () => {
      setAthleteScope("owner-only/some-other-repo-name");
      await captureServerException(new Error("boom"));
      return Response.json({ ok: true });
    });

    expect(sentErrors()[0]?.user).toEqual({ id: "owner-only" });
  });

  it("does not carry one athlete into the next request the warm instance serves", async () => {
    await withContinuedTrace(request(), async () => {
      setAthleteScope(REPO);
      return Response.json({ ok: true });
    });

    // Second request, same process, same latched SDK - and it never calls setAthleteScope,
    // standing in for an unauthenticated or auth-failure path.
    await withContinuedTrace(request(), async () => {
      await captureServerException(new Error("anonymous failure"));
      return Response.json({ ok: true });
    });

    const [event] = sentErrors();
    expect(event?.user).toBeUndefined();
    expect(event?.tags?.athlete_id).toBeUndefined();
    expect(JSON.stringify(sentTransactions()[1])).not.toContain("skanda-athlete");
  });

  it("leaves the athlete off events captured outside any request", async () => {
    await withContinuedTrace(request(), async () => {
      setAthleteScope(REPO);
      return Response.json({ ok: true });
    });
    sentEnvelopes.length = 0;

    await captureServerException(new Error("module-scope failure"));

    expect(sentErrors()[0]?.user).toBeUndefined();
  });
});
