import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "../../../observability/sentryScrubber";

export const clientRelease =
  import.meta.env.VITE_SENTRY_RELEASE || "development";
export const clientEnvironment =
  import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE;

function tracesSampleRate(): number {
  const configured = Number(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "1",
  );
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : 1;
}

export function initClientMonitoring(): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    release: clientRelease,
    environment: clientEnvironment,
    sendDefaultPii: false,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: tracesSampleRate(),
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}

export function newOperationId(): string {
  return crypto.randomUUID();
}

export function setClientAthlete(athleteId: string | undefined): void {
  if (!athleteId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setTag("athlete_id", athleteId);
  Sentry.setUser({ id: athleteId });
}

const capturedErrors = new WeakSet<object>();

export function captureClientRequestFailure(
  error: unknown,
  context: {
    operationId: string;
    requestPath: string;
    requestMethod?: string;
    status?: number;
  },
): void {
  if (
    error != null &&
    (typeof error === "object" || typeof error === "function")
  ) {
    if (capturedErrors.has(error)) return;
    capturedErrors.add(error);
  }
  Sentry.captureException(error, {
    tags: {
      operation_id: context.operationId,
      request_path: context.requestPath,
      request_method: context.requestMethod ?? "GET",
    },
    extra: { status: context.status },
  });
}

export async function monitoredClientRequest<T>(
  name: string,
  operationId: string,
  work: (span: Sentry.Span) => Promise<T>,
): Promise<T> {
  const started = performance.now();
  return Sentry.startSpan(
    {
      name,
      op: "http.client",
      attributes: { operation_id: operationId },
    },
    async (span) => {
      try {
        return await work(span);
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
}

export function finishClientSpan(
  span: Sentry.Span,
  outcome: "success" | "error",
  status?: number,
): void {
  span.setAttribute("outcome", outcome);
  if (status != null) span.setAttribute("http.response.status_code", status);
  span.setStatus({ code: outcome === "success" ? 1 : 2 });
}

/** One-shot client request monitoring for central API calls that must not retry. */
export function monitoredClientFetch(
  name: string,
  requestPath: string,
  ignoredStatuses: readonly number[] = [],
): Promise<Response> {
  const operationId = newOperationId();
  return monitoredClientRequest(name, operationId, async (span) => {
    try {
      const response = await fetch(requestPath, {
        headers: { "x-operation-id": operationId },
      });
      finishClientSpan(
        span,
        response.ok ? "success" : "error",
        response.status,
      );
      if (!response.ok && !ignoredStatuses.includes(response.status)) {
        captureClientRequestFailure(
          new Error(`${name} failed (${response.status})`),
          { operationId, requestPath, status: response.status },
        );
      }
      return response;
    } catch (error) {
      captureClientRequestFailure(error, { operationId, requestPath });
      throw error;
    }
  });
}

export { Sentry };
