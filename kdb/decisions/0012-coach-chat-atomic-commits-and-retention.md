# 0012 — Coach chat: atomic commits via Git Data API, count-based retention

- **Status:** Superseded by 0037 · 2026-07-29 · Tech Lead · retention tier revised by 0032, then
  this ADR's count-based retention itself superseded by 0037 (full retention in storage, cap
  moved to response time); the atomic-commit Git Data API pattern below is unaffected and still
  stands
- **Area:** cross-cutting
- **Context:** Closing a coach-chat session called `putFile()` once per changed file and once
  more for `chat_history.json` — several commits for what is one save. iOS had already solved
  this for HealthKit sync: `GitHubAPIClient.commitFiles()` lands many files in one commit through
  GitHub's Git Data API, retrying on conflict. Retention was a second problem. Purging by
  calendar age let `chat_history.json` grow without bound between purges.
- **Decision:** Port the Git Data API pattern to TypeScript as
  `ui/api/_lib/githubGitData.ts`, exporting `commitFilesAtomic()`, and route every repo write
  coach-chat makes through it. Replace the calendar purge with a count cap: keep the 7
  most-recently-active threads, enforced server-side on write so a read never rewrites the file.
- **Why:** One atomic commit per close is what the athlete asked for, and iOS already proved the
  pattern. A count cap bounds the file predictably; two calendar windows did not.
- **Rejected:** Share one Git Data API implementation across TypeScript and Swift → no way to
  share code across those runtimes without a build layer neither app has; kept as two
  implementations of one documented pattern instead · Keep calendar retention → does not bound
  file size.
- **Enforces:** A session close is one commit. Never write repo files in a loop where a reader
  could observe a half-finished save.
- **Amendment (2026-07-29):** The first design still overwrote `chat_history.json` from a
  snapshot read before the commit, which is a lost-update race. `commitFilesAtomic` now takes a
  `ResolvedFileWrite` whose content is recomputed on every retry, so a losing attempt retries
  against what the winner committed. Retrying the send-message request itself is unsafe on a raw
  network failure — the commit may already have landed — so that retry fires only on a confirmed
  5xx or 429.
