# C2 — Coach log without a closing turn — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for C2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on C1 —
needs `coach_note` unified onto every turn (C1's schema work) before this PR's own logic (the
day-keyed overwrite semantics, below) has anything to build on.

## Problem

`coach_note` (`coach_log.json`'s narrative continuity row) is structurally close-only today.
Gemini's schema only allows it on a closing-turn reply, and the prompt frames it as "summarize the
whole session." Once C1 removes the closing-turn concept entirely, there's no more trigger for it.
The athlete wants `coach_note` to keep existing as a real LLM-written narrative, not a mechanical
change-log (that direction was considered and rejected). It should stop depending on any explicit
close action, and — the design settled on below — stop depending on any extra Gemini call or any
new trigger mechanism at all.

## Chosen design: day-keyed running note, updated inline with the turn already happening

One row per calendar day in `coach_log.json`, keyed by date — same idiom `progress.json` already
uses for `(quest_id, date)`. `coach_note` is available on every ordinary turn once C1 lands, not
closing-only. It's one more field in the *same* Gemini call already generating that turn's reply —
not a second call, not extra latency, not extra cost beyond a slightly larger prompt/response on
turns that use it. If Gemini emits a `coach_note` this turn: look up whether today's row already
exists; if yes, **overwrite it** with the revised note; if no, create it.

**Context fed to the model for the revision**: today's existing note (if any) plus the current
exchange — not the full day's transcript. Keeps cost flat regardless of how many messages happen
that day. This choice is exactly what the validation spike below exists to confirm before it's
locked in.

**Enforcement rule — not left to Gemini's free choice.** A `coach_note` update is **required** on
any turn that also produced another structured write this turn (`profile_update`, `memory_update`,
`injury_flag`, `injury_event`, `quest_event`, `quest_create`, `season_start`). This is
server-enforced via the schema/turn-writes logic, same discipline as D1's dynamic-enum work: if
something changed, the model doesn't get to silently skip recording it. On a turn with zero other
structured writes
(small talk, a check-in with nothing to report), `coach_note` stays genuinely optional — nothing was
at risk of being forgotten there either. This directly answers the reliability concern the athlete
raised: it's not "hope Gemini remembers," it's "the schema requires it exactly when something
happened."

**Why this satisfies "coach log should not be present when there is no activity or chat that
happened":** it's true by construction, not by a separate check. A day with zero messages never
produces a request, so the code that would create/update that day's row never runs. No placeholder,
no empty entry, nothing to clean up.

## Validation spike — completed, narrow context confirmed

The open question was quality, not architecture: does a narrower "current note + latest exchange"
context produce as good a note as feeding the full day's transcript each time? Run twice, both
against real `gemini-pro-latest` calls, before any implementation work started:

1. A 6-message single-day transcript, 3 note-worthy moments (an injury update, a quest
   completion, a PR) mixed with 3 filler messages. Run twice: once feeding Gemini the full
   transcript-so-far on each note update, once feeding only "current note + latest exchange."
   Judgment accuracy was 6/6 correct both ways. Final note quality was equivalent. Narrow context
   dropped no detail from either injury, quest, or PR facts, and read marginally more natural.
   Evidence: `tests/2026-09-02/eval/c2-coach-note-spike-1788336883047.json`.
2. A separate 8-turn multi-topic conversation (an injury raised then later resolved, a quest
   streak, a schedule change, interleaved with small talk and questions) probing natural
   free-choice firing. `coach_note` was added as an optional field, no enforcement yet, to see
   Gemini's own judgment before any corrective-retry backstop. 8/8 correct: fired on exactly the
   4 note-worthy turns, skipped exactly the 4 filler turns. The note also correctly revised an
   earlier fact (the injury) once new information arrived, instead of just appending. Evidence:
   `tests/2026-09-02/eval/c2-when-does-it-fire-1788338726387.json`.

**Decision: build narrow context exactly as originally designed.** No fallback needed — proceeding
to implementation.

## Fallback — kept for reference, not needed for this PR

Not used — the spike confirmed the chosen design holds. Kept here in case real usage after ship
surfaces a case the spike didn't cover, so a fallback doesn't need re-deriving from scratch then.

**Reactive day-boundary backfill (previously the leading design, superseded by the above):** a
separate, dedicated Gemini call, triggered lazily whenever a gap is detected (any chat turn, or the
app-launch `coach-chat-profile-status` check). Compare the latest `coach_log` entry's date against
dates with real messages in `chat_history.json`; if a past day (never today) is missing a summary,
generate one from that day's transcript and commit it. Made effectively free from the athlete's
perspective by running via Vercel's `waitUntil()` (`@vercel/functions` — already used in production
today, `ui/api/_lib/sentry.ts`'s flush, not hypothetical) so the extra call happens *after* the
reply is already sent. Tradeoffs versus the chosen design: one full extra day of lag on top of the
inherent "never same-day" lag. The day being summarized isn't reflected in Coach's own context
until the day *after* it's backfilled. There's also real ongoing Gemini cost per gap. Mitigate with
a cheaper model (`gemini-flash-latest`, not `-pro-latest`) for this specific call, and batch
multiple pending days into one call when an athlete returns after a longer silence.

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
messages, correctly updated in place as the day progresses. It's present on every turn that also
wrote something else, absent on days with no activity, with zero extra Gemini calls beyond what
that turn's reply already required.
