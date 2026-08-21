# SOUL: the path to v6

> Status: Current · Owner: Tech Lead · Verified: 2026-08-20

Where Coach's brain is going, and why. Written after a line-by-line audit of SOUL v5.7 (509
lines, every section, both runtimes). Readable on its own — the plans it names are
delete-on-ship, so treat a missing one as shipped, not as a broken link.

## The thesis

SOUL didn't bloat carelessly. **The backend kept absorbing SOUL's jobs, and nobody deleted the
instructions left behind.** Greeting, close detection, day number, timezone, the commit ritual,
appending coach notes — coach-chat took each one over, and SOUL's version of it stayed, becoming
text the model is told to read and then ignore.

```
v5.7   SOUL = identity + coaching logic + engine + file clerk
                                          └──────────────────┘
                                          the backend already does most of this

v6     SOUL = identity + coaching logic
       backend = everything else
```

Every phase below is a move along that line. v5.8 removes what is already dead; v6 finishes the
migration deliberately instead of by accident; v7 changes who Coach talks to.

## Where we are

| | |
|---|---|
| SOUL v5.7 | 509 lines, one composed file, shipped whole to two runtimes |
| BYOB Claude Code | Shell, git, file reads. **What both live athletes actually use.** |
| coach-chat (Gemini) | No shell, no file reads. Gets three files on an ordinary turn. |

The app is told outright to ignore any SOUL instruction it can't execute
(`ui/api/coach-chat.ts:585`). Roughly half of what it receives falls under that.

---

## Phase 1 — v5.8: make the file honest

One source, two builds. Layer A (identity, voice, philosophy, situation playbook) is **untouched
in every step**.

| # | Step | Effect |
|---|---|---|
| 1 | Composer emits `SOUL.chat.md` + `SOUL.claude.md` | No content change — proves the machinery |
| 2 | Delete what's dead in both builds | ~122 lines |
| 3 | Move shell/git instructions to the BYOB build | ~68 lines leave the app build |
| 4 | Cut sleep and PRE | First real feature removal |
| 5 | Move rare workflows to on-demand | First Session, badminton, season close |

Shipped Aug 16, 2026. Actual: **219 lines for the app, 365 for BYOB**, from 509. (The BYOB figure
lands above the ~289 estimate because the audit's per-block line counts ran ~12% high and the
claude build keeps every shell/git block rather than losing them.)

The two-build decision is recorded in `kdb/decisions/0022-two-composed-soul-builds.md`, which
amends ADR 0021's assumption that terminal/BYO mode was retiring. It wasn't; it's the primary
path. Step 1 also ships `validate-soul` (see Rules below) — the split is what makes "which build
is this rule for" expressible at all.

*Shipped. How the two builds work now: `docs/eng-docs/soul-two-builds.md`. The block-by-block
audit was a delete-on-ship plan — git history is the archive.*

## Phase 2 — restore the BYO carve path

**A freshly carved repo cannot run BYOB today.** `platform/scripts/carve-skeleton.mjs` writes no
`SOUL.md`, no `.claude/`, no root `CLAUDE.md`, and no `propagated/docs/` — ADR 0021 removed all of
it. `coach-akash` and `coach-skanda` still work only because they predate the change. Anyone
onboarded today gets data, engine scripts, and no Coach.

This is an undo of a known change, sequenced **after v5.8, not before**: restoring first would
carve `propagated/SOUL.md` and then rename it when the split lands. Doing it once, afterwards,
goes straight to the final shape. What to put back:

1. Composed SOUL — specifically the `SOUL.claude.md` target from phase 1.
2. `.claude/` + root `CLAUDE.md`, so Claude Code boots as Coach.
3. `propagated/docs/` — `current-week-contract.md`, `pipeline-tools.md`, `timer-state-machine.md`,
   plus the two v5.8 added: `badminton-plugin.md` and `season-close.md`. **Those two are the
   urgent ones.** The other three have been dangling since ADR 0021 and Coach worked around them;
   the v5.8 trim *deleted* the badminton file map and the recap spec from SOUL and replaced them
   with pointers, so until this carve step is restored that content is unreachable in every
   athlete repo — Coach follows the pointer and finds nothing. Tracked as two `rot` findings in
   `validate-soul`'s baseline. Three others in `docs/ref-docs/` are orphaned and should not be
   restored: `phelps-voice-profile.md` and `soul-calibration.md` are referenced only by the line
   telling Coach *not* to read them, and `milestone-schema.md` by nothing at all.
