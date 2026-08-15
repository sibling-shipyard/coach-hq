/**
 * Generic fetch-with-timeout wrapper - not coach-chat specific. Used by anything making an
 * upstream HTTP call that could otherwise hang indefinitely (GitHub reads/writes, Gemini calls).
 * Split out of what used to be coachChatFiles.ts so githubGitData.ts (used well beyond coach-chat)
 * doesn't have to depend on a coach-chat-specific module for a generic utility.
 */

// Neither GitHub reads nor Gemini calls had an explicit cutoff before this existed - a stalled
// upstream call left a UI spinner running indefinitely instead of failing visibly. 25s leaves
// headroom under Vercel's function timeout while still being well past any real response time.
export const UPSTREAM_TIMEOUT_MS = 25_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw Object.assign(new Error(`Request to ${new URL(url).hostname} timed out`), { status: 504 });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
