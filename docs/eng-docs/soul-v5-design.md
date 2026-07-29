# SOUL.md v5 Design Doc — Architecture Overhaul

**Author:** Sky + Tech Lead
**Date:** 2026-04-05
**Status:** Draft — pending review before implementation

---

## 1. Problem Statement

SOUL.md v4.1 is a working system that has proven the core concept. But as the coaching relationship has matured and the feature set has grown, a structural problem is emerging: **SOUL.md is doing too many jobs at once.**

Concrete failure modes observed:

- **Wrong-time workout prompts** — no time-of-day awareness. Coach suggests finishing a workout without knowing if it's 9am or 9pm.
- **Stale fitness baseline** — "Push-ups: 30, Pull-ups: 12-13" is baked into SOUL.md as of Mar 2026. Coach references outdated numbers.
- **Heavy boot context** — SOUL.md + quest_log.md + analytics_snapshot.json + state.md loads every session, even for a rest day check-in. `analytics_snapshot.json` is only relevant for match analysis.
- **Tool docs drift** — Section 10's CLI flags go silently out of sync when scripts change.
- **Scattered guardrails** — "never edit template files" is in Section 9; "don't read coach_notes.md at boot" is in Section 1. One missed sentence causes wrong behavior.
- **Over-specified protocols** — "Persisting Session Files" has 8 numbered rules; the quest polarity table specifies `default_done` vs `default_not_done` mechanics. Correct, but brittle. When the system evolves, spec and reality diverge.
- **No calibration examples** — SOUL.md defines voice but never shows it. No anchor for when Coach drifts.

---

## 2. Research Findings

We surveyed LLM persona architecture patterns, memory tier design, boot/context loading strategies, and protocol design research. Key findings:

### Canonical layer separation

The community has converged on a 4-layer model:

| Layer | Contents | Change frequency |
|---|---|---|
| **Identity** | Who the agent is, voice, values, worldview | Rarely |
| **Protocols** | Workflows, rules, tool-use logic | Occasionally |
| **State** | Current user profile, active goals, recent facts | Every session |
| **Calibration** | Good/bad output examples, anti-patterns | When voice drifts |

Current SOUL.md mixes all four. Separating them makes each independently maintainable.

### Memory tiers (Letta/MemGPT)

| Tier | Role | Our equivalent |
|---|---|---|
| **Core Memory** — always in context | Identity + current user state | SOUL.md + state.md |
| **Recall Memory** — on-demand | Past sessions, specific events | coach_notes.md |
| **Archival Memory** — on-demand | Domain knowledge, reference material | analytics_snapshot, phelps-research-notes, opponent_notes |

Only Core Memory should load at boot. We're currently loading Archival Memory (analytics_snapshot.json) every session.

### Boot loading

Claude Code's own pattern: a lean file loads at session start; topic files load only when accessed. The "lost in the middle" effect is real — information buried in long contexts is less reliably accessed. A leaner boot context improves coaching quality, not just performance.

### Protocol design: rules vs. intent

Research shows up to 19% performance degradation from over-specification. The right split:

| Use **explicit rules** for | Use **expressed intent** for |
|---|---|
| Hard constraints ("never edit templates") | Tone and voice |
| Mandatory workflow steps | Relationship style |
| Output format requirements | Values and philosophy |
| File modification rules | Edge-case judgment calls |

Use **positive + negative examples** for voice calibration — more effective than rules for tone.

### Identity drift prevention

- **Specificity over generality** — the Phelps identity in v4 is well-specified. Don't dilute it.
- **No conflicting rules** — two instructions pointing in different directions cause arbitrary behavior.
- **Calibration examples** — the soul.md community uses `good-outputs.md` + `bad-outputs.md` to anchor voice. We have none.

---

## 3. Design Principles

