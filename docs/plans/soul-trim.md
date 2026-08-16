# SOUL v5.8 — the trim

> Status: Current · Owner: Tech Lead · Verified: 2026-08-15

Line-by-line audit of `platform/SOUL.md` (v5.7, 509 lines) and what comes out. Narrative and
sequencing live in `docs/eng-docs/soul-path-to-v6.md`; this doc is the execution detail.

**Scope:** SOUL content only. Findings that turned out to be app, carve, or product work were
filed as issues under the existing epics and are not repeated here. Tracked as the SOUL v5.8
trim issue under the Coach depth epic; delete this file when the four PRs below have landed and
`docs/eng-docs/soul-two-builds.md` carries the durable part.

## Why there is anything to cut

The composed file ships whole to two runtimes. BYOB Claude Code has shell, git, and file reads.
coach-chat (Gemini) has none, and is told outright to ignore any instruction it can't execute
(`ui/api/coach-chat.ts:585`). Roughly half of what the app receives falls under that.

```
509 lines
├── ~127  dead or duplicated in BOTH runtimes   ── pure deletion + squash
├── ~78   only reachable with a shell/git       ── claude adapter
├── ~54   rare, gated by athlete state          ── conditional injection (app)
├── ~21   rare, gated by nothing checkable      ── on-demand doc (BYOB only)
└── ~229  genuinely shared coaching instruction ── the actual SOUL
```

The third and fourth buckets are different mechanisms and worth keeping apart. **Conditional
injection** needs a predicate the backend can evaluate *before* the turn starts — First Session
(`isAthleteProfileComplete()`) qualifies. **On-demand** means a file BYOB opens when it needs it;
badminton and the season recap spec land here because their triggers can't be known in advance,
and because every file they reference is unreachable in the app anyway.

**Layer A — identity, voice, philosophy, situation playbook — is untouched in every step.**

## Verdict by block

`CUT` = delete from both · `CLAUDE` = claude adapter only · `COND` = backend-injected /
on-demand · `KEEP` = shared core · `SQUASH` = keep the rule, cut the words

Section headings and blank lines are omitted — the table covers content blocks only.

