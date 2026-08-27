import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "../../observability/sentryScrubber.js";

interface MonitoringContext {
  operationId: string;
  athleteId?: string;
}

export interface GeminiMonitoringDetails {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  replyChars?: number;
}

function configuredSecrets(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.SESSION_SECRET,
    process.env.GITHUB_APP_CLIENT_SECRET,
  ].filter((value): value is string => Boolean(value));
}

export const sentryRelease =
  process.env.SENTRY_RELEASE ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "development";
export const sentryEnvironment =
  process.env.SENTRY_ENVIRONMENT ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  "development";

function tracesSampleRate(): number {
  const configured = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "1");
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : 1;
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    release: sentryRelease,
    environment: sentryEnvironment,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(),
    beforeSend: (event) => scrubSentryEvent(event, configuredSecrets()),
    beforeSendTransaction: (event) =>
      scrubSentryEvent(event, configuredSecrets()),
  });
}

export function operationIdFor(req: Request): string {
  const supplied = req.headers.get("x-operation-id")?.trim();
  return supplied && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function athleteIdForRepo(repo: string | undefined): string | undefined {
  return repo?.split("/", 1)[0] || undefined;
}

export function setMonitoringScope(
  scope: Sentry.Scope,
  context: MonitoringContext,
): void {
  scope.setTag("operation_id", context.operationId);
  scope.setTag("release", sentryRelease);
  scope.setTag("environment", sentryEnvironment);
  if (context.athleteId) scope.setTag("athlete_id", context.athleteId);
}

/** Update request-local context as work moves through GitHub, Gemini, and persistence. */
export function setMonitoringStage(stage: string): void {
  Sentry.getIsolationScope().setTag("stage", stage);
  Sentry.getActiveSpan()?.setAttribute("stage", stage);
}

export function setMonitoringAthlete(athleteId: string | undefined): void {
  if (!athleteId) return;
  Sentry.getIsolationScope().setTag("athlete_id", athleteId);
  Sentry.getIsolationScope().setUser({ id: athleteId });
  Sentry.getActiveSpan()?.setAttribute("athlete_id", athleteId);
}

export function recordGeminiResult(details: GeminiMonitoringDetails): void {
  const scope = Sentry.getIsolationScope();
  scope.setTag("model", details.model);
  scope.setExtras({
    prompt_tokens: details.promptTokens,
    completion_tokens: details.completionTokens,
    gemini_reply_chars: details.replyChars,
  });

  const active = Sentry.getActiveSpan();
  const root = active ? Sentry.getRootSpan(active) : undefined;
  for (const span of [active, root]) {
    span?.setAttribute("ai.model", details.model);
    span?.setAttribute("ai.prompt_tokens", details.promptTokens ?? 0);
    span?.setAttribute("ai.completion_tokens", details.completionTokens ?? 0);
    span?.setAttribute("ai.reply_chars", details.replyChars ?? 0);
  }
}

const capturedErrors = new WeakSet<object>();

/** Capture an exception at most once even when a handled fallback later rethrows it. */
export function captureExceptionOnce(error: unknown): string | undefined {
  if (
    error != null &&
    (typeof error === "object" || typeof error === "function")
  ) {
    if (capturedErrors.has(error)) return undefined;
    capturedErrors.add(error);
  }
  return Sentry.captureException(error);
}

export async function monitorServerRequest(
  req: Request,
  name: string,
  work: (operationId: string) => Promise<Response>,
): Promise<Response> {
  const operationId = operationIdFor(req);
  const started = performance.now();
  return Sentry.withIsolationScope(async (scope) => {
    setMonitoringScope(scope, { operationId });
    return Sentry.startSpan(
      {
        name,
        op: "http.server",
        attributes: {
          operation_id: operationId,
          "http.request.method": req.method,
          "url.path": new URL(req.url).pathname,
        },
      },
      async (span) => {
        try {
          const response = await work(operationId);
          const success = response.status < 400;
          span.setAttribute("outcome", success ? "success" : "error");
          span.setAttribute("http.response.status_code", response.status);
          span.setStatus({ code: success ? 1 : 2 });
          return withOperationId(response, operationId);
        } catch (error) {
          span.setAttribute("outcome", "error");
          span.setStatus({
            code: 2,
            message: error instanceof Error ? error.message : "request failed",
          });
          throw error;
        } finally {
          span.setAttribute("duration_ms", performance.now() - started);
        }
      },
    );
  });
}

export function withOperationId(
  response: Response,
  operationId: string,
): Response {
  response.headers.set("x-operation-id", operationId);
  return response;
}

export { Sentry };
