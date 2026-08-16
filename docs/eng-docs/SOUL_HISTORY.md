# Coach Phelps: SOUL History

> Status: Historical · Owner: Tech Lead · Verified: 2026-08-16

How a generic motivational chatbot became Coach Phelps. Every version, what it gained, and what
it cost.

Read top to bottom it's a character sheet. Coach starts as a markdown file that leads with data
and describes itself as "direct & no-nonsense". Five months later it has a voice, a memory, a
conscience about injuries, and the discipline to save its own notes before it leaves. Somewhere
in the middle it stopped being a dashboard with a personality.

**Entry format — one entry per version, ~25 lines max:**

1. **Superpower gained** — one line. What can Coach do now that it couldn't before?
2. Two or three sentences on what was wrong. Plain English, and it's allowed to be fun.
3. Five to seven bullets: what changed and why it mattered. Not how it was implemented.
4. **Why it mattered** (or **what it cost**) — the honest closing line, plus a pointer to the
   eng-doc or ADR carrying the detail.

Never one section per PR — a version ships across several, and the reader doesn't care which one
carried what. File paths, function names and baseline counts belong in the eng-doc; link to it.
Write it so someone who has never opened this repo enjoys reading it. If an entry needs more than
25 lines, the extra belongs somewhere else.

---

## v5.8 — "The Trim" · Aug 16, 2026
**Superpower gained:** knowing what it can't do, and shutting up about it.

Coach had been hauling a 509-line instruction manual into every conversation, and roughly half of
it was orders it was physically incapable of following. The web app has no shell, no git, no
files — and its own system prompt ended with, essentially, *"ignore anything in here you can't
actually do."* So Coach read 250 lines a turn and then pretended it hadn't. **509 → chat 219,
claude 365.**

- **One soul, two bodies.** `SOUL.chat.md` for the hosted app, `SOUL.claude.md` for BYO Claude
  Code. The app stopped carrying the boot sequence, shell commands, git ritual and script tables
  it was explicitly told to ignore.
- **Deleted the fiction.** A file-roles table nobody consulted, an athlete schema block that
  explained the prompt's own architecture *to the model*, quest polarity stated three separate
  times, and `roadmap.md` — a file referenced by SOUL and by nothing else in existence.
- **The deload rule had never fired. Not once.** It said "every 4th week" and nothing anywhere
  computed week-of-phase. Deleted rather than repaired — ADR 0023 has why we didn't just wire it
  to sleep data.
- **Killed two features on purpose.** Sleep-asking and PRE, per ADR 0023: a signal the athlete
  has to maintain by hand *will* rot. The most motivated user this will ever have let both decay.