4. Workout templates. The carve ships **two** (`WORKOUT_TEMPLATES` — `foundation.json`,
   `strength_a.json`) while SOUL names four; `strength_b` and `recovery` don't exist in a new
   repo, so a new athlete's first prescription cites phantom files. Either carve them or trim
   SOUL's list.

Source files all exist in HQ, so this is mostly re-adding copy steps.

**The trade being made:** onboarding onto BYOB puts the full composed SOUL into someone else's
repo — the exact thing phase 4 exists to prevent. Acceptable for trusted testers, worth being
deliberate about rather than defaulting into.

## Phase 3 — v6: stability, not expansion

Get what exists working properly, prove it with a handful of trusted testers, then expand. Three
threads. Note how little is SOUL work — that's the thesis showing.

**1. The app catches up to BYOB.** The real blocker: both athletes are on BYOB *because* the app
isn't good enough. Four gaps, one question — what does Coach need in front of it on an ordinary
turn? Training history; the week plan (fetched only on a close); workout templates (never loaded,
though Coach is told to build sessions from them); the ability to save a session file
mid-conversation, so the timer app shows the modified workout rather than the base template.
Backend work. SOUL barely changes — a few instructions come *back* once they stop being lies.

**2. Memory.** The thing the athlete says he'd miss most. A **rhythms digest** — a computed
summary of training the way `rendered quest context` is a computed summary of quests — which doubles as
the activity history thread 1 needs. And a **compaction pass**: Coach reads its own journal and
promotes durable patterns into running memory. This already worked once by hand — an insight
drawn from three April data points is still shaping how Coach reads the athlete in August — but
`coach_notes.md` is otherwise never read, and the trigger it was meant to hang on almost never
fires. The memory-file split (profile/memory/injuries/coach_log) that was pre-designed here has
since shipped — see `coach-data-schema.md`; a rhythms digest and compaction pass specifically
remain unbuilt, no pre-design doc for those yet.

**3. Add back what we cut, properly.** Sleep via HealthKit instead of asking. Season and phase
archiving through a server-side ritual. Template personalisation, so a new athlete doesn't
inherit one person's equipment and 8am start. Each gated on the manual-entry rule below.

Two changes to SOUL itself also belong in v6, both gated on the voice eval existing:

- **The backend owns all persistence.** Roughly 40% of SOUL is a file-maintenance manual —
  session files, quest arrays, week-plan contracts, the commit protocol. None of it is coaching.
- **Voice is shown, not described.** §3 and §4 spend ~43 lines describing voice in prose;
  `docs/ref-docs/soul-calibration.md` demonstrates it in less. On a small model examples beat
  adjectives — but note the accounting: 3–4 good examples cost about what the prose costs. **This
  is a quality bet, not a size win.**

*Tracked across the Coach depth and New-user magic epics.*

## Phase 4 — v7: the app becomes the only path

Deliberately after stability. Each of these is a reason the app-only path is the destination
rather than just a simplification:

- **IP containment.** SOUL stops living in athlete repos at all. Raises the priority of ADR
  0021's deferred follow-up — deleting the propagated copies from `coach-akash` and
  `coach-skanda` — which phase 2 temporarily works against.
- **Athlete repos collapse into pure data stores.** No SOUL, no engine, no scripts, no Claude
  config. Much simpler to operate at scale.
- **Rich inline widgets in chat.** The response schema grows past a text `reply`; a workout card
  or trend chart is rendered rather than described. Another chunk of §10 stops being SOUL's job.
