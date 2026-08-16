# Post-trim handoff — where to pick up

> Status: Current · Owner: Tech Lead · Verified: 2026-08-16

**Read this after `AGENTS.md` and `.github/agents/tech-lead.md`, not instead of them.** Delete
this file once #358 has landed and the loose ends below are filed or fixed — `docs/plans/` is
delete-on-ship.

## What just finished

SOUL v5.8, the trim. **509 lines → chat 219, claude 365.** Six PRs, all merged Aug 16 2026:
#384 (claude adapter), #386 (agent voice rules), #387 (rare workflows + horcruxes), #388
(first-session predicate fix), #389 (docs), #390 (eval resume).

Layer A — identity, voice, philosophy, situation playbook — was untouched throughout apart from
two named lines. That was the constraint the whole trim was built around. Keep it.

Reference now lives in `docs/eng-docs/soul-two-builds.md`. Narrative in `soul-path-to-v6.md`.
Story in `SOUL_HISTORY.md`. Decisions in ADR 0022–0025.

## Three things that will bite you if you don't know them

1. **The eval cannot catch a SOUL regression.** `ui/scripts/eval-coach-chat.ts` calls `askGemini`
   with `soul: ""`. SOUL is not in the prompt it sends. It was deliberately **not run** for v5.8.
   Run it when you touch prompt construction, the response schema, the model, or the harness —
   nowhere else (ADR 0024). It costs money per call. **Ask the athlete before running it.**
2. **Two SOUL doc pointers dangle in every athlete repo right now.** SOUL tells Coach to read
   `propagated/docs/badminton-plugin.md` and `propagated/docs/season-close.md`; the carve writes
   no docs at all, so Coach follows the pointer and finds nothing. #358 fixes it. Until then the
   badminton file map and the season recap spec are unreachable content, because v5.8 deleted
   them from SOUL and replaced them with those pointers.
3. **Horcruxes are load-bearing, not a joke to clean up.** `platform/horcruxes/` holds soul blocks
   deliberately absent from a build and injected per-turn. ADR 0025 exists specifically to stop a
   future agent renaming them to something more self-documenting. Don't.

## Next: #358 — the only P0

**A freshly carved repo cannot run BYOB.** New athlete gets data, engine scripts, and no Coach.
Was blocked on the trim; it isn't now. Scope is phase 2 of `soul-path-to-v6.md`:

1. Carve `platform/SOUL.claude.md` (never `SOUL.chat.md` — that is coach-chat's and never leaves HQ).
2. `.claude/` + root `CLAUDE.md`, so Claude Code boots as Coach.
3. `propagated/docs/` — five files now: `current-week-contract.md`, `pipeline-tools.md`,
   `timer-state-machine.md`, plus **`badminton-plugin.md` and `season-close.md`**, which the issue
   text predates. Do not restore `phelps-voice-profile.md`, `soul-calibration.md` or
   `milestone-schema.md` — orphaned. Source for all of these is `docs/ref-docs/`.
4. Decide #363: SOUL names four workout templates, the carve ships two. Carve them or trim SOUL.

Landing this clears **9 of the 17 `rot` findings** in `platform/validate-soul-baseline.json`.

**Check for collisions first.** Three open PRs touch the same area: #380 (coach data redesign),
#374 (Part B step 2, `rolling_state.json`), #286 (coach intent schema). #374 especially — Part B
is what clears the 4 `not-yet-rebuilt` baseline findings.

## Loose ends — not yet filed as issues

**These exist only in merged PR bodies. A boot sequence reading `gh issue list` will not see
them.** File them or fix them; do not let them rot here.

| # | Item | Size |
|---|---|---|
| P2 | Weekly Kick-off step 7 tells the **chat** build to "load the relevant JSON template from `…/templates/`" — a file read the app cannot do. Never verdicted in the trim's audit. | Small |
| P3 | `validate-soul` does not scan `platform/horcruxes/`, so injected text gets no path or writable-set checking. First Session's ~44 lines are unchecked. | Small |
| P3 | `isAthleteProfileComplete()`'s `REQUIRED_PROFILE_FIELDS` is label substring-matching. An explicit done-marker written at First Session close would be sturdier — revisit when Part B lands the write path. | Medium |
| P3 | `docs/plans/llm-provider-future.md` cites the bare platform SOUL.md path, a name retired by ADR 0022. Repoint it at `platform/SOUL.chat.md` or `platform/SOUL.claude.md`. | One line |
| P3 | The eval result cache is local-only by design. Sharing it in CI needs a store and a think about trust. | Medium |

## Loose ends — already tracked as issues

**P2:** #361 app writes `current_week.json` without validation · #367 quest/gamification audit ·
#334 dead-code refactor · #343 testing framework (LLM benchmarks + iOS UI tests) · #346
signup-as-runner/cyclist · #345 remove "Phelps" (rebrand) · #341 sleep analytics rebuild · #340
category tagging · #342 epic: ready for strangers · plus the UI-expert queue (#330–#339, #344).

**P3:** #363 carve template drift — folds into #358 item 4.

## The baseline: 24 findings, none fixable by SOUL wording

`node platform/scripts/validate-soul.mjs`. Never weaken a check to make this green — a linter
tuned until it passes looks like coverage and isn't.

| Class | n | Cleared by |
|---|---|---|
| `rot` | 17 | #358 (9: the five `propagated/docs/` refs + badminton/match-history paths), #363 (4: `strength_b` / `recovery` × both builds), the rest with the carve |
| `not-yet-rebuilt` | 4 | coach-chat Part B — `state.md`, `current_week.json`, and two sessions paths |
| `unclassified` | 3 | **A linter bug, not rot.** It attributes a sentence's write verb to a *script path* — `validate-current-week`, `query_history.py`, `generate_quest_log.py`. The write belongs to the data those produce. Same bug bit a new doc pointer in PR #387; reworded around it rather than fixed. |

The check flips to blocking only after the linter bug is fixed **and** Part B lands. Neither is a
SOUL edit. Do not gate a SOUL PR on this reaching zero.

## Open questions nobody has answered

1. **Do the Three Modes fire?** §4 defines Mentor (default), Analyst (weekly planning), Hype Man
   (milestones). Mentor obviously does. Nobody has confirmed the other two ever have. If they
   don't, that is not 4 lines to trim — it is a §4 *quality* problem, the opposite of a cut.
2. **The voice-eval gap (#329).** v5.8 removed 290 lines from a file whose entire value is voice,
   with no voice regression test and no BYOB coverage at all. The fixture material exists and is
   orphaned: `docs/ref-docs/soul-calibration.md`, 88 lines of "athlete says X, a good reply sounds
   like Y", referenced only by the SOUL line telling Coach not to read it.
3. **What triggers memory compaction?** Phase and season close were the natural hooks; both are
   dead ends — unreachable in the app, rarely fired in BYOB. Gates the memory work in v6.

## Housekeeping

- **#357 is still open and should be closed.** The trim is done.
- Leave the primary checkout on `main` when you finish. A feature branch left checked out catches
  the next session's commits.
