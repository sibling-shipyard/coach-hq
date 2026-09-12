# 0040 — One post-sync Coach generator, one chat thread

- **Status:** Accepted · 2026-09-08 · Tech Lead
- **Area:** cross-cutting (coach message, coach chat, iOS)
- **Context:** `activitySyncTurn`'s in-thread reply and `/api/coach-message`'s proactive
  notification independently generated a Coach reply for the same sync (Sentry 143901171).
- **Decision:** One shared generation pipeline, one thread per batch. Whichever caller runs
  first for a batch — `activitySyncTurn` (the common, in-app case) or `/api/coach-message` (a
  genuinely backgrounded sync) — generates the reply and mints the thread. The other finds that
  thread by batch id and reuses its reply instead of generating again.
- **Why:** That already happened in production: the athlete got two different Coach replies in
  two different threads for one sync, plus a second, redundant notification.
- **Rejected:** Keep both calls, reconcile after the fact → still pays for two model calls and
  still risks the wrong text flashing before reconciliation. Drop `/api/coach-message` entirely →
  loses the only path that still works for a genuinely backgrounded sync.
- **Enforces:** A post-sync Coach reply comes from exactly one generator call and is addressable
  by exactly one thread id. Never add a second independent generation path for one sync event.
- **How to apply:** A batch with an existing `chat_history.json` thread (`activitySyncBatchId`)
  reuses that thread's reply and id. A batch with no existing thread generates and mints one —
  in `activitySyncTurn.ts` (the common case) or `coach-message/_lib/coachMessage.ts`'s own
  fallback (a genuinely backgrounded sync), whichever runs first.

Shipped: #918 (#922, #923, #924). See `docs/eng-docs/coach-data-schema.md` and
`docs/eng-docs/coach-chat-daily.md` §2a.
