/**
 * Shared read helpers for the files coach-chat.ts injects into every Gemini call: state.md and
 * quest_log.md come from the athlete's own repo; SOUL.md does not (see below). Extracted out of
 * coach-chat.ts so coach-chat-context.ts (the app-load preload endpoint, A3) can fetch the same
 * files the same way without duplicating the GitHub-read plumbing.
 */
import { SOUL } from "../../_generated/soul.js";
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";

// SOUL.md is 100% generic across athletes, so it's bundled at build time (ui/scripts/build-
// soul.mjs) rather than fetched from each athlete's repo per turn - see the ADR amending 0011.
export const STATE_FILE_PATH = "user_data/coach/state.md";
export const QUEST_LOG_PATH = "gen/quest_log.md";

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
        // .status lets the top-level handler tell a 401 (expired token) apart from other
        // failures - iOS's Bearer auth has no cookie-refresh, so this is its only re-auth signal.
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

// Cross-device staleness detection (A5): no lock, just compares the client's last-known HEAD sha
// against the current one. Never cached - staleness checks need the true current value.
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

// Server-side short-lived cache (A3): a client that just warmed context via coach-chat-
// context.ts shouldn't force a second GitHub round-trip seconds later. Keyed by repo, not
// athlete/token - content is identical regardless of which device asked.
const CONTEXT_CACHE_TTL_MS = 60_000;
const contextCache = new Map<string, { value: CoachContext; expiresAt: number }>();

// Shares one fetch across concurrent cache-miss callers for the same repo (e.g. web preload and
// an iOS greet() firing together) instead of each hitting GitHub independently.
const inFlight = new Map<string, Promise<CoachContext>>();

export async function loadCoachContext(repo: string, token: string, opts?: { fresh?: boolean }): Promise<CoachContext> {
  const cached = contextCache.get(repo);
  if (!opts?.fresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // fresh: true (A5 staleness recovery) always wants its own real fetch, never a shared
  // in-flight one from a `fresh: false` caller that started moments earlier.
  if (!opts?.fresh) {
    const pending = inFlight.get(repo);
    if (pending) return pending;
  }

  const promise = (async (): Promise<CoachContext> => {
    const [state, questLog] = await Promise.all([
      getFileRaw(repo, STATE_FILE_PATH, token),
      getFileRaw(repo, QUEST_LOG_PATH, token),
    ]);
    const value: CoachContext = { soul: SOUL, state, questLog };
    contextCache.set(repo, { value, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
    return value;
  })();

  if (!opts?.fresh) inFlight.set(repo, promise);
  try {
    return await promise;
  } finally {
    if (!opts?.fresh) inFlight.delete(repo);
  }
}

// B2: First Session Protocol completion check - is state.md's Athlete Profile section still
// carve-skeleton.mjs's blank template? Deliberately generic rather than hardcoding field names:
// every `- **Label:**` line in the section must have non-blank content after the colon, and the
// section must contain at least one such line.
/**
 * Label fragments (lowercased, substring-matched) for the fields that actually gate coaching.
 *
 * #362: this used to require EVERY field in the Athlete Profile, including Age, Height and
 * Weight. An athlete who declined to give their weight never became complete. That was harmless
 * while the flag only stamped `coach_since` - but the First Session Protocol is now conditionally
 * injected on that same predicate, so an incomplete profile means Coach is told "this is their
 * first session, run the protocol instead of coaching normally" on every turn, forever. It
 * re-onboards someone it already onboarded.
 *
 * Everything not listed here is useful context the athlete is allowed to decline.
 */
const REQUIRED_PROFILE_FIELDS = ["name", "sport", "goal"];

export function isAthleteProfileComplete(stateMd: string): boolean {
  // (?![\s\S]) asserts true end-of-string regardless of the /m flag - a plain $ here would
  // match at the end of the SECTION'S OWN FIRST LINE too (since /m makes $ match every line
  // ending, not just the string's end), truncating the captured section to just its first line.
  const sectionMatch = stateMd.match(/^## Athlete Profile\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m);
  if (!sectionMatch) return false;
  const section = sectionMatch[1];
  const fieldLines = section.match(/^- \*\*[^*]+:\*\*.*$/gm) ?? [];
  if (fieldLines.length === 0) return false;

  const fields = fieldLines.map((line) => ({
    label: (line.match(/^- \*\*([^*]+):\*\*/)?.[1] ?? "").toLowerCase(),
    value: line.replace(/^- \*\*[^*]+:\*\*/, "").trim(),
  }));

  const required = fields.filter((field) =>
    REQUIRED_PROFILE_FIELDS.some((needle) => field.label.includes(needle)),
  );

  // An unrecognised profile shape - none of the required labels present at all - falls back to
  // "did the athlete answer anything". Blocking forever on labels this athlete's template does
  // not use is the exact failure #362 is about, so never let a renamed heading recreate it.
  if (required.length === 0) return fields.some((field) => field.value.length > 0);

  return required.every((field) => field.value.length > 0);
}
