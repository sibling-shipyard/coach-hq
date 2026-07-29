/**
 * Atomic multi-file commit via GitHub's Git Data API (blob -> tree -> commit -> ref).
 *
 * Ports the pattern already proven in ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift's
 * commitFiles() (blobs uploaded first, then read fresh HEAD, build tree, create commit, move
 * the branch ref - retried against fresh HEAD on a non-fast-forward conflict) so every write
 * this repo makes lands in one commit instead of N. See ADR 0012.
 */

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

async function ghPost(path: string, ctx: CommitContext, body: unknown): Promise<any> {
  const res = await fetch(`${GH_API}/repos/${ctx.repo}${path}`, {
    method: "POST",
    headers: jsonHeaders(ctx.token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`GitHub ${path} failed (${res.status}): ${detail}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

async function ghGet(path: string, ctx: CommitContext): Promise<any> {
  const res = await fetch(`${GH_API}/repos/${ctx.repo}${path}`, {
    headers: jsonHeaders(ctx.token),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error(`GitHub ${path} failed (${res.status}): ${detail}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
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

/**
 * Commits every file in `files` in a single atomic commit. Blobs are uploaded once up front
 * (content-addressed, safe to reuse across retries); the ref-move step is retried against a
 * fresh HEAD/tree on a non-fast-forward conflict (422 is treated as retryable, same as iOS).
 */
export async function commitFilesAtomic(
  files: FileWrite[],
  message: string,
  ctx: CommitContext,
): Promise<{ commitSha: string }> {
  if (files.length === 0) throw new Error("commitFilesAtomic called with no files");

  const blobs: { path: string; sha: string }[] = [];
  for (const file of files) {
    const blob = await withRetry(3, () =>
      ghPost("/git/blobs", ctx, {
        content: btoa(unescape(encodeURIComponent(file.content))),
        encoding: "base64",
      }),
    );
    blobs.push({ path: file.path, sha: blob.sha });
  }

  return withRetry(3, async () => {
    const ref = await ghGet(`/git/ref/heads/${ctx.branch}`, ctx);
    const headSha: string = ref.object.sha;

    const headCommit = await ghGet(`/git/commits/${headSha}`, ctx);
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

    const res = await fetch(`${GH_API}/repos/${ctx.repo}/git/refs/heads/${ctx.branch}`, {
      method: "PATCH",
      headers: jsonHeaders(ctx.token),
      body: JSON.stringify({ sha: commit.sha }),
    });
    if (!res.ok) {
      const detail = await res.text();
      const status = res.status === 422 ? 409 : res.status; // 422 non-FF => retryable, same as iOS
      const err = new Error(`Failed to update ref heads/${ctx.branch} (${status}): ${detail}`);
      (err as any).status = status;
      throw err;
    }

    return { commitSha: commit.sha as string };
  });
}
