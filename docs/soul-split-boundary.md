# SOUL Split Boundary Map (S1)

> **Status:** Design only — Tech Lead sign-off gate for S2  
> **Source:** `SOUL.md` v5.7 (hq-adopted reconciliation) on `main`, 12 sections  
> **Milestone:** S1 of `docs/soul-split-plan.md` — no content moved, no `soul/` files

## Layer definitions

| Layer | Role | S2 artifact |
|-------|------|-------------|
| **A — Soul** | Identity, voice, philosophy — shared, generic, no athlete names or sport-specific rules | `soul/A_identity.md` |
| **B — Engine** | Boot, guardrails, rules, workflows, tools, commit — reads Layer C **generically** (no hardcoded sport/injury/signal) | `soul/B_engine.md` |
| **C — Athlete** | Declarative schema + per-athlete **data** in existing files | `soul/C_athlete.md` (schema) + `training/coach/state.md` + `training/ledger/challenge_v2.json` (data) |

## Section boundary table

| § | Section | Primary layer | Notes |
|---|---------|---------------|-------|
| 1 | Boot Sequence | **B** | Ordered startup: git sync, file reads, timezone/week validation, Strava catch-up, greeting hand-off. Reads C data generically (empty profile → First Session). |
| 2 | Guardrails | **B** | File ownership, direct-to-main commit authority, forbidden edits, on-demand-only reads. |
| 3 | Identity & Voice | **A** | Phelps persona, speech patterns, boundaries (not therapist/drill sergeant/data analyst). |
| 4 | Coaching Philosophy | **A** | Validate→Share→Redirect, three modes, six rules, gamification voice note. |
| 5 | Seasons & Arcs | **A + B** | **Split — see decision below.** |
| 6 | Situation Playbook | **A + B** | **Split — see decision below.** |
| 7 | The Athlete | **C** | Pointer only: profile/injuries/goals live in `state.md`; week plan in `current_week.json`. No inline athlete content. |
| 8 | Goals & Quests | **B** (+ C data) | Quest **type mechanics** and update rules = B. Quest **instances** (names, targets, patterns, dates) = C in `challenge_v2.json`. |
| 9 | Rules Engine | **B** | Periodization defaults, deload cadence, fatigue auto-regulation patterns, recovery Strava typing — all written to consult `sports[]`, `injury_flags[]`, `conditions[]` from C at runtime. |
| 10 | Workflows | **B** | All rituals (First Session, weekly, pre-workout, logging, commit triggers). Populates/updates C files; logic stays generic. |
| 11 | Tools & Data Operations | **B** | Script table, pipeline automation note, session file convention, coach_notes scratchpad. |
| 12 | The Commit Protocol | **B** | Closing ritual sequence, pre-commit checklist, validation commands, interim save, rollback. |

## Ambiguous sections — decisions

### §5 Seasons & Arcs

| Substance | Layer | Rationale |
|-----------|-------|-----------|
| "Think in seasons, not days" | **A** | Coaching worldview — how Phelps frames time. |
| Default phase framework (Base → Build → Peak) | **A** | Generic periodization vocabulary, not athlete-specific dates. |
| Operating mode (principled not prescriptive; weekly spine as default not contract; missed session = data) | **A** | Philosophy of how to coach within a season. |
| Onboarding season example (line 101) | **A** *(illustrative)* | Placeholder showing what a filled-in season *looks like* — not live athlete data. S2 may move to C schema docs as a template snippet. |
| Current Season stored in `state.md`; refined at kick-offs | **B** | Engine knows **where** season data lives and **when** to read/write it. |
| Phase Awareness (check date vs boundaries, reference naturally, no formal announcements) | **B** | Operational trigger + behavior tied to C phase dates. |
| Closing a phase → `archive/phases.md` | **B** | Workflow with file target. |
| The Challenge as kickstart within season | **B** | Engine concept linking `challenge_v2.json` lifecycle to season arc. |

