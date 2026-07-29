# 0012 — Coach chat: atomic commits via Git Data API, count-based retention

- **Status:** Accepted · 2026-07-29 · Tech Lead
- **Area:** cross-cutting
- **Context:** `ui/api/coach-chat.ts` closes a session by calling `putFile()` once per changed
  file plus once more for `chat_history.json` (`coach-chat.ts:460-470`) — a multi-commit close
  instead of one atomic save. iOS already solved the same problem correctly for HealthKit sync:
  `GitHubAPIClient.commitFiles()` (`ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift:339`) uses
  GitHub's Git Data API (blob → tree → commit → ref, with retry on non-fast-forward conflicts) to
  land multiple files in one commit. Separately, thread retention today purges by calendar age
  (archived threads at 30 days, deleted at 7 — `purgeExpired`, `coach-chat.ts:189-201`), which lets
  `chat_history.json` grow unboundedly between purges and doesn't match how the athlete actually
  wants to browse recent conversations. iOS coach chat (new, tracked separately) will read/write
  the same `chat_history.json` through the same endpoint, so both decisions need to be settled
  before that work starts, not discovered mid-build.
- **Decision:** Port the Git Data API commit pattern into TypeScript as
  `ui/api/_lib/githubGitData.ts`, exporting `commitFilesAtomic(files, message, ctx)`. Use it for
  every write `coach-chat.ts` makes to the repo — the close-session batch (all `file_updates` plus
  `chat_history.json`) and the PATCH archive/unarchive/delete write — replacing the `putFile()`
  loop entirely. Replace `purgeExpired`'s calendar-based purge with a count cap: keep only the 7
  most-recently-active threads (active or archived both count toward the cap), evicting the oldest
  when an 8th is created; deletes are immediate, no soft-delete retention window. The cap is
  enforced server-side on write (POST/PATCH), not on every GET, so read-only requests never
  rewrite the file.
- **Why:** One atomic commit per close is what the athlete asked for directly, and iOS already
  proves the pattern works well enough to reuse rather than re-derive. A count cap is simpler to
  reason about than two separate calendar windows, and bounds `chat_history.json`'s size
  predictably instead of leaving it to grow until an archive/delete purge catches up.
- **Rejected:** Share one Git Data API implementation across web (TypeScript) and iOS (Swift) →
  no practical way to share code across those runtimes without a new build/packaging layer neither
  app currently has; kept as two implementations of the same documented pattern
  (`docs/eng-docs/coach-chat-flow.md`) instead, with unifying them behind a shared contract test
  logged as a P2/P3 follow-up, not built now. Keep calendar-based retention → doesn't bound file
  size, and doesn't match "keep the last 7 chats" as the athlete described it.
