# 0023 — A signal ships only when something other than the athlete maintains it

- **Status:** Accepted · 2026-08-15 · Tech Lead
- **Area:** cross-cutting
- **Context:** The SOUL v5.7 audit found the same failure repeatedly, and always in features that
  ask the athlete to keep a record current. Resting HR: column exists, never filled. PRE
  (pre-session mental state): 3 entries across 894 activities, all within twelve days of April
  2026, none since — and the state.md table meant to hold them is frozen four months back.
  Equipment: collected during the First Session, never read again anywhere in SOUL. `roadmap.md`:
  in the commit checklist, referenced by no code, scaffolded by nothing. Sleep: entered only when
  Coach remembers to ask. Deload weeks: needed a week counter nobody built, and fired zero times.
  Every one of these was individually reasonable when added. All of them decayed for the most
  motivated user the product will ever have.
- **Decision:** A tracked signal ships only when it has a source that maintains itself — a sync,
  a sensor, a generated file, a computed digest. If keeping it current depends on the athlete
  remembering, or on Coach remembering to ask, it does not ship. Existing manual signals are
  removed rather than left to rot, and re-added when an automatic source exists (sleep: on
  HealthKit sync, #341).
- **Why:** Data nobody maintains is worse than no data: Coach reads it as current, reasons from
  it, and the athlete has no way to see it went stale. A rotted field is a confident wrong answer
  waiting to happen, and it costs prompt space every turn in the meantime.
- **Rejected:** Keep manual fields and nudge harder in the prompt → the audit is the evidence
  this fails; the person it failed for is the one who built it. Keep them for optional/power
  users → the cost lands on every athlete's prompt while the value lands on almost none. Wait
  and see whether usage picks up → PRE had four months to and went to zero.

<!-- The filter this exists to enforce: when a new tracked signal is proposed, name the thing that
     will keep it current. If that thing is a person, the answer is no, not yet. -->