**Recommendation:** Split as above. A holds the *why* and default framework; B holds the *when/where/how* of phase operations. Live season name, dates, and phase boundaries are **C** (`state.md` Athlete Profile / Current Season, and evolved runtime sections like `Current Phase / Block Context`).

### §6 Situation Playbook

| Substance | Layer | Rationale |
|-----------|-------|-----------|
| Situations 1–10: voice, tone, Phelps anecdotes, example lines | **A** | How to *sound* in each emotional context. |
| Situation 10 PRE tone rules (low → check-in/simplify; high → amplify/channel) | **A** *(voice)* + **B** *(trigger)* | Voice half stays A; recognizing `PRE:` as a signal and adjusting plan is B (also duplicated in §10 Pre-Session Mental State workflow). |
| Emotional Logging (situations 1, 2, 3, 6 → `coach_notes.md`) | **B** | Trigger → action mapping; not voice. |

**Recommendation:** A owns the numbered playbook entries (what to say). B owns Emotional Logging and cross-references to §10 workflows where the same trigger fires. S2 should not duplicate PRE handling three times — consolidate trigger logic in B, keep tone guidance in A.

## Straddlers flagged for Tech Lead (do not force in S2)

| Location | Straddle | S2 guidance |
|----------|----------|-------------|
| §8 + `challenge_v2.json` | Quest type definitions (B) vs configured quests, `count_pattern`, season/phase blocks (C) | B documents types and update rules; C schema holds shape; live JSON is data. |
| §9 default week framework | Generic day-type rules (B) vs athlete's sport mix and schedule (C `sports[]`) | B says "adapt for athlete's sport"; C lists sports. No sport names in B. |
| §9 Fatigue Auto-Regulation | Pattern catalog (B) vs which patterns apply today (C `injury_flags[]` / `conditions[]`) | B lists generic substitution rules; C holds active flags. |
| §10 Exercise Explainer #3 | Workflow order (B) vs "their goal or injury context" (C) | B defines steps; reads C at runtime. |
| §1 File roles table | Documents C file paths (B meta) vs file contents (C) | Keep table in B — it's the engine's file map. |
| §5 line 101 example | Illustrative season text in A vs actual season in C | Acceptable in A as onboarding illustration; ensure S2 parity checklist catches it. |

## Athlete-specific content audit (v5.7 → must resolve to C)

Confirmed: **no Sky profile, goals, injuries, or sport-specific coaching rules remain in A/B** after split.

| v5.7 location | Content | Resolves to |
|---------------|---------|-------------|
| §7 entire section | Profile/injury/goal pointers | **C** — `state.md` + `current_week.json` |
| §5 line 101 | Generic onboarding example ("Full Send Season…") | **A** (illustrative only; not Sky) |
| §5 line 94 | "Stored in `state.md`" | **B** pointer; live data **C** |
| §8 quest examples ("morning routine", "finish a book") | Type illustrations | **B** (generic examples) |
| §9 fatigue examples (shoulder, lower back, legs) | Generic pattern catalog | **B** (not athlete flags) |
| §12 commit example ("shoulder-modified workout") | Generic message example | **B** |
| §6 Phelps anecdotes (Beijing, London 2012) | Coach identity stories | **A** (not athlete data) |

**Sky's live data** (profile, 10 Active Injury Flags entries, coaching priorities, milestones, quests, phase context) lives entirely in the sibling `coach-phelps` repo's `training/coach/state.md` and `training/ledger/challenge_v2.json` — none of it is inlined in v5.7 on `main`. S2 extraction targets that runtime data, not SOUL prose.

## S2 compose expectation

Assembled `SOUL.md` = `compose(A, B, C-schema)` must preserve **v5.7 section numbering (§1–§12)** so S0 `coach-chat.ts` §-references stay valid. Layer headers are internal to `soul/`; composed output keeps today's numbered headings.

## Sign-off checklist

- [ ] All 12 sections mapped
- [ ] §5 and §6 splits accepted
- [ ] Straddlers acknowledged (not over-split)
- [ ] No athlete-specific content assigned to A or B
- [ ] B reads C generically — no sport/injury/signal hardcoding in B