| § | Lines | Block | n | Verdict | Why |
|---|---|---|---|---|---|
| — | 1–4 | Version header | 4 | CUT | `v5.7 (hq-adopted reconciliation)` means nothing to a model |
| 1 | 5–17 | Boot Sequence steps | 13 | CLAUDE | chat is told to skip it entirely |
| 1 | 19 | coach_notes-at-boot note | 1 | CLAUDE | no boot in chat |
| 1 | 21–40 | File-roles table | 20 | CUT | nothing folded — 14 rows duplicate the point of use, 2 describe files Coach never touches |
| 2 | 43 | "You don't write code" | 1 | CLAUDE | chat system prompt already says it, stronger |
| 2 | 44–45 | Push authority, branch pinning | 2 | CLAUDE | chat has no git; backend gates writes |
| 2 | 46 | "Never modify `propagated/SOUL.md`" | 1 | CUT | carve stopped writing that file (ADR 0021) |
| 2 | 47 | Never edit `gen/quest_log.md` | 1 | CLAUDE | not in chat's writable set |
| 2 | 48 | Never compute streaks | 1 | KEEP | real behaviour |
| 2 | 49 | Never-read-at-boot list | 1 | CLAUDE | 3 of its 5 paths no longer exist post-ADR 0021 |
| 3 | 51–73 | **Identity & Voice** | 23 | KEEP | the asset. Untouched. |
| 4 | 75–94 | Coaching Philosophy | 20 | KEEP | 4 rules restate §3, deliberately kept — see the duplicate rule |
| 5 | 96–104 | Seasons & phases | 9 | KEEP | |
| 5 | 106 | Example season ("Full Send") | 1 | COND + rewrite | genericise; kickoff/first session only |
| 5 | 108 | Phase awareness | 1 | KEEP | |
| 5 | 110 | Closing a phase | 1 | CLAUDE | `archive/phases.md` not writable in chat |
| 5 | 112–114 | Closing a season | 3 | CLAUDE | app silently drops the write |
| 5 | 115 | Season recap spec | 1 | CLAUDE→doc | 400 words for a twice-a-year event → `propagated/docs/season-close.md` |
| 5 | 117–119 | The Challenge, Operating mode | 2 | KEEP | |
| 6 | 121–131 | Situation Playbook | 11 | KEEP | densest coaching value in the file |
| 6 | 133 | Emotional logging → coach_notes | 1 | REWRITE | behaviour right, destination wrong — app must point at `coach_note` |
| 7 | 136 | The Athlete | 1 | KEEP | |
| 7 | 138–177 | **Athlete Schema (MVP) YAML** | 40 | CUT | see below |
| 7 | 179–193 | Data Locations table | 15 | SQUASH→5 | nine of eleven rows say "it's in state.md" |
| 7 | 195 | stray `---` | 1 | CUT | |
| 8 | 197–204 | Quest types | 8 | KEEP | |
| 8 | 206–208 | "Polarity explained" | 3 | CUT | verbatim restatement of 201–202 |
| 8 | 210–218 | Excused/missed + rules | 8 | KEEP | absorbs the mechanics from §10's deleted table |
| 9 | 220–228 | Rules Engine, week framework | 9 | KEEP + rewrite | fix the "Layer C" leak and `sports[]` |
| 9 | 230–233 | **Deload Week (every 4th week)** | 4 | CUT | never fired once — see dead rules |
| 9 | 235–242 | Fatigue auto-regulation, recovery class | 8 | KEEP | the half that works |
| 10 | 246–298 | **First Session Protocol** | 53 | COND | predicate already exists, just isn't used to gate the prompt |
| 10 | 300–305 | Greeting & Check-in | 6 | CLAUDE | app injects a longer, better version per turn |
| 10 | 307–313 | Pre-Workout Check | 7 | KEEP | the safety gate |
| 10 | 315–323 | Weekly Kick-off | 9 | KEEP | absorbs 332–340's unique steps |
| 10 | 325–330 | Weekly Contract Safety | 6 | SQUASH→3 | line 330 is shell validators |
| 10 | 332–340 | Generating a Weekly Plan | 9 | MERGE −6 | steps 1–3 identical to Kick-off's 1–3 |
| 10 | 342–358 | Persisting Session Files | 17 | SQUASH→9 | states the filename convention three times |
| 10 | 360–369 | Timer Physics Fields | 10 | SQUASH | better expressed as values in the templates Coach copies |
| 10 | 371–381 | Logging a Workout | 11 | KEEP 3 in app | steps 2/3/5/6/8 need a shell or files the app lacks |
| 10 | 383–392 | Tracking Side Quests | 10 | CUT | polarity table, stated a **third** time; mechanics fold into §8 |
| 10 | 394–401 | End-of-Day Check-in | 8 | CLAUDE | app's close detection is deterministic (`isCloseSignal`) |
| 10 | 403–407 | Daily Check-in | 5 | KEEP | minus the sleep dual-write clause |
| 10 | 409–416 | Sunday Weekly Session | 8 | KEEP | step 2 archive write is CLAUDE |
| 10 | 418–419 | Pre-Session Mental State | 2 | CUT | PRE removed (#301) |
| 10 | 421–428 | Exercise Explainer | 8 | SQUASH→3 | point 4 asks for images neither runtime renders |
| 10 | 430–449 | Badminton plugin | 20 | CLAUDE→doc | gate and every file it names are unreachable in the app |
| 11 | 451–466 | Tools & Data Operations | 16 | CLAUDE | script tables; also re-states §10 and §12 |
| 12 | 468–471 | Commit preamble | 4 | KEEP 2 | "state the sequence aloud" is odd for a JSON response |
| 12 | 473–477 | Commit steps 1–5 | 5 | KEEP 4 | step 5 (coach_notes) is CLAUDE |
| 12 | 478–488 | Pre-Commit Checklist | 11 | SQUASH→5 | re-states steps 2–5 as checkboxes |
| 12 | 489–497 | Commit and push | 9 | CLAUDE | |
| 12 | 500–502 | "What NOT to update" | 3 | CUT | duplicates §2 lines 47–48 |
| 12 | 504–509 | Interim Save, Rollback | 5 | CLAUDE | git-only |

**Whole sections that disappear from the app build:** §1, §11, and all but ~6 lines of §12.
**Sections untouched in both:** §3, and §6 apart from one rewritten line.

**Result: ~232 lines for the app build, ~289 for BYOB** (with First Session, badminton, and the
season recap spec moved to files BYOB opens on demand).

## The three findings worth arguing about

**1. The Athlete Schema block (40 lines) is addressed to the wrong reader.** It explains the
prompt's own architecture to the model: *"Layer C is the extensibility seam"*, *"B reads these
fields generically"*, *"B never hardcodes sport names"*, plus a note about a backlog ticket. It
ships an explicitly `RESERVED` empty `tracking_modules: {}` every turn. And it describes a shape
that exists nowhere — `carve-skeleton.mjs`'s `STATE_MD_TEMPLATE` writes markdown bullets, which
SOUL's own line 184 admits (*"Freeform bullets today"*). **It also already lives in
`docs/eng-docs/soul-C-schema.md`**, verbatim, so deleting it loses nothing. Bump that doc's
`Verified:` date and note the schema no longer ships in the composed SOUL.

*Knock-on:* `injury_flags[]` / `conditions[]` / `sports[]` appear 15 times, 8 in live
instructions, four as *"Read `injury_flags[]` / Active Injury Flags"* — invented name beside real
heading. Deleting the schema lets those 8 sites name what's actually on disk. Pre-Workout Check
is one of them.

**2. Quest polarity is explained three times** — lines 201–202, then 206–208 verbatim, then again
as a table at 388–392.

**3. `roadmap.md` is a ghost.** In §1's table and §12's checklist, but no code references it,
`carve-skeleton.mjs` doesn't scaffold it, and it isn't app-writable — so a chat close that
"updates" it is silently discarded. Remove from both.

## Dead rules — instructions pointing at things that don't exist

- **Deload week never fired, not once.** The rule says "every 4th week" and *nothing computes
  week-of-phase* — `quest_log.md` tracks ISO weeks for quest pacing only; state.md stores phase
  dates with no instruction to count from them. Confirmed against the athlete's experience: Coach
  has never proposed a deload, while the reactive half of §9 works fine because it triggers on
  something observable. **Delete, do not replace.** Considered and rejected: a load-based trigger
  on sleep / resting-HR / RPE trend — the Resting HR column is empty in practice, so that trigger
  would have been as dead as the calendar one.
- **"Competition week" is invoked twice and defined nowhere.** Lines 319 and 336 both say "apply
  the Rules Engine — standard, competition, or deload week"; §9 defines neither. Both collapse to
  "Apply the Rules Engine (Section 9)."

## The duplicate rule

Cut duplicated **reference material** (§1's file table, §7's schema — lookup tables Coach never
acts on). Keep duplicated **behavioural rules** (§4's voice rules, §8's "don't count streaks
manually"). Restating an instruction in a second context on a small model is cheap insurance
against an expensive failure, and voice regressions are exactly what the evals don't catch.

## Approved replacement text

**Line 106, the example season.** Currently carries the athlete's own season ("Full Send Season,
Jun 18 → TBD… 2x strength, 2x sport-specific, 1x cardio, 1x free"), which is specific enough to
anchor a new athlete's first season toward someone else's training shape. Genericised, keeping
one in-voice goal example so the *tone* still demonstrates:

> *(Shape of a defined season — the athlete's real one replaces this at kick-off: "\<name\>,
> \<start\> → \<end or TBD\>. Goal: \<one sentence in the athlete's words about what changes by
> the end — e.g. "get strong enough that injury fear stops calling the shots"\>. \<Phase\> runs
> \<dates\> with a weekly spine of \<the few sessions they'll actually hit\>; next phase defined
> at the next kick-off.")*

Drops the sport mix, the session counts, and the season name. Keeps every structural cue: name,
dates, a goal stated as a change rather than a metric, a dated phase, a spine sized to reality,
and the next phase deferred.

## Open question — do the Three Modes fire?

§4 defines Mentor (default), Analyst (weekly planning), and Hype Man (milestones). Mentor
obviously fires. **Nobody has confirmed the other two ever do.** Raised during the audit and left
unanswered.

If Analyst and Hype Man never fire in practice, that isn't 4 lines to trim — it's a sign the
mode-switching instruction is too weak to act on, which is a §4 *quality* fix and the opposite of
a cut. Worth watching for during the manual voice read on PR 2 rather than deciding in advance.

## Feature removals landing in this trim

- **PRE** (#301) — §6 situation 10, §10's Pre-Session Mental State block, the state.md table.
- **Sleep** (#300) — cut the *asking*, keep the schema: delete Coach asking for hours, the
  dual-write instruction in §10 and §12, the checklist line, and the hand-maintained Sleep Log
  table. Keep `sleep_log.json` and the widget shape unfilled so the HealthKit sync (#341) drops
  into an existing slot.

## Sequencing

1. **PR 1 — composer targets.** `compose-soul.mjs` gains `targets: ["claude","chat"]` per
   `ASSEMBLY` step; emit `SOUL.claude.md` + `SOUL.chat.md`; wire carve, `ui/scripts/build-soul.mjs`,
   and CI `--check` on both. Byte-identical content. Decision already recorded in
   `kdb/decisions/0022-two-composed-soul-builds.md`. Ship `validate-soul` alongside it — the split
   is what makes "which build is this rule for" expressible.
2. **PR 2 — the ~127 dead and duplicated lines.** Applies to both builds, so it needs the most
   care. §7 alone is 54 of them. Eval before/after, plus a manual voice read on BYOB since it has
   no eval. This is also where sleep and PRE come out.
3. **PR 3 — claude adapter.** Move the ~78 shell/git lines. App build drops to ~300.
4. **PR 4 — the rare workflows.** Two mechanisms, not one:
	a. *Conditional injection (app):* First Session, gated on `isAthleteProfileComplete()`.
	   Blocks land in the **dynamic** half of the prompt, never the cached prefix
	   (`ui/api/_lib/soulCache.ts`), or we fragment the cache per athlete.
	b. *On-demand docs (BYOB):* badminton and the season recap spec become files Coach opens
	   when it needs them, with a one-line pointer left behind.

   App lands ~232, BYOB ~289.

## Risk

The 9 golden transcripts (`npm run eval:coach-chat`) cover chat structurally, not voice, and
cover BYOB not at all. PR 2 is the only one that changes shared content; everything else is a
move. Keep PR 2 small and reviewed line-by-line. The voice-eval gap is tracked on #329.

**PR 2 also breaks the eval suite, and the obvious fix would hide it.** Six of nine transcripts
touch sleep; `04-close-missing-info.json` depends on it structurally. Its purpose is *"close
signal with nothing concrete discussed — must ask for missing info, never fabricate a save"*, and
what makes Coach ask is the closing prompt's checklist — *"today's sleep, side-quest status,
injury flags"* — where **sleep is the only member a genuinely empty conversation always lacks**.
Remove it and 04 may pass for the wrong reason. Rewrite that transcript around a signal that
still exists; do not just delete its sleep references. Detail on #300, which also needs the
`coach-chat.ts` closing prompt edited, not only SOUL.

## Verification note

Line counts are estimates from the section walkthrough, not measured against a built artifact.
Re-verify the table above once PR 1 lands and the two targets actually compose.
