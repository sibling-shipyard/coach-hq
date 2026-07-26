# SOUL.md Implementation Plan

## 1. The Goal

Create a portable, two-file system (`SOUL.md` + `state.md`) that lets Coach Phelps boot up identically in any new thread or platform. The conversation is disposable. The soul is permanent.

## 2. Current State (The Problem)

The coach's brain is fragmented across 5 files that must all be read at startup:

| File | Lines | Content |
|------|-------|---------|
| `training/SKILL.md` | 148 | Workflows, user profile, goals, context loading strategy |
| `training/references/coach_persona.md` | 28 | Voice, tone, coaching philosophy |
| `training/references/periodization_rules.md` | 39 | Weekly scheduling logic, fatigue rules |
| `training/coach_notes.md` | 73 | Observed patterns, injury tracking, coaching priorities |
| `training/progress_summary.md` | 48 | Quest tallies, active flags, current week plan |
| **Total** | **336** | |

Problems with this approach:
- New threads must read all 5 files before coaching can begin.
- No enforced "save state" — insights discovered mid-conversation are lost when the thread ends.
- Duplicated information across files (e.g., injury status appears in SKILL.md, coach_notes.md, and progress_summary.md).
- As coach_notes.md grows, the boot payload bloats.

## 3. The Solution: Two-File Architecture

### `SOUL.md` — The Static Core (~200-250 lines)

Defines *who* the coach is and *how* he operates. Rarely changes (monthly review). Versioned with a version number and last-updated date at the top — bump on every change.

> **Design principle:** Don't over-compress. If the file is tight but the coach boots up "correct but flat," something's missing. Better to start at 250 lines and trim later than to lose the voice.

| Section | Content | Source |
|---------|---------|--------|
| **Identity & Voice** | Michael Phelps persona, tone, vocabulary, communication style | `coach_persona.md` |
| **Coaching Style** | How to coach Sky specifically — lead with data, keep it short, be a thinking partner, callback to history. Also includes permanent relationship learnings (e.g., "Sky pushes back on over-engineering — keep suggestions simple") | `coach_persona.md` + grows over time |
| **The Athlete** | Sky's profile, body weight, diet, equipment, badminton schedule, fitness baseline, injuries | `SKILL.md` |
| **Goals & Quests** | 60-day challenge structure, quest definitions (Main + SQ1-5) | `SKILL.md` |
| **Rules Engine** | Periodization microcycles (standard week, match week), deload protocol, fatigue auto-regulation | `periodization_rules.md` |
| **Workflows** | How to generate weekly plans, log workouts, track side quests, adjust for fatigue, handle daily check-ins | `SKILL.md` |
| **Tools** | Full operational instructions for `fetch_strava.py` and `query_history.py` — command syntax, flags, token file location (`~/strava_tokens.json`), output format, and `training/history/` data layout. Must be complete enough that the coach never needs to read `strava/README.md` at boot. | `SKILL.md` + `strava/README.md` |
| **Boot Sequence** | Exactly which files to read at conversation start | `SKILL.md` |
| **Commit Protocol** | The closing ritual — mandatory state save before ending any conversation | New |

### `training/state.md` — The Living Memory (~100 lines)

Tracks the *current state* of training and the coaching relationship. Updated every session.

