/**
 * Shared Gemini base URL and auth header for every server-side call to the Generative Language
 * API - same shotgun-surgery risk as GEMINI_MODEL (geminiModel.ts) if each call site hardcodes
 * its own copy instead of importing this one.
 *
 * Gemini also accepts the key as a `?key=` query param, but a URL is captured by tracing,
 * logs, and any middleware that inspects the request line - the header form isn't (see #638).
 */
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export function geminiAuthHeaders(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey };
}
