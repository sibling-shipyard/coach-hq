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
 * returns, and the SDK sends on a background timer, so an unflushed event or span is dropped.
 * The capture helpers await their flush. The route wrapper hands its handled flush promise to
 * Vercel's `waitUntil`, which keeps the function alive without keeping the response open; local
 * runs and tests have no request context, so they await the same promise instead.
 *
 * `withContinuedTrace` owns the flush that sends the **spans**: a child span is only sent when
 * its root span ends, so `withGeminiSpan` deliberately does not flush — its span rides out
 * inside the route's `http.server` transaction. Open a Gemini span outside a wrapped route and
 * nothing sends it. Error events are separate and flush themselves, in `captureServerException`
 * and `captureGeminiFailure`, so a failed request still waits for that error flush.
 */
import * as Sentry from "@sentry/node";
import { waitUntil } from "@vercel/functions";
import { scrubSentryEvent } from "../../observability/sentryScrubber.js";

export const sentryRelease =
  process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || "development";

export const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";

/**
 * Sample every trace. Right for four athletes; the runbook says to set the var explicitly before
 * that stops being true. An invalid value warns rather than falling back silently — Sentry
 * disables tracing for values outside 0...1 and says nothing.
 */
export const sentryTracesSampleRate = ((raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`[sentry] SENTRY_TRACES_SAMPLE_RATE=${raw} must be from 0 to 1 - using 1`);
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

/**
 * Never record an outbound request as a span.
 *
 * The URL is the whole problem: `geminiClient.ts` puts the API key in the query string, and both
 * outbound instrumentations copy the full URL onto the span (`url.full`) before anything gets a
 * chance to filter it. `ignoreOutgoingRequests` runs first and returns before a span or a
 * breadcrumb exists, so the credential is never captured rather than captured and redacted.
 *
 * `disableIncomingRequestSpans` removes the SDK's duplicate `http.server` span. The route wrapper
 * opens the one we keep because it carries the handled response's `outcome`.
 */
const ignoreEveryOutgoingRequest = () => true;

let initialized = false;

export function initServerMonitoring(): boolean {
  if (initialized) return true;
  if (!process.env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: sentryRelease,
    environment: sentryEnvironment,
    tracesSampleRate: sentryTracesSampleRate,
    // Same name as the defaults, so these replace them instead of running beside them. `Http`
    // covers `node:http`/`https`, `NodeFetch` covers global `fetch` — Gemini and the GitHub API
    // both go through the second one.
    integrations: [
      Sentry.httpIntegration({
        ignoreOutgoingRequests: ignoreEveryOutgoingRequest,
        disableIncomingRequestSpans: true,
      }),
      Sentry.nativeNodeFetchIntegration({ ignoreOutgoingRequests: ignoreEveryOutgoingRequest }),
    ],
    // Read incoming trace headers, send none. Gemini and the GitHub API have no use for our
    // `sentry-trace`/`baggage`, and an empty list is the only way to say so — the default
    // attaches them to every outbound request. Incoming continuation is unaffected.
    tracePropagationTargets: [],
    // ADR 0032: no automatic PII. Everything Sentry sees is added on purpose.
    sendDefaultPii: false,
    // `beforeSend` fires for error events only. Transactions and spans are separate payloads with
    // their own hooks, so all three are wired or ADR 0032's scrubbing rule holds for a third of
    // what we send.
    beforeSend: (event) => scrubSentryEvent(event, configuredSecrets()),
    beforeSendTransaction: (event) => scrubSentryEvent(event, configuredSecrets()),
    beforeSendSpan: (span) => scrubSentryEvent(span, configuredSecrets()),
  });
  initialized = true;
  return true;
}

/** How long a flush may keep the invocation alive. Shared by every send on the request path. */
const FLUSH_TIMEOUT_MS = 2000;

const VERCEL_REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

interface VercelRequestContextProvider {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void };
}

function hasVercelWaitUntil(): boolean {
  const globals = globalThis as typeof globalThis & {
    [key: symbol]: VercelRequestContextProvider | undefined;
  };
  return typeof globals[VERCEL_REQUEST_CONTEXT]?.get?.()?.waitUntil === "function";
}

async function flushRequestMonitoring(): Promise<void> {
  const flushPromise = Sentry.flush(FLUSH_TIMEOUT_MS).catch((error: unknown) => {
    console.error("[sentry] flush failed", error);
    return false;
  });

  if (!hasVercelWaitUntil()) {
    await flushPromise;
    return;
  }

  try {
    waitUntil(flushPromise);
  } catch (error) {
    console.error("[sentry] could not register background flush", error);
    await flushPromise;
  }
}

