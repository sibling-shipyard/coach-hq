# C2 — Coach log without a closing turn — LLD (NOT FINALIZED)

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for C2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). **This design is
not approved.** The athlete has explicitly said the current draft isn't right yet. This file
captures where the discussion landed so far and the open questions — do not implement against it
until that discussion resolves and this status line is updated.

## Problem

`coach_note` (`coach_log.json`'s narrative continuity row) is structurally close-only today —
Gemini's schema only allows it on a closing-turn reply, and the prompt frames it as "summarize the
whole session." Once C1 removes the closing-turn concept entirely, there's no more trigger for it.
The athlete wants `coach_note` to keep existing (it's valuable, not incidental) but to stop
depending on any explicit close action.

## What's settled

- No existing scheduled/cron infrastructure exists anywhere in this codebase — everything today is
  request-triggered, including "proactive" coach messages (ADR 0029), which fire off the
  post-activity-sync hook (`ui/api/coach-message.ts`), not a timer.
- A day-boundary trigger (not a session/thread boundary) is more natural here than trying to detect
  "this thread is done" — threads have no reliable done-signal (a thread stays appendable forever
  regardless of newer threads existing), but "yesterday is over" is unambiguous.
- Underlying facts are never at risk regardless of how this resolves — A1/C1 already make every
  structured write commit immediately. This is purely about whether the narrative summary exists,
  not about data loss.

## Draft direction (provisional, not approved)

Reactive backfill: on a request that's already happening (an ordinary chat turn, or the post-sync
hook), cheaply compare the latest `coach_log` entry's date against dates with chat messages in
`chat_history.json`. If a past day (never today) has messages but no summary, generate one via a
small, dedicated Gemini call (not the live reply-generating call) using that day's transcript, and
commit it. Self-healing — any future activity catches up all pending days.

## Open questions — resolve before implementing

1. **The athlete is not satisfied with this shape yet** — the specific objection hasn't been
   pinned down in this doc; get that from them directly before designing further, don't guess at it.
2. Granularity: one row per calendar day (this draft's assumption) vs. per thread vs. something
   else — a returning athlete could have multiple sessions in one day; is a single merged summary
   right, or does that lose something the athlete cares about?
3. Trigger latency: does "whenever the athlete or their phone next does anything" feel sufficiently
   timely, or does the athlete actually want same-day reliability regardless of activity (which
   would mean building real scheduled infrastructure after all — a bigger, different PR)?
4. What happens to a genuinely abandoned day (athlete never opens the app again) — is "no summary
   for that day, forever" acceptable, or does this need a longer-tail catch-up mechanism?
5. Does this need its own small Gemini schema/prompt (separate from `coachReplySchema.ts`), and
   where does that prompt live — a new `platform/soul/` layer, or something outside the SOUL
   composition entirely since it's not a live conversation?

## Do not implement until

The athlete has reviewed this doc, given the specific objection to the current draft, and this
status line has been updated to reflect an approved direction.