1. **SOUL.md = identity + stable rules + protocol intent.** Dynamic data belongs in `state.md`. Tool details belong in `skills/`.
2. **Boot lean, load on demand.** Only load what every session needs. Everything else is on-demand.
3. **Explicit rules for hard constraints; expressed intent for everything else.** Over-specifying tone and workflows degrades quality.
4. **Examples over rules for calibration.** A good output example teaches more than three rules about tone.
5. **One place per concern.** Guardrails in one section. Athlete profile in one file. Tool docs in one place.
6. **Athlete profile is owned by state.md.** Anything that changes session-to-session lives there, not in SOUL.md.

---

## 4. File Architecture

### Boot — every session
```
SOUL.md                              Identity, stable protocols, guardrails
training/coach/state.md              Current athlete state (injuries, week plan, fitness baseline, sleep)
training/activities/quest_log.md     Compact quest status
```

### On-demand — never at boot
```
training/analytics_snapshot.json    Match analytics       (when: match discussion, weekly planning)
training/coach/coach_notes.md       Long-term patterns    (when: investigating recurring issues)
training/reference/opponent_notes.md  Nemesis opponent data (when: opponent named in conversation)
docs/phelps-research-notes.md       Phelps anecdote depth (when: telling a specific story)
docs/ref-docs/phelps-voice-profile.md        Voice cadence         (when: generating visualization audio)
docs/ref-docs/soul-calibration.md            Voice examples        (when: voice feels off or testing new SOUL)
```

### New files
```
docs/ref-docs/soul-calibration.md      Good and bad coaching output examples
skills/pipeline-tools.md      Full CLI flag reference, extracted from SOUL.md Section 10
training/reference/opponent_notes.md    Running notes on nemesis opponents (Joe Chung, Tsz To, etc.)
```

---

## 5. SOUL.md Section-by-Section Migration

### Section 1: Boot Sequence → Refactor
Remove `analytics_snapshot.json` from boot. Add: run `date` via bash at boot to get current time — use it for ambient awareness (morning/evening tone, recovery timing, day-of-week confirmation). This is context, not a constraint engine — no hard time-gated rules.

### Section 2: Guardrails → New (consolidated)
New section inserted second, before everything else. Pulls all scattered "never" rules into one place:
- Never modify files outside `training/` or `sessions/`
- Never modify `SOUL.md`, `templates/*.json`, pipeline scripts, or GitHub workflows
- Never push directly to main on `ui/**`
- Never load `analytics_snapshot.json`, `coach_notes.md`, `opponent_notes.md`, or `phelps-research-notes.md` at boot
- Never manually compute streaks or quest rates — read from `quest_log.md`
- You don't write code. If something needs building, tell Sky.

### Section 3: Identity & Voice → No change
v4's identity rewrite is working. The Phelps narrative, "How you talk," and "What you are NOT" are solid. Don't touch.

### Section 4: Coaching Philosophy → No change
Validate → Share → Redirect, three modes, six rules are all working well.

### Section 5: Seasons & Arcs → Minor update
Update current phase description as Base phase progresses. No structural change.

### Section 6: Situation Playbook → Extend
Add two new situations:
- **#9: Sky returns after a multi-day gap** — re-engagement without guilt. Pattern: don't lead with what was missed — no "you've been away" energy, no gap enumeration. Open with genuine curiosity about where he is now. If Sky shares what he was doing (hiking trip, travel, life), engage with it fully — that IS the coaching conversation. The gap is context, not the subject.
- **#10: Sky shares mental state data** — how to use PRE:/game-note data in conversation. Low PRE score → check in before anything else. High PRE score → amplify and channel. Post-game notes → use during debrief to connect mental state to outcomes, not to judge.

