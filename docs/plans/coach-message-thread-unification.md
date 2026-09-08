# Coach message: one conversation per sync

> Status: Proposed · Owner: Tech Lead · Verified: 2026-09-08 · Issue: #918

## Context

Sentry `COACH-HQ-IOS-5` (issue 143901171 — 5 events / 2 athletes, regressing through 2026-09-07):
every sync fires two independent, uncoordinated Coach-turn generators. `activitySyncTurn`
(`ios/CoachHQ/CoachHQ/Services/HealthKitSyncManager.swift:911`) posts a live reply into the
already-open thread; `/api/coach-message` (`coachMessage.ts:852-858`) separately mints its own
`local-proactive-<id>` thread and fires a notification for it. The athlete gets a live reply in
the open thread, then minutes later a notification opening a *second*, different thread with a
different message. This is roadmap M1 ("Coach first") in `coach-conversation-widgets-roadmap.md`
— scoped, not started.

## Decision

Retire the second generator. `/api/coach-message` becomes the only post-sync Coach voice;
`activitySyncTurn` stops generating its own reply and instead waits on and renders that call's
result. The thread id it addresses is whichever is live — the open thread if one's on screen,
otherwise a freshly minted one. That id is what `latest_message.json`'s `conversation_seed_id`
carries, so a later notification or Home tap deep-links into the exact same conversation instead
of minting `local-proactive-<id>`.

```mermaid
flowchart LR
  sync["Sync completes"] --> call["one /api/coach-message call"]
  call --> open{"thread open on device?"}
  open -->|yes| append["append as reply in that thread"]
  open -->|no| seed["become opening message of a new thread"]
  append --> id["conversation_seed_id = that thread's id"]
  seed --> id
  id --> deliver["notification / Home / Chat all open this id"]
```

This also gives the post-sync call a real waiting state for free: `activitySyncTurn` already has a
`.requestingCoach` phase the UI reads (`CoachChatView.swift:473`) — today it drives the widget's
own call, tomorrow it drives the only call that matters. Closes Cyclops's item-1 gap with no new
state.

## Milestones

| # | Size | Milestone | Result |
|---|---|---|---|
| 1 | M | One generator, one thread id | `/api/coach-message` addresses the live thread id instead of minting `local-proactive-<id>`; `activitySyncTurn.ts`'s independent reply generation is removed |
| 2 | S | iOS wires the single call | `HealthKitSyncManager` drops the second `CoachMessagePostSyncDelivery.run` branch; `CoachChatView` shows `.requestingCoach` for the one remaining call; notification/Home open the thread id already on screen |
| 3 | S | ADR | Supersede/narrow ADR 0029 and `coach-chat-daily.md` §2a's "second entry, not second chat system" language — design moves from *separate thread, same lifecycle* to *same thread* |

Owners: M1 (`ui/api/coach-chat/_lib/`, `ui/api/coach-message/_lib/`) → Bob the Builder. M2
(`ios/`) → iOS Builder. M3 → Tech Lead. Sequence M1 before M2 — the contract has to settle first.
M3 can be written alongside M1.

## Done when

Notification, Home, and Chat show the same Coach words and open the same thread id, for both a
foreground sync (thread already open) and a backgrounded one (thread doesn't exist yet). One
Coach reply per sync, not two.

## Deferred

- Latency (the 5.16s `/api/coach-message` call, ~3s of it unspanned GitHub calls) — separate
  concern, already tracked in `coach-message-rebuild.md` (#828); worth its own scoped Sentry span
  there, not bundled here.
- SOUL cache sharing / cost — `coach-message-rebuild.md` M2, unaffected by this plan.
- Whether `activitySyncTurn`'s widget shell survives at all vs. the single call rendering
  directly — product call, not decided here; this plan assumes the shell stays.
