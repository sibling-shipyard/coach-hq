/**
 * observability.ts — the options the browser `Sentry.init` is handed, and who it says an event
 * happened to.
 *
 * `@sentry/react` is faked so the assertions are about our config and our identity calls, not
 * about the SDK opening a transport. `initOptions()` re-imports under `vi.resetModules()` because
 * the module reads `import.meta.env` at module scope.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { init, browserTracingIntegration, setUser, setTag } = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
  setUser: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock("@sentry/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/react")>()),
  init,
  browserTracingIntegration,
  setUser,
  setTag,
}));

/** Shaped like the real thing: an `AIza` key of the length the scrubber's pattern matches. */
const URL_WITH_KEY =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=AIzaSyD-0123456789abcdefghijklmnopqrstu";

interface InitOptions {
  integrations: { name: string }[];
  tracesSampleRate: number;
  tracePropagationTargets: RegExp[];
  initialScope: { tags: { operation: string } };
  sendDefaultPii: boolean;
  beforeSend: (event: unknown) => { extra: { detail: string } };
  beforeSendTransaction: (event: unknown) => { extra: { detail: string } };
  beforeSendSpan: (span: unknown) => { data: { "url.full": string } };
}

async function initOptions(): Promise<InitOptions> {
  vi.resetModules();
  const { initClientMonitoring } = await import("./observability");
  initClientMonitoring();
  return init.mock.calls[0][0] as InitOptions;
}

describe("initClientMonitoring", () => {
  beforeEach(() => {
    init.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@o0.ingest.de.sentry.io/2");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stays silent without a DSN, so local runs and fork deploys send nothing", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    await initOptions().catch(() => undefined);

    expect(init).not.toHaveBeenCalled();
  });

  it("keeps browser tracing on, which is what attaches sentry-trace to /api/ calls", async () => {
    const options = await initOptions();

    expect(options.integrations.map((i) => i.name)).toContain("BrowserTracing");
    expect(options.tracePropagationTargets).toEqual([/^\/api\//]);
  });

  it("groups browser errors under the web operation", async () => {
    expect((await initOptions()).initialScope.tags.operation).toBe("web");
  });

  it("falls back to 1 and warns when the sample rate is outside Sentry's range", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VITE_SENTRY_TRACES_SAMPLE_RATE", "100");

    expect((await initOptions()).tracesSampleRate).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      "[sentry] VITE_SENTRY_TRACES_SAMPLE_RATE=100 must be from 0 to 1 - using 1",
    );
    warn.mockRestore();
  });

  it("scrubs a credential out of a span, which beforeSend never sees", async () => {
    const scrubbed = (await initOptions()).beforeSendSpan({ data: { "url.full": URL_WITH_KEY } });

    expect(scrubbed.data["url.full"]).not.toContain("AIza");
    expect(scrubbed.data["url.full"]).toContain("key=[Filtered]");
  });

  it("scrubs a credential out of a transaction, which beforeSend never sees", async () => {
    const scrubbed = (await initOptions()).beforeSendTransaction({
      extra: { detail: "token ghp_0123456789abcdefghijklmnopqrstuvwxyz01" },
    });

    expect(scrubbed.extra.detail).toBe("token [Filtered]");
  });

  it("keeps the error scrubber and the PII opt-out", async () => {
    const options = await initOptions();

    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend({ extra: { detail: `see ${URL_WITH_KEY}` } }).extra.detail).toContain(
      "key=[Filtered]",
    );
  });
});

describe("setAthleteUser", () => {
  beforeEach(() => {
    setUser.mockClear();
    setTag.mockClear();
  });

  it("identifies the athlete by repo owner, the same id the API and iOS derive", async () => {
    const { setAthleteUser } = await import("./observability");
    setAthleteUser("skanda-athlete/coach-phelps");

    expect(setUser).toHaveBeenCalledWith({ id: "skanda-athlete" });
    expect(setTag).toHaveBeenCalledWith("athlete_id", "skanda-athlete");
  });

  it("sends the handle and nothing else about the person (ADR 0032)", async () => {
    const { setAthleteUser } = await import("./observability");
    setAthleteUser("skanda-athlete/coach-phelps");

    expect(setUser.mock.calls[0]?.[0]).toEqual({ id: "skanda-athlete" });
  });

  it("clears the athlete on sign-out, so the next session is not attributed to them", async () => {
    const { setAthleteUser } = await import("./observability");
    setAthleteUser("skanda-athlete/coach-phelps");
    setAthleteUser(null);

    expect(setUser).toHaveBeenLastCalledWith(null);
    expect(setTag).toHaveBeenLastCalledWith("athlete_id", undefined);
  });

  it("clears rather than guessing when the repo is unknown", async () => {
    const { setAthleteUser } = await import("./observability");
    setAthleteUser(undefined);

    expect(setUser).toHaveBeenCalledWith(null);
  });
});
