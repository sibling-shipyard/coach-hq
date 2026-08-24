# 0029 — Proactive Coach messages have an athlete-owned latest-message record

- **Status:** Accepted · 2026-08-23 · Tech Lead
- **Area:** cross-cutting (coach message, web + iOS)
- **Context:** A post-sync Coach message must survive across devices and open the same conversation, but the weekly `coach_read` expires with its week and `coach_log.json` is private continuity rather than a delivery surface.
- **Decision:** Store the single current message in `user_data/coach/latest_message.json`. A fresh athlete repo seeds schema version 1 with `message: null`. A successful newer sync batch replaces it; replaying the same sorted source-qualified activity ids is idempotent, and a failed generation or write leaves it untouched. `coach_read` and `coach_log.json` keep their current jobs. Home may expose an optional `home.coachMessage` projection through ADR 0005; that snapshot is derived, not another owner.
- **Why:** The athlete repo is the shared durable boundary for web and iOS. One latest record gives notification, Home and chat one exact body and conversation seed without turning weekly planning or private memory into an inbox.
- **Rejected:** Put it in `current_week.json` → message lifetime would follow the week. Append it to `coach_log.json` → delivery state would mix with private Coach continuity. Make widget snapshots canonical → ADR 0005 defines them as a portable projection, not source data.
