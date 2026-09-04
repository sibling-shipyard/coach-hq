/**
 * Atomic multi-file commit via GitHub's Git Data API (blob -> tree -> commit -> ref).
 *
 * Ports the pattern already proven in ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift's
 * commitFiles() (blobs uploaded first, then read fresh HEAD, build tree, create commit, move
 * the branch ref - retried against fresh HEAD on a non-fast-forward conflict) so every write
 * this repo makes lands in one commit instead of N. See ADR 0012.
 */
import { fetchWithTimeout } from "./httpTimeout.js";
import { withGithubSpan } from "./sentry.js";

const GH_API = "https://api.github.com";

const jsonHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

interface CommitContext {
  repo: string; // "owner/name"
  branch: string;
  token: string;
}

// Previously plain fetch() with no timeout at all - a stalled GitHub write could hang the whole
// function until Vercel's own platform ceiling killed it, with nothing here able to fail fast
// into the withRetry handling below. fetchWithTimeout already tags a timeout as a 504, which
// isTransient() below treats as retryable, so this is a drop-in swap, not new error handling.
// `operation` is a fixed span label (see withGithubSpan) - defaults to `path` for ghPost since
// every ghPost path is already static; ghGet's callers pass one explicitly because several of
// its paths interpolate a branch name or sha.
async function ghPost(
  path: string,
  ctx: CommitContext,
  body: unknown,
  operation: string = path,
): Promise<any> {
  return withGithubSpan(operation, async (setStatus) => {
    const res = await fetchWithTimeout(`${GH_API}/repos/${ctx.repo}${path}`, {
      method: "POST",
      headers: jsonHeaders(ctx.token),
      body: JSON.stringify(body),
    });
    setStatus(res.status);
    if (!res.ok) {
      const detail = await res.text();
      const err = new Error(`GitHub ${path} failed (${res.status}): ${detail}`);
      (err as any).status = res.status;
      throw err;
    }
    return res.json();
  });
}

async function ghGet(path: string, ctx: CommitContext, operation: string): Promise<any> {
  return withGithubSpan(operation, async (setStatus) => {
    const res = await fetchWithTimeout(`${GH_API}/repos/${ctx.repo}${path}`, {
      headers: jsonHeaders(ctx.token),
    });
    setStatus(res.status);
    if (!res.ok) {
      const detail = await res.text();
      const err = new Error(`GitHub ${path} failed (${res.status}): ${detail}`);
      (err as any).status = res.status;
      throw err;
    }
    return res.json();
  });
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status == null) return true; // network-level failure
  return status >= 500 || status === 409 || status === 429 || status === 403;
}

async function withRetry<T>(attempts: number, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === attempts - 1) throw err;
      const delay = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export interface FileWrite {
  path: string;
  content: string;
}

export interface ResolvedFileWrite {
  path: string;
  /** Recomputed fresh on every retry attempt (after HEAD is re-read) instead of once up
   * front - use for content that depends on the file's own current state. */
  resolve: () => Promise<string>;
}

export type FileEntry = FileWrite | ResolvedFileWrite;

function isResolvedEntry(entry: FileEntry): entry is ResolvedFileWrite {
  return typeof (entry as ResolvedFileWrite).resolve === "function";
}

/**
 * Commits every file in `files` in a single atomic commit. Static entries' blobs are uploaded
 * once up front (content-addressed, safe to reuse across retries). Resolved entries recompute
 * their content - and re-upload a fresh blob for it - on every retry attempt, so a genuine
 * conflict (another writer landed a commit between our HEAD read and our ref move) is retried
 * against that writer's result instead of silently overwriting it. The ref-move step itself is
 * retried on a non-fast-forward conflict (422 is treated as retryable, same as iOS).
 */
export async function commitFilesAtomic(
  files: FileEntry[],
  message: string,
  ctx: CommitContext,
): Promise<{ commitSha: string }> {
  if (files.length === 0) throw new Error("commitFilesAtomic called with no files");

  const staticEntries = files.filter((f): f is FileWrite => !isResolvedEntry(f));
  const resolvedEntries = files.filter(isResolvedEntry);

  const staticBlobs: { path: string; sha: string }[] = [];
  for (const file of staticEntries) {
    const blob = await withRetry(3, () =>
      ghPost("/git/blobs", ctx, {
        content: btoa(unescape(encodeURIComponent(file.content))),
        encoding: "base64",
      }),
    );
    staticBlobs.push({ path: file.path, sha: blob.sha });
  }

  return withRetry(3, async () => {
    const resolvedBlobs: { path: string; sha: string }[] = [];
    for (const entry of resolvedEntries) {
      const content = await entry.resolve();
      const blob = await ghPost("/git/blobs", ctx, {
        content: btoa(unescape(encodeURIComponent(content))),
        encoding: "base64",
      });
      resolvedBlobs.push({ path: entry.path, sha: blob.sha });
    }
    const blobs = [...staticBlobs, ...resolvedBlobs];

    const ref = await ghGet(`/git/ref/heads/${ctx.branch}`, ctx, "git/ref/heads");
    const headSha: string = ref.object.sha;

    const headCommit = await ghGet(`/git/commits/${headSha}`, ctx, "git/commits/read");
    const baseTreeSha: string = headCommit.tree.sha;

    const tree = await ghPost("/git/trees", ctx, {
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
    });

    const commit = await ghPost("/git/commits", ctx, {
      message,
      tree: tree.sha,
      parents: [headSha],
    });

    try {
      await withGithubSpan("git/refs/heads/move", async (setStatus) => {
        const res = await fetchWithTimeout(
          `${GH_API}/repos/${ctx.repo}/git/refs/heads/${ctx.branch}`,
          {
            method: "PATCH",
            headers: jsonHeaders(ctx.token),
            body: JSON.stringify({ sha: commit.sha }),
          },
        );
        setStatus(res.status);
        if (!res.ok) {
          const detail = await res.text();
          const status = res.status === 422 ? 409 : res.status; // 422 non-FF => retryable, same as iOS
          const err = new Error(`Failed to update ref heads/${ctx.branch} (${status}): ${detail}`);
          (err as any).status = status;
          throw err;
        }
      });
    } catch (err) {
      // A network-level failure here (fetch() itself threw - timeout, connection reset) means
      // we genuinely don't know whether the ref move landed before the response was lost. The
      // withRetry wrapper would otherwise redo blob/tree/commit/ref from scratch on the
      // assumption nothing happened - but if the PATCH above actually succeeded server-side,
      // that would double-commit. Check first: if the ref already points at the commit we just
      // tried to move it to, our write landed - treat it as success instead of retrying.
      // A 504 here is fetchWithTimeout's own abort tag (see httpTimeout.ts), not a real
      // GitHub response - exactly the same "we don't know what happened" case as a raw network
      // error (status == null), so it needs the same recheck rather than blindly retrying.
      const status = (err as { status?: number }).status;
      if (status == null || status === 504) {
        const recheck = await ghGet(
          `/git/ref/heads/${ctx.branch}`,
          ctx,
          "git/ref/heads/recheck",
        ).catch(() => null);
        if (recheck?.object?.sha === commit.sha) {
          return { commitSha: commit.sha as string };
        }
      }
      throw err;
    }

    return { commitSha: commit.sha as string };
  });
}