/**
 * Run `handler` on the trace the browser started, inside one `http.server` span.
 *
 * Nothing continues that trace on its own here. `Sentry.init` runs lazily, from inside the
 * capture helpers below, long after Vercel's runtime accepted the request — so there is no
 * auto-instrumented server span holding the incoming `sentry-trace`, and without this call the
 * browser event and the API event land on two different traces. The span is ours for the same
 * reason: without one the trace view shows a browser transaction and nothing on the API side.
 * Call it at the route's entry, before anything that might capture.
 *
 * The flush is what makes the span real. `Sentry.startSpan` ends the span before its promise
 * settles, then `waitUntil` keeps the function alive until that flush finishes after the response
 * leaves. Outside a Vercel request, the wrapper awaits the flush instead.
 *
 * The isolation scope is forked here, and that fork is what `setAthleteScope` writes the athlete
 * onto. Nothing else gives one request its own identity: `continueTrace` forks the *current*
 * scope but inherits the process-wide isolation scope, and `startSpan` forks the current scope
 * again below the one the transaction event captured — so a user set on the current scope inside
 * the handler reaches that request's errors and not its transaction. One forked isolation scope
 * per request reaches both, and reaches nothing the next request on this warm instance sends.
 *
 * No DSN, or no headers, and this is a pass-through: the handler runs exactly as it would have.
 */
export function withContinuedTrace<T>(req: Request, handler: () => Promise<T>): Promise<T> {
  if (!initServerMonitoring()) return handler();
  const { pathname } = new URL(req.url);
  return Sentry.withIsolationScope(() => {
    Sentry.getIsolationScope().setTag("operation", apiOperation(pathname));
    return continueTraceInto(req, pathname, handler);
  });
}

function apiOperation(pathname: string): string {
  return (
    pathname
      .replace(/^\/api\/?/, "")
      .replace(/^\/+|\/+$/g, "")
      .replaceAll("/", ".") || "api"
  );
}

export interface SentryRouteContext {
  /** Set as soon as auth resolves an owner/repo; leave unset for anonymous routes and failures. */
  setAthleteScope(repoFullName: string): void;
  /** Capture faults a route converts into a response instead of throwing. */
  captureException(error: unknown): Promise<CaptureResult>;
}

/**
 * Run one API route inside its request trace and request-scoped Sentry context.
 *
 * Escaped errors are captured by `withContinuedTrace`. A route that deliberately converts a
 * fault into a response must call `captureException` first. Auth routes may set identity when
 * they establish it; authenticated routes set it immediately after auth resolves. A route with
 * no auth leaves it unset.
 */
export function withSentryRoute<T>(
  req: Request,
  handler: (sentry: SentryRouteContext) => Promise<T>,
): Promise<T> {
  return withContinuedTrace(req, () =>
    handler({ setAthleteScope, captureException: captureServerException }),
  );
}

/** The body of `withContinuedTrace`, split out only to keep the isolation-scope fork one line. */
function continueTraceInto<T>(
  req: Request,
  pathname: string,
  handler: () => Promise<T>,
): Promise<T> {
  return Sentry.continueTrace(
    {
      sentryTrace: req.headers.get("sentry-trace") ?? undefined,
      baggage: req.headers.get("baggage"),
    },
    async () => {
      try {
        return await Sentry.startSpan(
          {
            name: `${req.method} ${pathname}`,
            op: "http.server",
            attributes: { "http.request.method": req.method, "url.path": pathname },
          },
          async (span) => {
            try {
              const result = await handler();
              // The routes catch their own errors and answer with a status, so the status is
              // the only place the outcome shows. A 4xx counts as an error here on purpose:
              // on these two routes it means the athlete's session or request broke.
              if (result instanceof Response) {
                Sentry.setHttpStatus(span, result.status);
                span.setAttribute("outcome", result.status < 400 ? "ok" : "error");
              }
              return result;
            } catch (error) {
              span.setAttribute("outcome", "error");
              // Last stop for what the route's own catch never sees - an auth or session
              // refresh that throws before the handler's try block. Capture is idempotent per
              // error object, so an error a route already captured is not sent twice.
              await captureServerException(error);
              throw error;
            }
          },
        );
      } finally {
        await flushRequestMonitoring();
      }
    },
  );
}

/**
 * Tag this request's events with the athlete they happened to.
 *
 * The id is the owner half of `owner/repo`, derived exactly the way iOS derives it
 * (`DiagnosticsManager.setAthlete`), so a web event, an API event and a native event for the
 * same person carry the same `athlete_id`. It is also the only handle both auth modes hold:
 * the iOS Bearer path presents `X-Coach-Repo` and no GitHub login, so `RepoAuthContext` has a
 * repo and nothing else stable.
 *
 * ADR 0032 keeps `sendDefaultPii: false` on purpose — this is the deliberate exception the
 * LLD's tag table already named. The handle and nothing else: no email, no IP.
 *
 * **The isolation scope, which `withContinuedTrace` forks per request.** The current scope is
 * the wrong one twice over: `startSpan` forks it again below the scope the transaction event
 * captured, so the athlete would reach that request's errors but not its transaction. Call this
 * inside `withContinuedTrace`, after auth resolves; outside one it writes onto whatever
 * isolation scope is active, which on Vercel is the process-wide one.
 */