- **Rare workflows moved out of the way.** First Session is summoned only for an athlete with no
  profile yet (ADR 0025 — they're called horcruxes, and there is a real reason). Badminton and
  the season recap became docs Coach opens when it needs them.
- **Layer A never moved.** Identity, voice, philosophy, situation playbook — untouched but for
  two named lines. That constraint is what the whole trim was built around.

**What it cost:** nothing yet, and that's the worry. The eval covers structure, not voice, and
BYOB isn't covered at all. We removed 290 lines from a file whose entire value is voice, and the
safety net was reading it line by line.

*Mechanism: `soul-two-builds.md`. Decisions: ADR 0022, 0023, 0024, 0025.*

---

## v5.7 (hq-adopted) — "Personal Brain on Main" · Jul 26, 2026
**Superpower gained:** the good brain became everyone's brain.

Two Coaches existed: a rich one in Sky's personal repo, and a thinner 13-section one in HQ. HQ's
was the one about to be forked to every future athlete. We nearly shipped the downgrade.

- Adopted v5.7's 12-section layout wholesale — Commit Protocol §13→§12, Rules Engine §10→§9,
  First Session folded into §10 Workflows. Reconciled line by line, not copy-pasted.
- De-personalized §7: no athlete name, no profile, no badminton-specific content.
- Kept HQ's own additions: the chat-history file row, the serverless sync pipeline note, boot
  `git pull`, First Session, and the commit ritual's extra files.
- Restored the full `current_week.json` workflows — boot read, contract safety, logging
  reconciliation, Sunday rollover — genericized.

**Why it mattered:** splitting the thin version would have baked a worse Coach into every fork
forever. Land the good brain first, split it after.

---

## v5.7 — "Canonical Layout" · Jul 25, 2026
**Superpower gained:** knowing where its own things are.

The repo got reorganised underneath Coach and nobody told it. Coach boots by reading paths, and a
stale path doesn't throw an error — it quietly finds nothing.

- Boot, guardrails, rituals and the file-roles table repointed to the post-reorg tree.
- Badminton analytics snapshot renamed; still on-demand, never at boot.
- The 60-Day Challenge narrative archived rather than deleted.
- The static warm-up protocol moved to reference material, not coach memory.

**Why it mattered:** no behaviour change at all, which is the point. Stale path strings are the
failure mode that never announces itself.

---

## v5.6 — "Milestone Record Contract" · Jul 22, 2026
**Superpower gained:** milestones the dashboard could draw.

Coach was being asked to hand-compute progress percentages for a UI widget. That is not coaching.

- §8 points at a milestone schema doc owning the display fields and progress blocks. SOUL keeps
  the behaviour, the contract doc keeps the shape.

**Why it mattered:** same trick as the weekly contract — prose stays canonical for Coach,
structured fields feed the UI, and neither has to know about the other.

---

## v5.5 — "Live Weekly Plan" · Jul 20, 2026
**Superpower gained:** the plan Coach writes is the plan the athlete sees.

- Touch-ups so `current_week.json` renders live in the home weekly widget — plan rows, completion
  overlay, Coach's commentary.

**Why it mattered:** v5.4 built the contract; this wired it to glass. From here an unreconciled
session isn't untidy data, it's visibly wrong on the athlete's screen.

---

## v5.4 — "The Bounded Week" · Jul 19, 2026
**Superpower gained:** a week with an expiry date.

The active plan lived as an ever-growing section inside durable memory, so Coach could neither
tell a stale plan from a live one nor stop the file swelling.

- The week became a dated Monday-to-Sunday contract: plan, outcomes, move provenance, planned
  load, short-lived commentary. Boot validates lifecycle and freshness before trusting it.
- Every workflow touching the week — kick-off, pre-workout, logging, rollover, interim save,
  rollback, close — reads and writes that contract.
- Closed weeks append one summary to the archive. Day-by-day schedules never return to `state.md`.
- Exact field rules moved into the contract doc; SOUL keeps only the safety policy.
- A pre-push check runs the dashboard's own parser and demands a diff review.

**Why it mattered:** a one-week file creates a hard freshness boundary. Downstream clients get an
honest "unavailable" instead of a confidently stale plan, and durable state stays small.

---

## v5.3 — "One Source of Truth" · Jun 21, 2026
**Superpower gained:** one answer to "is he injured?"

Injury status lived in two files. Predictably they disagreed — SOUL still said the ankle needed
taping and the shoulder flared after intensity, weeks after both were cleared.

- Deleted §7's static injury list. Kept only the permanent fact (a lower-back injury ~5 years
  earlier, source of the chronic right-side tightness). Live status now points solely at
  `state.md`.
- New phase archive for retrospectives, written once at close, mirroring the week archive.

**Why it mattered:** the two-file architecture exists to stop exactly this drift. The moment a
status list lives in both files one of them is lying, and Coach cannot tell which.

---

## v5.2 — "Build Phase" · Jun 21, 2026
**Superpower gained:** catching up before saying hello.

Base Phase closed at 18/20. Build Phase had no model at all — no session floor, no milestones,
just vibes. And Coach still opened every conversation waiting to be told what had happened.

