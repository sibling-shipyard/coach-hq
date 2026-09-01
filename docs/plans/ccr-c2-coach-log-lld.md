# C2 — Coach log without a closing turn — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for C2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on C1 —
needs `coach_note` unified onto every turn (C1's schema work) before this PR's own logic (the
day-keyed overwrite semantics, below) has anything to build on.

## Problem

`coach_note` (`coach_log.json`'s narrative continuity row) is structurally close-only today —
Gemini's schema only allows it on a closing-turn reply, and the prompt frames it as "summarize the
whole session." Once C1 removes the closing-turn concept entirely, there's no more trigger for it.
The athlete wants `coach_note` to keep existing as a real LLM-written narrative (not a mechanical
change-log, that direction was considered and rejected) but to stop depending on any explicit close
action, and — the design settled on below — to stop depending on any extra Gemini call or any new
trigger mechanism at all.

## Chosen design: day-keyed running note, updated inline with the turn already happening

One row per calendar day in `coach_log.json`, keyed by date — same idiom `progress.json` already
uses for `(quest_id, date)`. On any ordinary turn (available on every turn once C1 lands, not
closing-only), `coach_note` is one more field in the *same* Gemini call already generating that
turn's reply — not a second call, not extra latency, not extra cost beyond a slightly larger
prompt/response on turns that use it. If Gemini emits a `coach_note` this turn: look up whether
today's row already exists; if yes, **overwrite it** with the revised note; if no, create it.

**Context fed to the model for the revision**: today's existing note (if any) plus the current
exchange — not the full day's transcript. Keeps cost flat regardless of how many messages happen
that day. This choice is exactly what the validation spike below exists to confirm before it's
locked in.

**Enforcement rule — not left to Gemini's free choice.** A `coach_note` update is **required** on
any turn that also produced another structured write this turn (`profile_update`, `memory_update`,
`injury_flag`, `injury_event`, `quest_event`, `quest_create`, `season_start`) — server-enforced via
the schema/turn-writes logic, same discipline as D1's dynamic-enum work: if something changed, the
model doesn't get to silently skip recording it. On a turn with zero other structured writes
(small talk, a check-in with nothing to report), `coach_note` stays genuinely optional — nothing was
at risk of being forgotten there either. This directly answers the reliability concern the athlete
raised: it's not "hope Gemini remembers," it's "the schema requires it exactly when something
happened."

**Why this satisfies "coach log should not be present when there is no activity or chat that
happened":** it's true by construction, not by a separate check. A day with zero messages never
produces a request, so the code that would create/update that day's row never runs. No placeholder,
no empty entry, nothing to clean up.

## Validation spike — run this before writing the mechanism, not after

The open question is quality, not architecture: does a narrower "current note + latest exchange"
context produce as good a note as feeding the full day's transcript each time? This is testable
today, independent of A1/C1 landing — it's a pure prompt/context question, answerable with
`npm run eval:coach-chat` against a real Gemini call.

1. Write one realistic multi-turn transcript: a handful of messages across a day, with 2-3 genuinely
   coach_log-worthy moments (an injury update, a quest completion) mixed with filler messages that
   shouldn't trigger an update.
2. Run it twice: once feeding Gemini the full transcript-so-far on each note update, once feeding
   only "current note + latest exchange."
3. Compare the final notes side by side. Also check, across repeated runs (not just one): does the
   enforced-field rule reliably fire on the turns it must, and reliably skip on filler turns?
4. If the narrower context holds up, build it as designed above. If it measurably loses important
   detail, feed the fuller context instead — still no separate Gemini call either way, just a bigger
   prompt on that turn.

## Fallback — if the spike or real usage shows the chosen design doesn't hold up

Kept here so a fallback doesn't need re-deriving from scratch later.

**Reactive day-boundary backfill (previously the leading design, superseded by the above):** a
separate, dedicated Gemini call, triggered lazily whenever a gap is detected (any chat turn, or the
app-launch `coach-chat-profile-status` check) — compare the latest `coach_log` entry's date against
dates with real messages in `chat_history.json`; if a past day (never today) is missing a summary,
generate one from that day's transcript and commit it. Made effectively free from the athlete's
perspective by running via Vercel's `waitUntil()` (`@vercel/functions` — already used in production
today, `ui/api/_lib/sentry.ts`'s flush, not hypothetical) so the extra call happens *after* the
reply is already sent. Tradeoffs versus the chosen design: one full extra day of lag on top of the
inherent "never same-day" lag (the day being summarized isn't reflected in Coach's own context until
the day *after* it's backfilled), and real ongoing Gemini cost per gap — mitigate with a cheaper
model (`gemini-flash-latest`, not `-pro-latest`) for this specific call, and batch multiple pending
days into one call when an athlete returns after a longer silence.

**Real scheduled cron** — considered, ruled out. First-of-its-kind new infrastructure in this
codebase (no `waitUntil`-adjacent scheduling exists anywhere; this would mean Vercel Cron Jobs, a
new auth path not tied to a live request, and per-athlete-timezone scheduling logic). The reactive
fallback above already closes the latency/timeliness gap adequately without it.

**Client-staged writes until "wrap" (all fields, not just coach_note)** — rejected outright.
Reintroduces the exact staged-write data-loss risk #616 already burned this system on once: a
closed tab, killed app, or cleared local storage loses everything staged, same failure shape as
today's bug, just relocated to the client. Also reinstates a hard dependency on the wrap/close
button C1 removes everywhere else.

## Tests

- The validation spike above, recorded (transcripts + real output, `tests/<date>/eval/` per this
  repo's convention) as evidence for whichever context strategy gets built.
- New unit tests for the day-keyed overwrite logic (mirrors `applyQuestEvent`'s `(quest_id, date)`
  keying pattern — same shape, new file).
- New eval fixture: a turn with another structured write present, asserting `coach_note` is required
  and rejected/retried if absent (same corrective-retry pattern as D1, not a silent skip).
- New eval fixture: a filler turn with no other writes, asserting `coach_note` is correctly absent.

## Done when

A live multi-day scratch-repo conversation shows one `coach_log` row per day that actually had
messages, correctly updated in place as the day progresses, present on every turn that also wrote
something else, absent on days with no activity, with zero extra Gemini calls beyond what that
turn's reply already required.
