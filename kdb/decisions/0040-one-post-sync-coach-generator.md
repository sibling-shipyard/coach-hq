# 0040 — One post-sync Coach generator, one chat thread

- **Status:** Accepted · 2026-09-08 · Tech Lead
- **Area:** cross-cutting (coach message, coach chat, iOS)
- **Context:** `activitySyncTurn`'s in-thread reply and `/api/coach-message`'s proactive
  notification independently generated a Coach reply for the same sync (Sentry 143901171).
- **Decision:** `/api/coach-message` is the only post-sync Coach-reply generator.
  `activitySyncTurn` generates through it instead of its own model call, and points at the same
  persisted thread rather than minting a second one.
- **Why:** That already happened in production: the athlete got two different Coach replies in
  two different threads for one sync, plus a second, redundant notification.
- **Rejected:** Keep both calls, reconcile after the fact → still pays for two model calls and
  still risks the wrong text flashing before reconciliation. Drop `/api/coach-message` entirely →
  loses the only path that still works for a genuinely backgrounded sync.
- **Enforces:** A post-sync Coach reply comes from exactly one generator call and is addressable
  by exactly one thread id. Never add a second independent generation path for one sync event.
- **How to apply:** A batch with an existing `chat_history.json` thread (`activitySyncBatchId`)
  reuses that thread's reply and id. Only a batch with no existing thread generates and mints
  one, in `coach-message/_lib/coachMessage.ts`.

Shipped: #918 (#922, #923, #924). See `docs/eng-docs/coach-data-schema.md` and
`docs/eng-docs/coach-chat-daily.md` §2a.