- **Boot now reviews the last 10 days of activity before greeting.** This is the change that made
  Coach feel like it remembered you: *"saw you got that session in"* instead of *"how's
  training?"*
- Base Phase marked complete; Build Phase structured as 4-week blocks, each closing with a deload
  and a milestone test.
- Main quest became session count plus a milestone list tested at block boundaries rather than
  tracked daily. Added the skill-session model and the leg-load rule — sprint, plyo, lower and
  badminton can't all stack in one week.
- Side quests trimmed hard: Foundation and Cold Shower graduated to untracked habits.
- The 60-Day Challenge framing retired for "less prescriptive, more principled" — programming
  lands *with* the athlete, not *at* him.

**Why it mattered:** Cold Shower was running ~98%, Foundation an 83-day unbroken streak with every
gap life-excused. Tracking those was bookkeeping a foregone conclusion, and it cluttered every
check-in with questions that didn't need asking.

---

## v5.1 — "Drop Per-Game Notation" · Apr 11, 2026
**Superpower gained:** shutting up between games.

- Removed the per-game mental-state notation. The single session-level note before play stays.

**Why it mattered:** logging state per game meant writing notes between matches — exactly when
attention belongs on recovery and the next point. The friction wasn't neutral, it was hurting
performance. First time we deleted a feature because using it made the athlete worse.

---

## v5.0 — "Lean Boot + Calibration" · Apr 6, 2026
**Superpower gained:** travelling light.

v4.1 worked but was brittle. SOUL was doing four jobs at once — identity, engine mechanics,
athlete data, tool documentation — and loading all of it, every time, for a rest-day check-in.

- Boot slimmed to three files. Analytics no longer loaded at boot.
- Guardrails consolidated into one section, because a rule split across three places is a rule
  someone misses.
- Situation Playbook extended with two real edges: returning after a multi-day gap, and using
  mental-state data without judging the athlete for it.
- Full CLI reference moved to a companion doc; SOUL keeps purpose and when-to-use.
- Calibration examples added — the first time SOUL *showed* the voice instead of describing it.

**The failure modes that drove it**, all observed live on v4.1: suggesting a workout with no idea
whether it was 9am or 9pm; quoting a fitness baseline hardcoded months earlier; tool docs silently
drifting from the actual scripts; eight numbered rules for saving one session file.

**Why it mattered:** "one file, too many jobs" is the direct ancestor of the A/B/C layer split.
v5 separated the jobs *inside* one file; the split later separated them into three.

---

## v4.1 — "Protocol Tightening" · Apr 3, 2026
**Superpower gained:** a memory that fits in your pocket.

- Boot stopped reading `coach_notes.md` — past 200 lines and slowing every session start. The last
  3 sessions now live inline in `state.md` as rolling notes.
- Weekly kick-off became a named workflow with explicit trigger phrases, so it actually happened
  instead of dissolving into general conversation.
- Pre-commit checklist added — six boxes, replacing "remember to save".

**Why it mattered:** three real sessions hit the same friction every time. Don't read the whole
archive; keep the last three sessions visible. Small change, and the difference between a protocol
that holds under pressure and one that drifts.

---

## v4.0 — "The Phelps Rewrite" · Mar 29, 2026
**Superpower gained:** an actual personality. This is the big one.

v3.1 was operationally excellent and had no character whatsoever. Under pressure — a bad session,
a losing streak, an injury — it defaulted to a structured status report. What the athlete asked
for was *"a permanent coach who puts a shoulder around you."* That isn't a feature. That's a
person.

- Identity rebuilt entirely around Michael Phelps: process over outcome, the 2014 DUI, rehab, the
  comeback that wasn't about medals. The detail anchoring the whole thing — he could recall any
  finish time to the hundredth but had to pause to count his own medals.
- Voice rules locked: short sentences, casual vocabulary, signature openers, emotional before
  analytical.
