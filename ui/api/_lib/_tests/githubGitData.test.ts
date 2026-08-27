import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the network edge is faked: fetchWithTimeout is the sole boundary commitFilesAtomic
// crosses to GitHub. The real blob -> tree -> commit -> ref sequence, real payload construction,
// and real retry-on-non-fast-forward logic all run against these canned responses.
const { fetchWithTimeout } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}));
vi.mock("../httpTimeout.js", () => ({
  fetchWithTimeout,
  UPSTREAM_TIMEOUT_MS: 25_000,
}));

import { commitFilesAtomic, type FileEntry } from "../githubGitData.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const ctx = { repo: "owner/repo", branch: "main", token: "test-token" };

// One shared, minimal happy-path router: reads always see HEAD "head-sha-1" / tree "tree-sha-1";
// blob/tree/commit creates each return a fixed sha; the ref PATCH succeeds. Tests override
// individual routes to exercise a specific failure/retry.
function baseRouter(overrides: Record<string, (url: string, init: RequestInit) => Response | null> = {}) {
  let blobCounter = 0;
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit) => {
    const method = init?.method ?? "GET";
    for (const [key, handler] of Object.entries(overrides)) {
      if (url.includes(key)) {
        const res = handler(url, init);
        if (res) return res;
      }
    }
    if (url.endsWith("/git/ref/heads/main")) return jsonResponse(200, { object: { sha: "head-sha-1" } });
    if (url.includes("/git/commits/head-sha-1")) return jsonResponse(200, { tree: { sha: "tree-sha-1" } });
    if (method === "POST" && url.endsWith("/git/blobs")) {
      blobCounter += 1;
      return jsonResponse(201, { sha: `blob-sha-${blobCounter}` });
    }
    if (method === "POST" && url.endsWith("/git/trees")) return jsonResponse(201, { sha: "new-tree-sha" });
    if (method === "POST" && url.endsWith("/git/commits")) return jsonResponse(201, { sha: "new-commit-sha" });
    if (method === "PATCH" && url.endsWith("/git/refs/heads/main")) return jsonResponse(200, { object: { sha: "new-commit-sha" } });
    throw new Error(`unhandled request in test: ${method} ${url}`);
  });
}

describe("commitFilesAtomic", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  it("throws on an empty file list without making any request", async () => {
    await expect(commitFilesAtomic([], "empty commit", ctx)).rejects.toThrow("commitFilesAtomic called with no files");
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("uploads one blob per file, builds one tree off fresh HEAD, one commit, and moves the ref", async () => {
    baseRouter();
    const files: FileEntry[] = [
      { path: "user_data/coach/profile.json", content: "{}" },
      { path: "user_data/coach/chat_history.json", content: "[]" },
    ];

    const result = await commitFilesAtomic(files, "test commit", ctx);

    expect(result).toEqual({ commitSha: "new-commit-sha" });
    const calls = fetchWithTimeout.mock.calls.map(([url, init]) => `${(init as RequestInit)?.method ?? "GET"} ${url}`);
    expect(calls.filter((c) => c.endsWith("/git/blobs"))).toHaveLength(2);
    expect(calls.filter((c) => c.endsWith("/git/trees"))).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith("/git/commits") && c.startsWith("POST"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/git/refs/heads/main"))).toHaveLength(1);

    const [, treeInit] = fetchWithTimeout.mock.calls.find(([url]) => (url as string).endsWith("/git/trees"))!;
    const treeBody = JSON.parse((treeInit as RequestInit).body as string);
    expect(treeBody.base_tree).toBe("tree-sha-1");
    expect(treeBody.tree.map((t: { path: string }) => t.path)).toEqual([
      "user_data/coach/profile.json",
      "user_data/coach/chat_history.json",
    ]);
  });

  it("recomputes a resolved entry's content fresh, not just once, and includes it in the tree", async () => {
    baseRouter();
    const resolve = vi.fn(async () => "resolved-content");
    const files: FileEntry[] = [{ path: "user_data/coach/coach_log.json", resolve }];

    await commitFilesAtomic(files, "resolved write", ctx);

    expect(resolve).toHaveBeenCalledTimes(1);
    const [, treeInit] = fetchWithTimeout.mock.calls.find(([url]) => (url as string).endsWith("/git/trees"))!;
    const treeBody = JSON.parse((treeInit as RequestInit).body as string);
    expect(treeBody.tree).toEqual([{ path: "user_data/coach/coach_log.json", mode: "100644", type: "blob", sha: "blob-sha-1" }]);
  });

  it("retries the whole operation against fresh HEAD when the ref move hits a non-fast-forward conflict", async () => {
    let refReads = 0;
    let refPatches = 0;
    baseRouter({
      "/git/ref/heads/main": (url, init) => {
        if ((init?.method ?? "GET") === "PATCH") return null; // let the dedicated PATCH branch below handle it
        refReads += 1;
        // Second read (the retry) sees a HEAD another writer advanced past head-sha-1.
        return jsonResponse(200, { object: { sha: refReads === 1 ? "head-sha-1" : "head-sha-2" } });
      },
      "/git/commits/head-sha-2": () => jsonResponse(200, { tree: { sha: "tree-sha-2" } }),
      "/git/refs/heads/main": (url, init) => {
        if ((init?.method ?? "GET") !== "PATCH") return null;
        refPatches += 1;
        if (refPatches === 1) return jsonResponse(422, { message: "not a fast-forward" });
        return jsonResponse(200, { object: { sha: "new-commit-sha" } });
      },
    });
    const files: FileEntry[] = [{ path: "user_data/coach/profile.json", content: "{}" }];

    const result = await commitFilesAtomic(files, "retried commit", ctx);

    expect(result).toEqual({ commitSha: "new-commit-sha" });
    expect(refReads).toBe(2);
    expect(refPatches).toBe(2);
  }, 10_000);

  it("surfaces a blob-create failure and never attempts the ref update (atomicity)", async () => {
    baseRouter({
      "/git/blobs": () => jsonResponse(500, { message: "internal error" }),
    });
    const files: FileEntry[] = [{ path: "user_data/coach/profile.json", content: "{}" }];

    await expect(commitFilesAtomic(files, "failing commit", ctx)).rejects.toThrow(/git\/blobs failed \(500\)/);

    const refPatchCalls = fetchWithTimeout.mock.calls.filter(
      ([url, init]) => (init as RequestInit)?.method === "PATCH" && (url as string).includes("/git/refs/"),
    );
    expect(refPatchCalls).toHaveLength(0);
  }, 10_000);

  it("surfaces a commit-create failure and never attempts the ref update (atomicity)", async () => {
    baseRouter({
      "/git/commits": (url, init) => ((init?.method ?? "GET") === "POST" ? jsonResponse(500, { message: "internal error" }) : null),
    });
    const files: FileEntry[] = [{ path: "user_data/coach/profile.json", content: "{}" }];

    await expect(commitFilesAtomic(files, "failing commit", ctx)).rejects.toThrow(/git\/commits failed \(500\)/);

    const refPatchCalls = fetchWithTimeout.mock.calls.filter(
      ([url, init]) => (init as RequestInit)?.method === "PATCH" && (url as string).includes("/git/refs/"),
    );
    expect(refPatchCalls).toHaveLength(0);
  }, 10_000);
});
