/**
 * Shared read helpers for the files coach-chat.ts injects into every Gemini call: profile.json/
 * memory.json/injuries.json/coach_log.json and quest_log.md come from the athlete's own repo;
 * SOUL.md does not (see below). Extracted out of coach-chat.ts so coach-chat-context.ts (the
 * app-load preload endpoint, A3) can fetch the same files the same way without duplicating the
 * GitHub-read plumbing.
 */
import { SOUL } from "../../_generated/soul.js";
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";
import {
  PROFILE_PATH,
  MEMORY_PATH,
  INJURIES_PATH,
  COACH_LOG_PATH,
  type ProfileJson,
  type MemoryJson,
  type InjuriesJson,
  type CoachLogJson,
} from "./coachMemoryFiles.js";
import {
  SEASONS_PATH,
  QUESTS_PATH,
  PROGRESS_PATH,
  PROGRESSIONS_PATH,
  type SeasonsJson,
  type QuestsJson,
  type ProgressJson,
  type ProgressionsJson,
} from "./coachQuestFiles.js";

// SOUL.md is 100% generic across athletes, so it's bundled at build time (ui/scripts/build-
// soul.mjs) rather than fetched from each athlete's repo per turn - see the ADR amending 0011.

const GH_HEADERS_RAW = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

// COACH_CHAT_BRANCH lets a real close be tested end to end on a scratch branch instead of a
// live athlete's main. Every read (this file) and write (commitFilesAtomic's branch option in
// coach-chat.ts) must resolve the same way, or a scratch-branch test silently reads real main
// content while writing to the scratch branch - found and fixed after exactly that happened
// (coach_notes.md kept re-appending from main's stale baseline instead of building on the
// previous test commit).
export function resolveCoachChatBranch(): string {
  return process.env.COACH_CHAT_BRANCH ?? "main";
}

// A pure read - safe to retry on any transient failure including a raw network error, unlike
// the POST commit path where a lost response after a successful write makes blind retry unsafe.
function isTransientReadFailure(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status == null) return true; // network-level failure
  return status >= 500 || status === 429;
}

