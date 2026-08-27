# _lib/_tests

Tests for shared `ui/api/_lib/*.ts` modules - utilities used by more than one endpoint (coach-chat,
coach-message, waitlist, ...), not scoped to any single feature.

- **`fileEdits.test.ts`** - `fileEdits.ts`'s string/JSON-merge-patch appliers (A7: applying
  Gemini's proposed file changes without asking it to reproduce whole files).
- **`githubGitData.test.ts`** - `githubGitData.ts::commitFilesAtomic`, the single chokepoint every
  writer (coach-chat, coach-message, waitlist) goes through to land a commit in an athlete's repo
  (blob -> tree -> commit -> ref-update). Lives here rather than under any one caller's test tree,
  same reasoning as `fileEdits.test.ts` sitting here: the module isn't coach-chat-specific, so its
  tests shouldn't be nested under coach-chat's test directory either.

**What's mocked in `githubGitData.test.ts`:** `fetchWithTimeout` (from `_lib/httpTimeout.js`),
routed by URL/method to answer the specific GitHub REST calls `commitFilesAtomic` makes. That's
the only fake - the real blob-then-tree-then-commit-then-ref sequence, real payload construction,
real retry-on-non-fast-forward (422 -> retryable), and real atomicity (a failure never reaches the
ref move) all run.

**Start here:** `githubGitData.test.ts`. The atomicity tests (blob/commit create failing outright)
assert the ref PATCH is never called - that's the property the whole "atomic" in
`commitFilesAtomic` is for. The retry test simulates another writer landing a commit between our
HEAD read and our ref move, and confirms the whole operation redoes itself against the new HEAD
rather than silently overwriting it.
