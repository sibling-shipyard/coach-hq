/**
 * Shared Gemini auth header for every server-side call to the Generative Language API.
 *
 * Gemini also accepts the key as a `?key=` query param, but a URL is captured by tracing,
 * logs, and any middleware that inspects the request line - the header form isn't (see #638).
 */
export function geminiAuthHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey };
}
