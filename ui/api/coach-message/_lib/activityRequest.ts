import { isObject, type ActivityFileEntry } from "../../_lib/activityLookup.js";
import { fetchWithTimeout } from "../../_lib/httpTimeout.js";
import { getHeadSha, resolveCoachChatBranch } from "../../coach-chat/_lib/decide/coachChatFiles.js";

const GITHUB_API = "https://api.github.com";

export const MAX_ACTIVITY_IDS = 20;
const MAX_ACTIVITY_ID_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 360;
const MAX_SENTENCE_LENGTH = 180;

const HEALTHKIT_ACTIVITY_ID =
  /^healthkit:[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const STRAVA_ACTIVITY_ID = /^strava:[0-9]{1,32}$/;

export type { ActivityFileEntry };

export class CoachMessageError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
  }
}

export function parseActivityHistoryTree(payload: unknown): ActivityFileEntry[] {
  if (!isObject(payload)) {
    throw new CoachMessageError("GitHub activity tree is malformed", 502);
  }
  if (payload.truncated === true) {
    throw new CoachMessageError("GitHub activity tree was truncated", 502);
  }
  if (payload.truncated !== false || !Array.isArray(payload.tree)) {
    throw new CoachMessageError("GitHub activity tree is malformed", 502);
  }
  const prefix = "user_data/activities/hist/";
  return payload.tree.flatMap((entry): ActivityFileEntry[] => {
    if (!isObject(entry) || entry.type !== "blob" || typeof entry.path !== "string") {
      return [];
    }
    if (!entry.path.startsWith(prefix)) return [];
    const name = entry.path.slice(prefix.length);
    if (!name || name.includes("/")) return [];
    return [{ name, path: entry.path }];
  });
}

/**
 * Recursive Git tree read (not the 1,000-entry-capped Contents API `listDirectory` used
 * elsewhere) so a large `user_data/activities/hist/` directory never silently truncates the
 * authoritative activity list. Shared by the /api/coach-message route and activitySyncTurn.ts's
 * post-sync generation, since both now call `loadProactiveContext` for the same batch.
 */
export async function listActivityFiles(repo: string, token: string): Promise<ActivityFileEntry[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const readGitJson = async (path: string): Promise<unknown> => {
    const response = await fetchWithTimeout(`${GITHUB_API}/repos/${repo}${path}`, { headers });
    if (!response.ok) {
      throw Object.assign(new Error(`Failed to read GitHub tree (${response.status})`), {
        status: response.status,
      });
    }
    return response.json() as Promise<unknown>;
  };

  const branch = resolveCoachChatBranch();
  const headSha = await getHeadSha(repo, token, branch);
  const commit = await readGitJson(`/git/commits/${encodeURIComponent(headSha)}`);
  if (
    !commit ||
    typeof commit !== "object" ||
    !("tree" in commit) ||
    !commit.tree ||
    typeof commit.tree !== "object" ||
    !("sha" in commit.tree) ||
    typeof commit.tree.sha !== "string"
  ) {
    throw new CoachMessageError("GitHub commit tree is malformed", 502);
  }
  const tree = await readGitJson(`/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`);
  return parseActivityHistoryTree(tree);
}

export function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringValue(value: unknown, maxLength = 1_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

export function valuesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStrictActivityId(value: string): boolean {
  return (
    value.length <= MAX_ACTIVITY_ID_LENGTH &&
    (HEALTHKIT_ACTIVITY_ID.test(value) || STRAVA_ACTIVITY_ID.test(value))
  );
}

export function validateActivityIdsPayload(payload: unknown): string[] {
  if (!isObject(payload)) {
    throw new CoachMessageError("Request body must be a JSON object", 400);
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "activity_ids") {
    throw new CoachMessageError("Request body must contain only activity_ids", 400);
  }
  const ids = payload.activity_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ACTIVITY_IDS) {
    throw new CoachMessageError(
      `activity_ids must contain between 1 and ${MAX_ACTIVITY_IDS} items`,
      400,
    );
  }
  if (
    !ids.every((value): value is string => typeof value === "string" && isStrictActivityId(value))
  ) {
    throw new CoachMessageError(
      "activity_ids must use canonical healthkit:<UUID> or strava:<id> values",
      400,
    );
  }
  const sorted = [...ids].sort();
  if (!valuesEqual(ids, sorted) || new Set(ids).size !== ids.length) {
    throw new CoachMessageError("activity_ids must be unique and sorted", 400);
  }
  return ids;
}

export async function parseActivityIdsRequest(req: Request): Promise<string[]> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    throw new CoachMessageError("Request body is too large", 413);
  }
  const raw = await req.text();
  if (raw.length > 16_384) {
    throw new CoachMessageError("Request body is too large", 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new CoachMessageError("Request body must be valid JSON", 400);
  }
  return validateActivityIdsPayload(payload);
}

export function validateGeneratedBody(value: unknown): string {
  if (typeof value !== "string") {
    throw new CoachMessageError("Gemini response body must be a string", 502);
  }
  const body = value.trim();
  if (!body || body.length > MAX_MESSAGE_LENGTH || /[\r\n]/.test(body)) {
    throw new CoachMessageError(
      `Gemini response must be one paragraph of 1-${MAX_MESSAGE_LENGTH} characters`,
      502,
    );
  }
  if (body.includes("—")) {
    throw new CoachMessageError("Gemini response must not contain an em dash", 502);
  }
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (
    sentences.length < 1 ||
    sentences.length > 3 ||
    sentences.some((sentence) => sentence.length > MAX_SENTENCE_LENGTH)
  ) {
    throw new CoachMessageError("Gemini response must contain 1-3 short sentences", 502);
  }
  return body;
}

// A batch with a thread already open when the sync completed points conversation_seed_id at
// that real chat-thread id (buildActivitySyncThread's `t-<epoch ms>`) instead of minting
// `local-proactive-<id>` - one generator, one thread id (#918). Both shapes are valid.
export const THREAD_SEED_ID = /^t-[0-9]+$/;

export function isValidConversationSeedId(seedId: string, id: string): boolean {
  return seedId === `local-proactive-${id}` || THREAD_SEED_ID.test(seedId);
}
