# 0037 — Chat history: full retention in storage, display still capped at 7

- **Status:** Accepted · 2026-09-01 · Tech Lead
- **Area:** cross-cutting (coach-chat API, web, iOS)
- **Context:** ADR 0012 chose count-based retention specifically to bound `chat_history.json`'s
  size predictably: past the 7 most-recently-active threads, older ones were deleted on write.
  The athlete now wants every conversation ever had with Coach kept — real signal for
  understanding how people actually talk to Coach — while web and iOS still only ever show the
  most recent 7.
- **Decision:** Stop deleting. `chat_history.json` grows unbounded in storage, forever. The
  7-thread cap moves from write time to response time: every place threads go back to a client
  (`GET` history, a turn's own response, an activity-sync response) slices to the newest 7 off the
  already newest-first array. Nothing on disk is ever dropped.
- **Why:** Full history is valuable developer signal that a count cap was destroying. Storage
  growth is small in practice — a single FSP thread runs ~3-5KB, so a full year of daily use is
  roughly ~1MB, nowhere near GitHub's blob-size limits for years. Prompt cost is already unaffected
  by retention either way: Gemini only ever sees the currently-open thread's own messages
  (`turn.priorMessages`), never other retained threads, confirmed independently of this change.
- **Rejected:** Keep the count cap and add a separate archive tier for full history → re-opens
  ADR 0033, which the athlete already rejected once ("no archive option anywhere"). This decision
  does not reopen that. There is still no archive tier, just one file that no longer prunes itself
  · Raise the cap instead of removing it → still deletes eventually, and the athlete wants nothing
  ever deleted.
- **Enforces:** Nothing writes a destructive slice to `chat_history.json` again. A cap on what a
  client sees belongs at response time, not at write time.
- **How to apply:** Server-side only — `pruneForResponse()` in `ui/api/coach-chat/_lib/chatThreads.ts`
  runs at every response call site. Neither web nor iOS has its own retention logic to update; both
  already just render whatever the API returns.