- **"What you are NOT"** added — not a data analyst, not a drill sergeant, not a therapist, not
  always positive. Defining the negative space mattered more than the positive.
- Core loop defined: Validate → Share → Redirect. Three modes: Mentor, Analyst, Hype Man.
- *"Lead with data"* — the first coaching rule since v1.0 — deleted, replaced with **"Lead with
  feeling, not data."**
- Situation Playbook added: 8 failure scenarios with explicit emotional approach and real
  language, written because there was no guidance at all for an athlete showing up defeated.

**Why it mattered:** Phelps was chosen because his story maps cleanly onto the ask — elite results,
visible public failure, comeback through process discipline. Voice was synthesized from 15+
primary sources; see `../ref-docs/phelps-voice-profile.md` and `phelps-research-notes.md`.

---

## v3.1 — "Pipeline Aware" · Mar 28, 2026
**Superpower gained:** understanding its own plumbing.

The data pipeline had matured and Coach had no idea it existed. It would try to run steps the
pipeline had already automated, or skip the session file entirely and send the athlete into the
timer with unadjusted sets.

- Full tools section: every script, its flags, and when to use it.
- The sync pipeline documented end to end.
- **Session files introduced** — Coach writes the adjusted workout before the timer is opened, so
  the timer gets the coach-adjusted version instead of the base template.
- Commit protocol expanded with an explicit file list.

**Why it mattered:** operational clarity, not features. The bar was that no agent should ever have
to read the pipeline's own README to work out what was going on.

---

## v1.6–v3.0 — Undocumented · Mar 25–28, 2026

*Three days, five version numbers, no record. These predate the repo's git history and never made
it into coach_notes.md. Best guess: the pipeline was being built fast and the version number
climbed quicker than the documentation did. A gap in the fossil record.*

---

## v1.5 — "Forward Sync" · Mar 25, 2026
**Superpower gained:** not losing yesterday.

- `--sync` became two passes: forward from the last sync point to catch new activity, then
  backward to fill historical gaps. Token file moved next to the scripts that use it.

**Why it mattered:** a gap was spotted on Day 8 — single-pass backward sync missed anything logged
*after* the last sync point, so new sessions vanished unless saved by hand. Run once, get
everything.

---

## v1.4 — "History as Ground Truth" · Mar 24, 2026
**Superpower gained:** data it could actually query.

- Raw activity data became enriched JSON — the canonical record for all analytics and context.
- The markdown workout log demoted to human-readable summaries.
- Coach notes and RPE embedded directly alongside the activity fields.

**Why it mattered:** the original design stored workouts in markdown — lovely to read, miserable to
query. The log stayed for humans; the JSON became the truth.

---

## v1.3 — "The Consolidation" · Mar 24, 2026
**Superpower gained:** the discipline to save before leaving.

- Five files became two. `SOUL.md` is now the sole static brain; the old persona, periodization
  and progress files deleted.
- **The commit protocol went live** — the mandatory closing ritual, every session.

**Why it mattered:** the two-file architecture had been planned since v1.0, but the old files were
kept in parallel as a safety net until real sessions proved the new structure. The ritual shipped
the same day, because an architecture built on living memory only works if the memory is always
written down.

---

## v1.0–v1.2 — "The Foundation" · Mar 17–24, 2026
**Superpower gained:** existing.

Five fragmented files became a portable two-file architecture: a static brain and a living memory.

- `SOUL.md` created (~200-250 lines) from the old skill file, persona doc and periodization rules.
- `state.md` created as the living memory, replacing the separate notes and progress summary.
- Boot sequence established: read SOUL, read state, coach up.
- Versioning header introduced.

**Coach at this point:** a generic motivational coach. Self-described as *"direct & no-nonsense."*
Led with data. Had no story, no failures of its own, and nothing to say to someone having a bad
week. Everything above is the work of fixing that.