export function setAthleteScope(repoFullName: string): void {
  if (!initServerMonitoring()) return;
  const athleteId = repoFullName.split("/")[0];
  if (!athleteId) return;
  const scope = Sentry.getIsolationScope();
  scope.setUser({ id: athleteId });
  scope.setTag("athlete_id", athleteId);
}

/** Token counts Gemini returns in `usageMetadata`, named as this codebase reads them. */
export interface GeminiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
}

/**
 * Attribute names are Sentry's own `gen_ai` convention, not ours. `@sentry/core`'s
 * `tracing/google-genai` integration emits exactly these for a `models.generateContent` call
 * (`gen-ai-attributes.js`), so our hand-rolled spans land in the same Sentry AI views as
 * auto-instrumented ones — and if we ever swap raw `fetch` for `@google/genai`, the spans do
 * not change shape. We call `generateContent` over plain `fetch`, which that integration cannot
 * see, so we set them ourselves.
 */
const GEN_AI_OPERATION = "generate_content";

function usageAttributes(usage: GeminiUsage): Record<string, number> {
  const pairs: [string, number | undefined][] = [
    ["gen_ai.usage.input_tokens", usage.promptTokens],
    ["gen_ai.usage.output_tokens", usage.completionTokens],
    ["gen_ai.usage.total_tokens", usage.totalTokens],
    ["gen_ai.usage.input_tokens.cached", usage.cachedPromptTokens],
  ];
  return Object.fromEntries(
    pairs.filter((pair): pair is [string, number] => pair[1] !== undefined),
  );
}

/**
 * Wrap one Gemini `generateContent` call in a `gen_ai.generate_content` span.
 *
 * `run` is handed a `recordUsage` callback because the token counts only exist once the
 * response is parsed, which is inside the call, not around it.
 *
 * ADR 0032 puts prompt and reply text on the *failure* path only — a failed turn exists nowhere
 * else. A turn that works is already in `chat_history.json`, so this span carries counts and
 * model metadata and no text, ever.
 */
export function withGeminiSpan<T>(
  model: string,
  run: (recordUsage: (usage: GeminiUsage) => void) => Promise<T>,
): Promise<T> {
  if (!initServerMonitoring()) return run(() => {});
  return Sentry.startSpan(
    {
      name: `${GEN_AI_OPERATION} ${model}`,
      op: `gen_ai.${GEN_AI_OPERATION}`,
      attributes: {
        "gen_ai.system": "google_genai",
        "gen_ai.operation.name": GEN_AI_OPERATION,
        "gen_ai.request.model": model,
      },
    },
    async (span) => {
      try {
        const result = await run((usage) => span.setAttributes(usageAttributes(usage)));
        span.setAttribute("outcome", "ok");
        return result;
      } catch (error) {
        span.setAttribute("outcome", "error");
        throw error;
      }
    },
  );
}

export interface CaptureResult {
  /** Sentry's id for the event, and the string to search on in the UI. */
  eventId?: string;
  /** False means no DSN, or the queue did not drain inside the timeout — the event is lost. */
  sent: boolean;
}

/**
 * Capture and send now. `sent: false` is the difference between queued and delivered.
 *
 * Idempotent per error object: the SDK marks an exception it has captured and drops a second
 * capture of the same one. That is what holds a Gemini failure to a single event when
 * `captureGeminiFailure` records it and the caller then rethrows into a route's generic catch -
 * the detailed event wins, because it went first.
 *
 * Called inside `withContinuedTrace` this flushes before the route's transaction does; the
 * wrapper's own flush still sends the span. Called outside one - a route with no wrapper, or
 * module scope - this flush is the only thing that sends the event at all.
 */
export async function captureServerException(error: unknown): Promise<CaptureResult> {
  if (!initServerMonitoring()) return { sent: false };
  const eventId = Sentry.captureException(error);
  const sent = await Sentry.flush(FLUSH_TIMEOUT_MS);
  return { eventId, sent };
}

/** What a failed LLM call must carry to be debuggable from the Sentry UI alone. */
export interface GeminiFailureDetails {
  /**
   * coach-chat's own id, for grepping the Vercel logs of the same turn. Tagged
   * `vercel_trace_id`, not `trace_id`: Sentry's trace id is its own thing on this event and two
   * meanings of one name is a triage trap. Absent on paths that mint no trace id.
   */
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
      ...(details.traceId ? { vercel_trace_id: details.traceId } : {}),
      model: details.model,
      upstream_status: details.upstreamStatus,
      turn_mode: details.turnMode,
    },
    contexts: { coach_turn: { athlete_message: details.athleteMessage } },
  });
  const sent = await Sentry.flush(FLUSH_TIMEOUT_MS);
  return { eventId, sent };
}

export { Sentry };