| Section | Content | Source |
|---------|---------|--------|
| **Current Status** | Day X of 60, quest tallies, active week plan | `progress_summary.md` |
| **Active Injury Flags** | What's sore, what's modified, what's cleared | `progress_summary.md` + `coach_notes.md` |
| **Learned Patterns** | Training patterns, nutrition patterns, dropout triggers | `coach_notes.md` |
| **Key Milestones** | Important events with dates | `coach_notes.md` |
| **Coaching Priorities** | Ordered list of what to focus on | `coach_notes.md` |
| **Relationship Notes** | Evolving observations from recent sessions (not permanent style notes — those go in SOUL.md's Coaching Style section) | New (grows over time) |
| **Last Session Vibe** | 1-2 line emotional/tonal snapshot of the most recent conversation. E.g., "Energetic. Built Strava pipeline together. Sky compared this to Jarvis." | New (updated every session) |
| **This Week's Workouts** | Condensed version of the current week's workout prescriptions (exercises, sets, reps). Full templates remain on-demand for reference. | Inlined from `workout_templates.md` weekly |

## 4. Boot Sequence

SOUL.md is self-bootstrapping. Its first section tells any agent how to start:

```markdown
## Boot Sequence
1. Read this entire file (SOUL.md).
2. Read `training/state.md`.
3. You are now Coach Phelps. Greet Sky and pick up where the last session left off.
```

Three ways to trigger the boot:

| Method | How | Best for |
|--------|-----|----------|
| **Manus skill** | Update the `badminton-calisthenics-coach` skill to be a 3-line boot loader: clone repo, read SOUL.md + state.md | Auto-trigger in Manus when Sky says "log a workout", "weekly plan", etc. |
| **Manus project instructions** | Add to the "Mental coach" project: "Clone https://github.com/akash-suresh/coach-phelps. Read SOUL.md and training/state.md. You are Coach Phelps." | Every new thread in the project auto-boots the coach |
| **Manual boot prompt** | Paste into any LLM: "Clone https://github.com/akash-suresh/coach-phelps. Read SOUL.md and training/state.md. You are Coach Phelps. Begin." | Portability — works on ChatGPT, Claude, or any agent with file access |

All three methods are documented in the README.

## 5. The Commit Protocol

Baked into SOUL.md as a hard operational rule:

**Before ending any conversation, the coach MUST:**

1. **Reflect:** What new information was learned this session? (New injuries, workout data, pattern discoveries, relationship insights, quest progress.)
2. **Update `state.md`:** Edit the relevant sections with new data. Keep it concise — state.md should never exceed ~150 lines. If a section grows too long, summarize and archive detail to `workout_log.md`.
3. **Commit & push:** `git add training/state.md && git commit -m "[coach-notes] day-X: [brief summary]" && git push` (e.g., `[coach-notes] day-8: shoulder-modified workout A, visualization guide`)
4. **Confirm:** Tell Sky the save is complete.

**Interim save (autosave rule):** If the conversation has gone more than 10 exchanges without a commit, do an interim save. Commit state.md with `[coach-notes] day-X interim: [context]`. This protects against abrupt conversation endings (tab closed, context limit hit, timeout).

**If the coach updates SOUL.md itself** (rare — only for rule changes or profile updates), it must be a separate commit: `git commit -m "[coach-notes] SOUL update: [what changed]"`.

**Rollback:** If state.md is corrupted by a bad update, run `git log training/state.md` to find the last good commit, then `git checkout <hash> -- training/state.md` to restore it.

**workout_log.md is append-only.** Never edit old entries. If something was logged wrong, add a correction entry — don't rewrite history. Git diff should always make sense.

## 6. File Restructuring

### Created

| File | Purpose | Updated | Loaded at boot |
|------|---------|---------|----------------|
| `SOUL.md` | Identity, voice, rules, workflows, commit protocol | Monthly | Always |
| `training/state.md` | Current status, patterns, relationship notes | Every session | Always |

### Kept (load on demand)

| File | Purpose | When to load |
|------|---------|--------------|
| `training/references/progression_paths.md` | Front Lever / Handstand stage details | When doing skill work or assessing progression |
| `training/templates/workout_templates.md` | Exercise prescriptions for Workouts A-D | When generating a specific workout |
| `training/workout_log.md` | Full daily logs | When comparing sessions or analyzing trends |
| `training/week_plan.md` | This week's detailed schedule | Referenced from state.md; load for full detail |

### Deprecated (deleted after merge)

| File | Merged into |
|------|-------------|
| `training/SKILL.md` | `SOUL.md` |
| `training/references/coach_persona.md` | `SOUL.md` |
| `training/references/periodization_rules.md` | `SOUL.md` |
| `training/coach_notes.md` | `training/state.md` |
| `training/progress_summary.md` | `training/state.md` |

## 7. Execution Steps

1. Draft `SOUL.md` by consolidating the static content from the deprecated files. Target: ~200-250 lines. Don't sacrifice clarity for line count. Add version header (e.g., `v1.0 — 2026-03-24`).
2. Draft `training/state.md` by consolidating the living content from coach_notes and progress_summary. Target: ~100 lines.
3. Write the commit protocol instruction block into SOUL.md.
4. Delete the deprecated files.
5. Update `README.md` to reflect the new architecture.
6. Update `TODO.md` with the revised roadmap.
7. Update the `badminton-calisthenics-coach` Manus skill to a boot loader pointing at SOUL.md.
8. Commit everything as a single "SOUL.md v1" commit.
9. Test: open a brand new thread with zero prior context. Give it just the boot sequence. Say "Morning coach" and verify it feels right — does it ask about the shoulder? Does it mention today's workout? If it boots "correct but flat," the voice needs more texture.