Also add to **Section 3 (Identity & Voice)**: 2-3 positive greeting examples showing what TO say — morning after a win, rest day check-in, random mid-week message. (From issue #24 — gives the model concrete anchors, not just anti-patterns.)

### Section 7: The Athlete: Sky → Split

Keep in SOUL.md (stable): who Sky is as a person, badminton schedule and venues, key partners and opponents, Guruji relationship, equipment, injury *patterns* and auto-regulation rules, Inner Game reference.

Move to state.md (dynamic): body weight, fitness baseline with date stamp, RPE calibration examples, current injury flags (consolidate fully from their current partial location).

Add to state.md (new): sleep tracking section, pre-session mental state log (rolling 7 days).

### Section 8: Goals & Quests → Minor update
Add two new side quests:
- **SQ6 (Inner Game Applied):** One line connecting a book concept to a real court moment, logged after each badminton session.
- **SQ7 (Weekly Reflection):** "What did I do this week that Future Sky will thank me for?" One line, logged during Sunday weekly session.

### Section 9: Rules Engine → No change
Periodization, standard week, match week, deload, fatigue auto-regulation — correct and stable.

### Section 10: Workflows → Refactor

| Workflow | Change |
|---|---|
| Greeting & Check-in | No change |
| Pre-Workout Check | Add: current time informs framing (e.g. "you've got time before the evening session" vs "it's late, keep it light") — not hard time gates |
| Weekly Kick-off Ritual | No change |
| Generating a Weekly Plan | No change |
| Persisting Session Files | Simplify — replace 8-rule checklist with intent + one-line schema note |
| Logging a Workout | **Fix mandatory HR lookup** — Step 2 must run `query_history.py --id ACTIVITY_ID` for full details including HR zones. Do not discuss the session without reading HR first. If activity not found, stop and ask: *"I can't find this one yet — has it synced? Hit the Sync button and let me know."* Also apply proactively: any time Sky mentions a recent activity in conversation, look it up for HR context before responding. |
| Tracking Side Quests | No change |
| End-of-Day Check-in | Extend — add sleep score prompt, Inner Game line prompt |
| Daily Check-in | Extend — add PRE: parsing, game-note parsing, sleep score parsing |
| Using Analytics Data | No change |
| Exercise Explainer | No change |
| Visualization Audio | No change |
| Voice & Story Reference | No change |
| **NEW: Sunday Weekly Session** | 30-min weekly ritual: week review, week ahead, mental game thread, calisthenics horizon, weekly reflection |
| **NEW: Opponent Notes** | Read `training/opponent_notes.md` on-demand when opponent named; write after sessions where new patterns emerge |
| **NEW: Pre-Session Mental State** | Parse `PRE: {score}, {word}` from Strava description; use for session tone |
| **NEW: Per-Game Mental Notes** | Parse `{game} \| {pre} :: {post}` inline from game lines; use during badminton debrief |

### Section 11: Tools & Data Operations → Slim down
Keep in SOUL.md: one-line description of each script, the pipeline automation callout, post-sync rename workflow, session files reference.

Move to `skills/pipeline-tools.md`: full CLI flag docs, two-pass sync behavior, counter mechanics, Strava HR zone boundaries.

### Section 12: The Commit Protocol → No change
Rigorous by design. One additive change: add `training/opponent_notes.md` to the git add command since it's a new Coach-owned file that needs committing after updates.

---

## 6. New Files

**`docs/ref-docs/soul-calibration.md`** — 5-6 good output examples (post-bad-session, milestone, wants-to-skip, rest day, weekly plan opener), 3-4 bad output examples (too data-heavy, cheerleader, too long, corporate), 2-3 borderline examples with notes. Tech Lead drafts; Sky approves in PR review. On-demand only.

**`skills/pipeline-tools.md`** — Verbatim extraction of current SOUL.md Section 10 script docs: `fetch_strava.py`, `query_history.py`, `rename_single.py`, `rename_activities.py`, `generate_quest_log.py`.

**`training/opponent_notes.md`** — Running notes on nemesis opponents, seeded with what's known about Joe Chung and Tsz To. Written by Coach after sessions; read on-demand when opponent named.

---

## 7. state.md Schema Changes

Four new sections replace static data currently baked into SOUL.md:

```
## Fitness Baseline
*Last updated: YYYY-MM-DD*
Push-ups / Pull-ups / Plank / Front Lever / Handstand

## RPE Calibration
*Established: [date]*
[Reference points]

## Sleep Log (rolling 7 days)
Date | Score (1-10) | Resting HR | Notes

## Pre-Session Mental State (rolling 7 days)
Date | Session | Score | Word
```

---

## 8. New Format Specs

**Pre-session mental state** (top of Strava description, typed before walking in):
```
PRE: 7, focused
```

**Per-game mental notes** (inline on each game line, optional):
```
Manu me vs Mark/Jonathan 19-21 | sharp :: held the anchor
Ivor me vs Tom/Jake 21-15 | flat :: found it late
```
`|` separates game data from mental notes. `::` separates pre from post. No `|` = parses as normal game line (zero breaking change).

**Sunday Weekly Session** (30 min, trigger: Sunday):
1. Week in review — what happened vs. the plan
2. Week ahead locked — apply Rules Engine, write to `Current Week Plan` in state.md
3. One mental game thread — Inner Game concept / opponent / moment
4. Calisthenics progression — current stage + 6-8 week horizon
5. Weekly Reflection — "What did I do this week that Future Sky will thank me for?"

---

## 9. What We Are Not Changing

- Identity & Voice — v4 rewrite is working
- Coaching Philosophy — working
- Rules Engine — correct and stable
- Commit Protocol — rigorous by design
- Situation Playbook (core 8 situations) — working, only extending
- Quest data model — `challenge_v2.json` schema, `quest_log.md` format
- Session file schema — timer app compatibility
- Pipeline scripts — out of scope

---

## 10. Open Questions

1. **`soul-calibration.md` authorship** — Tech Lead drafts from known-good sessions; Sky approves in PR review. *(Recommended approach, confirm before drafting.)*

*Resolved: live clock = bash `date` call in boot sequence. Per-game format = `| ::` inline. PR #18 closed. Opponent notes will be seeded with known Joe Chung / Tsz To data.*

---

## 11. Validation Criteria

v5 is working when:

1. Coach uses time of day to inform framing and tone — not as a hard constraint blocking workout prescriptions
2. Coach references fitness numbers from state.md, not hardcoded SOUL.md values
3. Boot reads 3 files (SOUL.md, state.md, quest_log.md) — not 4+
4. Coach does not read `analytics_snapshot.json` at boot unprompted
5. When Sky mentions Joe Chung or Tsz To, Coach reads `opponent_notes.md`
6. When Sky logs a session with PRE: in the description, Coach uses it for session tone
7. Sunday session ritual triggers correctly and covers all 5 agenda items
8. Coach outputs match calibration examples in `soul-calibration.md`

Map to `docs/eng-docs/VALIDATION_TESTS.md` before shipping.

---

## 12. Implementation Plan

| Phase | Work | Owner | Status |
|---|---|---|---|
| 1 | Add `date` bash call to SOUL.md boot sequence | Tech Lead | Done |
| 2 | SOUL.md v5 rewrite + new companion files + update `docs/eng-docs/SOUL_HISTORY.md` | Tech Lead | In progress |
| 3 | Pipeline: PRE: + game-note parsing, leaderboard upsert | Bob | Done (Issue #17) |
| 4 | Coach calibration pass: discuss with Coach, then fill `training/opponent_notes.md` from real session observations | Sky + Coach | Pending |
| 5 | Validation — boot Coach in fresh thread, run `docs/eng-docs/VALIDATION_TESTS.md` + update `docs/eng-docs/VALIDATION_TESTS.md` for v5 criteria | Sky + Tech Lead | Pending |
| 5a | End-of-day trigger hardening — only explicit closing signal triggers check-in; interim save commits data only and resumes conversation | Tech Lead | Done |
| 6 | Merge PR #51 | Sky | Done |

**Phase 2 companion files:** `docs/ref-docs/soul-calibration.md`, `skills/pipeline-tools.md`, `training/reference/opponent_notes.md` (template first, then filled in Phase 4). Update `training/coach/state.md` schema. Update `docs/eng-docs/SOUL_HISTORY.md` with v5 entry.

**Post-#25 SOUL update (future):** Once Bob ships the HR stream pipeline (issue #25), add per-match HR workflow to Coach — referencing win/loss HR signatures, ignition speed, etc. Cannot be in v5 as the underlying data doesn't exist yet.

**Estimated scope:** SOUL.md ~300 lines (down from 450). Four new/updated companion files.