- **Coach becomes proactive.** Every interaction today starts with the athlete. "Keeps me on
  track despite a busy life" is a promise a purely reactive system can't keep — a busy person
  doesn't open the app. Only reachable once the app is the path.
- **The athlete's own words survive.** `state.md` and `coach_notes.md` hold Coach's summaries.
  For a memory system the verbatim matters; "I'm scared of getting injured again" carries what
  "athlete reports injury anxiety" doesn't.

---

## Rules we adopted

The first two come from the audit's failure pattern; 3 and 4 from trim PRs that went wrong.

1. **No manual-entry signals** — `kdb/decisions/0023-no-manual-entry-signals.md`. Anything
   requiring the athlete to maintain a record by hand will rot. Evidence: resting HR (empty), PRE
   (3 entries ever, all April), equipment (collected at First Session, never read again),
   `roadmap.md` (a ghost), sleep (entered only when asked). The most motivated user this will ever
   have let all of them decay. A signal ships when it has an automatic source, not before.
2. **SOUL gets a linter** — an issue, not an ADR: it's tooling, cheap to reverse, and nobody will
   re-argue it. Nearly every rot we found was mechanically detectable — paths that don't exist,
   writes the app silently drops, a template list naming more files than the carve ships,
   `propagated/docs/` references that stopped being carved. `validate-soul` asserts paths resolve,
   writes are in that build's writable set, template names match the carve, and section
   cross-references resolve.

3. **SOUL repeats its safety rules on purpose** — the workout-template guardrail lives in §2, §10
   *and* §12. Two separate trim PRs each looked at one copy, judged it redundant, and nearly
   deleted the last one. After any §2/§10/§12 edit, grep **both** builds for the rule.
4. **Trim PRs get their baseline up front** — hand each trim/cleanup PR the list of `validate-soul`
   baseline ids it is meant to resolve *before* it starts, and diff the baseline after. An
   unexpected drop means the PR deleted something outside its scope; no other check catches that.

## The gap that worries me most

**We can test everything except the thing that matters.** The eval covers structure — valid
schema, no fabricated saves, correct paths. It explicitly skips voice, because judging it costs a
second model call per transcript. So v5.8 removes 277 lines from a file whose entire value is
voice, with no voice regression test. BYOB — the runtime both athletes actually use — has no
automated coverage at all.

The fixture material already exists and is orphaned: `docs/ref-docs/soul-calibration.md` is 88
lines of *"athlete says X, a good reply sounds like Y."* It has exactly one reference anywhere in
HQ or the athlete repos — the SOUL line telling Coach not to read it.

This also blocks a decision already in flight: `llm-provider-current.md` says the long-term
provider call gets made "once the system is robust enough to have real usage data and an eval to
judge it by." The eval that would actually separate candidates is the voice one, and it isn't
built. Without it that choice gets made on structural pass rates every candidate will pass.

## Settled — don't re-litigate

- **The app becomes the only path**, but in phase 4, after stability. BYOB is transitional, so
  `SOUL.claude.md` is a **legacy target with an end date**, not a peer. That is what makes the
  two-build split worth doing even so: deleting BYOB later becomes removing one target from the
  composer's `ASSEMBLY` table, instead of re-auditing 500 lines to find what was BYOB-only.
- **Few-shot examples mitigate the Layer A risk but don't replace the eval.** Examples reduce the
  chance of a voice regression; only a test detects one. Build the eval, prove examples carry the
  load, then shrink prose — in that order.
- **The deload rule is deleted, not retriggered.** It never fired once; nothing computes
  week-of-phase. A load-based trigger was considered and rejected — the signals it would need are
  empty in practice.

## Open questions

1. **What triggers the memory compaction pass?** Phase and season close were the natural hooks
   and both are dead ends — unreachable in the app, and rarely fired in BYOB. Gates thread 2 of
   phase 3.
2. **How many testers before "stable" is proven?** Phase 2 assumes a small trusted group on BYOB;
   nothing currently defines what would end that phase and start phase 4.
