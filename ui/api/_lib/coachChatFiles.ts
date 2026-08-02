/**
 * Shared read helpers for the three files coach-chat.ts injects into every Gemini call:
 * SOUL.md, state.md, quest_log.md. Extracted out of coach-chat.ts so coach-chat-context.ts
 * (the app-load preload endpoint, A3) can fetch the same files the same way without
 * duplicating the GitHub-read plumbing.
 */

export const SOUL_FILE_PATH = "propagated/SOUL.md";
export const STATE_FILE_PATH = "user_data/coach/state.md";
export const QUEST_LOG_PATH = "gen/quest_log.md";

// Neither the Gemini call nor the GitHub reads had an explicit cutoff - a stalled upstream call
// left "Coach is thinking" spinning indefinitely instead of failing visibly. 25s leaves headroom
// under Vercel's function timeout while still being well past any real response time.
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

const GH_HEADERS_RAW = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

// A pure read - safe to retry on any transient failure including a raw network error, unlike
// the POST commit path where a lost response after a successful write makes blind retry unsafe.
function isTransientReadFailure(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status == null) return true; // network-level failure
  return status >= 500 || status === 429;
}

export async function getFileRaw(repo: string, path: string, token: string, attempts = 3): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/contents/${path}`, {
        headers: GH_HEADERS_RAW(token),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        // Tagged with .status so the top-level handler can tell an expired/invalid token (401)
        // apart from any other failure and respond 401 instead of a generic 500 - iOS's Bearer
        // auth has no cookie-refresh equivalent, so this is the only signal it gets to re-auth.
        throw Object.assign(new Error(`Failed to fetch ${path} (${res.status})`), { status: res.status });
      }
      return await res.text();
    } catch (err) {
      if (!isTransientReadFailure(err) || attempt === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${path} - unreachable`); // keeps TS happy, loop always returns/throws
}

export interface CoachContext {
  soul: string | null;
  state: string | null;
  questLog: string | null;
}

// A5: cross-device staleness detection. No lock - just compare the repo's HEAD sha the client
// last saw against the actual current one at request time. Cheap (a single small GET, no
// caching - staleness checks need the true current value, not a 60s-old one) and reuses data
// GitHub's API already returns; no new infra.
export async function getHeadSha(repo: string, token: string, branch = "main"): Promise<string> {
  const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Failed to read HEAD (${res.status})`), { status: res.status });
  }
  const body = (await res.json()) as { object: { sha: string } };
  return body.object.sha;
}

// Server-side short-lived cache (A3): a client that just warmed the context via
// coach-chat-context.ts and then immediately opens a greeting turn or sends a message
// shouldn't force a second round-trip to GitHub for the same three files a few seconds later.
// Keyed by repo, not by athlete/token - fine since the content is identical for a given repo
// regardless of which of the athlete's own devices asked.
const CONTEXT_CACHE_TTL_MS = 60_000;
const contextCache = new Map<string, { value: CoachContext; expiresAt: number }>();

export async function loadCoachContext(repo: string, token: string, opts?: { fresh?: boolean }): Promise<CoachContext> {
  const cached = contextCache.get(repo);
  if (!opts?.fresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const [soul, state, questLog] = await Promise.all([
    getFileRaw(repo, SOUL_FILE_PATH, token),
    getFileRaw(repo, STATE_FILE_PATH, token),
    getFileRaw(repo, QUEST_LOG_PATH, token),
  ]);
  const value: CoachContext = { soul, state, questLog };
  contextCache.set(repo, { value, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
  return value;
}

// B2: First Session Protocol completion check. carve-skeleton.mjs ships every new athlete repo
// with this exact blank template (STATE_MD_TEMPLATE):
//
//   ## Athlete Profile
//   *(Filled in during First Session)*
//   - **Name:**
//   - **Sport(s) / Activities:**
//   - **Goal:**
//   - **Timeline / Upcoming events:**
//   - **Coaching style preference:**
//   - **Timezone:**
//
// platform/soul/B_engine.md's boot sequence already treats "only template headings, no data" as
// the trigger for the First Session Protocol - this is the same check, just made programmatic
// (and callable without a shell) so iOS can poll it instead of relying on the
// thread-existence heuristic it used to (dead shouldOpenChatFirst(), see B3).
//
// Deliberately generic rather than hardcoding the six field names above: any `- **Label:**` line
// found inside the Athlete Profile section must have non-blank content after the colon for the
// profile to count as complete, and the section must contain at least one such line at all (an
// entirely missing section, e.g. a malformed state.md, is not "complete" either).
export function isAthleteProfileComplete(stateMd: string): boolean {
  // (?![\s\S]) asserts true end-of-string regardless of the /m flag - a plain $ here would
  // match at the end of the SECTION'S OWN FIRST LINE too (since /m makes $ match every line
  // ending, not just the string's end), truncating the captured section to just its first line.
  const sectionMatch = stateMd.match(/^## Athlete Profile\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m);
  if (!sectionMatch) return false;
  const section = sectionMatch[1];
  const fieldLines = section.match(/^- \*\*[^*]+:\*\*.*$/gm) ?? [];
  if (fieldLines.length === 0) return false;
  return fieldLines.every((line) => {
    const afterColon = line.replace(/^- \*\*[^*]+:\*\*/, "");
    return afterColon.trim().length > 0;
  });
}