export async function getFileRaw(repo: string, path: string, token: string, attempts = 3): Promise<string | null> {
  const ref = encodeURIComponent(resolveCoachChatBranch());
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`, {
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
  profile: ProfileJson | null;
  memory: MemoryJson | null;
  injuries: InjuriesJson | null;
  coachLog: CoachLogJson | null;
  // Part 2 ledger split: replaces challenge_v2.json and gen/quest_log.md - these four feed
  // renderQuestContext (coachContext.ts) directly. Found in review: quest_log.md was still being
  // fetched here (dead network call every turn) after nothing was left reading it - removed.
  seasons: SeasonsJson | null;
  quests: QuestsJson | null;
  progress: ProgressJson | null;
  progressions: ProgressionsJson | null;
}

// Best-effort parse - a missing or malformed file (not yet migrated, or a transient bad commit)
// degrades to null rather than throwing. Exported so coachIntents.ts's appliers share this same
// parse+catch instead of each hand-rolling their own copy.
export function parseJsonOrNull<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Cross-device staleness detection (A5): no lock, just compares the client's last-known HEAD sha
// against the current one. Never cached - staleness checks need the true current value.
export async function getHeadSha(repo: string, token: string, branch = resolveCoachChatBranch()): Promise<string> {
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
const contextCacheGeneration = new Map<string, number>();

// Shares one fetch across concurrent cache-miss callers for the same repo (e.g. web preload and
// an iOS greet() firing together) instead of each hitting GitHub independently.
const inFlight = new Map<string, Promise<CoachContext>>();

// A successful server-side write makes this process's cached pre-write snapshot stale even when
// the client already knows the new HEAD sha. Incrementing the generation also prevents an older
// concurrent fetch from repopulating the cache after invalidation.
export function invalidateCoachContext(repo: string): void {
  contextCache.delete(repo);
  contextCacheGeneration.set(repo, (contextCacheGeneration.get(repo) ?? 0) + 1);
  inFlight.delete(repo);
}

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

  const generation = contextCacheGeneration.get(repo) ?? 0;
  const promise = (async (): Promise<CoachContext> => {
    const [profileRaw, memoryRaw, injuriesRaw, coachLogRaw, seasonsRaw, questsRaw, progressRaw, progressionsRaw] =
      await Promise.all([
        getFileRaw(repo, PROFILE_PATH, token),
        getFileRaw(repo, MEMORY_PATH, token),
        getFileRaw(repo, INJURIES_PATH, token),
        getFileRaw(repo, COACH_LOG_PATH, token),
        getFileRaw(repo, SEASONS_PATH, token),
        getFileRaw(repo, QUESTS_PATH, token),
        getFileRaw(repo, PROGRESS_PATH, token),
        getFileRaw(repo, PROGRESSIONS_PATH, token),
      ]);
    const value: CoachContext = {
      soul: SOUL,
      profile: parseJsonOrNull<ProfileJson>(profileRaw),
      memory: parseJsonOrNull<MemoryJson>(memoryRaw),
      injuries: parseJsonOrNull<InjuriesJson>(injuriesRaw),
      coachLog: parseJsonOrNull<CoachLogJson>(coachLogRaw),
      seasons: parseJsonOrNull<SeasonsJson>(seasonsRaw),
      quests: parseJsonOrNull<QuestsJson>(questsRaw),
      progress: parseJsonOrNull<ProgressJson>(progressRaw),
      progressions: parseJsonOrNull<ProgressionsJson>(progressionsRaw),
    };
    if ((contextCacheGeneration.get(repo) ?? 0) === generation) {
      contextCache.set(repo, { value, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS });
    }
    return value;
  })();

  if (!opts?.fresh) inFlight.set(repo, promise);
  try {
    return await promise;
  } finally {
    if (!opts?.fresh && inFlight.get(repo) === promise) inFlight.delete(repo);
  }
}

// B2/coach-redesign-part1-memory.md: First Session Protocol completion check. Used to be a
// regex/section-matching read of state.md's Athlete Profile section (see git history) - now a
// field-presence check across profile.json, memory.json, and seasons.json. First Session is done
// only after all profile basics, at least one sport, a real coaching-style enum, and a matching
// current season exist. Quests stay optional by design.
export function isAthleteProfileComplete(
  profile: ProfileJson | null,
  memory: MemoryJson | null,
  seasons: SeasonsJson | null,
): boolean {
  if (!profile || !memory || !seasons) return false;
  const hasName = Boolean(profile.name && profile.name.trim().length > 0);
  const hasDob = Boolean(profile.dob && profile.dob.trim().length > 0);
  const hasTimezone = Boolean(profile.timezone && profile.timezone.trim().length > 0);
  const hasHeight = profile.height_cm != null;
  const hasWeight = profile.weight_kg != null;
  const hasSport = Array.isArray(memory.sports) && memory.sports.some((s) => s.trim().length > 0);
  const hasCoachingStyle = ["accountability", "encouragement", "analysis"].includes(memory.coaching_style ?? "");
  const hasCurrentSeason = Boolean(
    seasons.current_season_id && seasons.seasons.some((season) => season.id === seasons.current_season_id),
  );
  return hasName && hasDob && hasTimezone && hasHeight && hasWeight && hasSport && hasCoachingStyle && hasCurrentSeason;
}

// isAthleteProfileComplete deliberately excludes quests - some athletes don't want them, and
// that gate also unlocks daily chat, so it can't wait on an optional field. But the same boolean
// was also the only thing deciding whether <first_session> prompt guidance kept showing - so the
// instant profile/sports/style/season landed, FSP context vanished even if quest-setup (SOUL's
// own Step 4) hadn't happened yet. Live testing: an athlete stated habit quests on the same turn
// that completed their profile, and quest_create never fired because firstSessionContext() had
// already stopped injecting by then. This is the bounded fix - main_quest is meant to be set
// exactly once per athlete (habit quests are optional, main_quest isn't), so this naturally
// resolves to false forever once it's ever set, same as isAthleteProfileComplete does for its
// own fields - no risk of a quest-declining athlete getting stuck in FSP mode permanently.
export function isFirstSessionRitualDone(
  profile: ProfileJson | null,
  memory: MemoryJson | null,
  seasons: SeasonsJson | null,
  quests: QuestsJson | null,
): boolean {
  return isAthleteProfileComplete(profile, memory, seasons) && Boolean(quests?.main_quest);
}
