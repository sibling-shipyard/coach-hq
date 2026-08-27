# layer3-commit

Tests `ui/api/_lib/githubGitData.ts::commitFilesAtomic` — the single chokepoint every coach-chat
write goes through to land in the athlete's repo (blob -> tree -> commit -> ref-update).

**What's mocked:** `fetchWithTimeout` (from `_lib/httpTimeout.js`), routed by URL/method to answer
the specific GitHub REST calls `commitFilesAtomic` makes. That's the only fake — the real
blob-then-tree-then-commit-then-ref sequence, real payload construction, real
retry-on-non-fast-forward (422 -> retryable), and real atomicity (a failure never reaches the ref
move) all run.

**Start here:** `githubGitData.test.ts`. The atomicity tests (blob/commit create failing outright)
assert the ref PATCH is never called — that's the property the whole "atomic" in
`commitFilesAtomic` is for. The retry test simulates another writer landing a commit between our
HEAD read and our ref move, and confirms the whole operation redoes itself against the new HEAD
rather than silently overwriting it.

**Watch-out:** if a test here ever fails with a real HTTP error instead of your canned response, an
off-by-one `../` in the `vi.mock("../../../_lib/httpTimeout.js", ...)` path let a real `fetch` slip
through. That path has to resolve to `ui/api/_lib/httpTimeout.js` exactly, matching the depth
`githubGitData.ts` itself uses to import it — a wrong depth doesn't error, it just silently mocks
nothing.
