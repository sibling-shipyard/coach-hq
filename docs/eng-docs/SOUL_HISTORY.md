# Coach Phelps: SOUL History

> Status: Historical · Owner: Tech Lead · Verified: 2026-07-29

A living record of how Coach Phelps evolved — what changed, and why. Updated with every SOUL.md version.

---

## v5.7 (hq-adopted) — "Personal Brain on Main" · Jul 26, 2026
**Theme:** S0 milestone — adopt personal-repo v5.7 as hq's source of truth on `main`, reconciled not copied.

**What changed:**
- Replaced hq's thinner v1.0 (13 sections) with v5.7's 12-section layout: Commit Protocol §13→§12, Rules Engine §10→§9, First Session folded into §10 Workflows.
- De-personalized: §7 is generic (no athlete name/profile); all Sky/badminton-specific content removed.
- Preserved hq-only: `training/chat_history.json` file-map row, Vercel serverless Sync pipeline note, boot `git pull`, First Session Protocol, `sleep_log.json` + `roadmap.md` in commit ritual.
- Restored v5.7 `current_week.json` workflows (boot read, Weekly Contract Safety, logging reconciliation, Sunday rollover, §12 commit) — genericized, no personal sport data.
- `ui/api/coach-chat.ts` §-references re-pointed to v5.7 numbering; added `current_week.json` to web-chat writable set.

**Why:** Splitting the thinner v1.0 would bake a downgrade into every fork. S0 lands the richer brain first; the three-layer split (S1–S3) comes next.

---

## v5.7 — "Canonical Layout" · Jul 25, 2026
**Theme:** Repo restructure closed. Every hardcoded path in SOUL now matches the on-disk `training/` tree.

**What changed:**
- Boot, guardrails, rituals, and file-roles table updated to the post-M5 layout: `training/coach/`, `training/ledger/`, `training/activities/` (was flat `training/` + interim `contracts/`/`pipeline/` names).
- Analytics output renamed: `training/activities/badminton_analytics_snapshot.json` (on-demand, not at boot — unchanged policy).
- Archived 60-Day Challenge narrative: `training/coach/archive/early_challenge_log.md` replaces standalone `workout_log.md`.
- Static warm-up protocol lives at `training/reference/league_warmup.md` (reference material, not coach memory).

**Why:** M0–M5 reorg landed (#167–#169). Coach boots from paths — stale strings break silently. This version is the path canon after ledger close-out; no behavioral change beyond knowing where files live.

---

## v5.6 — "Milestone Record Contract" · Jul 22, 2026
**Theme:** Build Phase milestones got a structured display/progress lane without touching canonical prose.

**What changed:**
- §8 pointer to new `docs/ref-docs/milestone-schema.md` — authority for optional `short_*` display fields and `progress` blocks on `challenge_v2.json` milestones. SOUL keeps behavior; schema stays in the contract doc (mirrors `current-week-contract.md` pattern).

**Why:** Dashboard Build Phase widget needed terse rows and honest progress bars. Prose milestone names stay canonical for the quest-log generator; structured fields feed the UI without Coach hand-computing percentages.

---

## v5.5 — "Live Weekly Plan" · Jul 20, 2026
**Theme:** The dashboard weekly widget reads Coach's bounded week file, not a static placeholder.

**What changed:**
- Minor SOUL touch-ups aligning with `current_week.json` now rendering live in the v2 home weekly widget (plan rows, completion overlay, Coach commentary surface).

**Why:** v5.4 created the contract; v5.5 wired it to what Sky actually sees on the dashboard — the plan must stay reconciled session-by-session because the UI reflects it in real time.

---

## v5.4 — "The Bounded Week" · Jul 19, 2026
**Theme:** The active week became a dated contract instead of a growing section in durable memory.

**What changed:**
- Added `training/current_week.json` as the single Monday-to-Sunday source for the active plan, session outcomes, safe move provenance, provisional planned load, and short-lived semantic Coach commentary. Boot now validates lifecycle and freshness before trusting it.
- Weekly kick-off, pre-workout checks, workout logging, Sunday rollover, interim saves, rollback, and the closing ritual now read and write the bounded contract. Closed weeks append one concise summary to `training/archive/week_plans.md`; day-by-day schedules no longer return to `training/state.md`.
- Moved exact field, lifecycle, identity, load, commentary, and expiry rules into the authoritative contract; SOUL keeps only the behavioral safety policy and reads the contract before a mutation.
- Added a one-command pre-push check that runs the dashboard's semantic parser, verifies Coach save metadata, and requires a weekly diff review. Expanded the Coach direct-main lane to include `training/current_week.json` and the Coach-owned archives.

**Why:** The dashboard and future iOS experience need one structured weekly source that Coach can update without UI knowledge, while durable state stays compact and truthful. A one-week file creates a hard freshness boundary, preserves history through summaries rather than accumulation, and gives downstream clients safe unavailable behavior when a plan is missing, incomplete, or stale.

---

## v5.3 — "One Source of Truth, One Place for History" · Jun 21, 2026
**Theme:** Stopped duplicating injury status across two files. Gave closed phases a home.

**What changed:**
- §7 static `Injuries:` list removed — it had gone stale against `state.md`'s live `Active Injury Flags` (ankle said "taped for competitive games," shoulder said "flares post-intense" — both had been cleared for weeks). Kept only the permanent, non-changing fact (lower-back injury ~5 years ago, source of the chronic right-side tightness); all current status now points solely to `state.md`.
- New `training/archive/phases.md` — phase and Build-block retrospectives, written once at close, mirroring the existing `training/archive/week_plans.md` pattern. Backfilled with the Base Phase entry. §5 and §8 reference it.

**Why:** Two files claiming to hold injury status is exactly the kind of drift the two-file architecture was built to prevent — `SOUL.md` is the static contract, `state.md` is the live truth, and the moment a status list exists in both, one of them lies. Separately, closing a phase or block needs somewhere to land besides scrolling `coach_notes.md` — the archive gives lookback without growing `state.md` or `SOUL.md`.

---

## v5.2 — "Build Phase" · Jun 21, 2026
**Theme:** Base Phase closed. The 60-Day Challenge framing retired. Build Phase got a real model — sessions, milestones, and a leaner quest list.

**What changed:**
- Boot sequence: new mandatory step — review new Strava activity (`query_history.py --last 10d`) before greeting back, with a freshness guard if the sync looks stale. Replaces waiting to be told what happened.
- §5 Seasons & Arcs: Base Phase marked COMPLETE; Build Phase marked CURRENT, structured as 4-week blocks each closing with a deload + milestone-test week. Old 60-Day Challenge paragraph replaced with the Jun 4 "less prescriptive, more principled" operating-mode reset (don't push a fixed weekly map, trust auto-regulation, programming lands with him not at him).
- §7 Equipment: added the calisthenics park (human flag) and the 400m track.
- §8 Goals & Quests rewritten: main quest is now session count (2.5/wk floor, ≥1.5 loaded) + a milestones list (FL single-leg L/R, freestanding handstand, bar dips, weighted pull-ups, BSS, human flag, sprint baseline, win rate) tested at block boundaries instead of daily-tracked. Added skill-session model (20-min, fresh, capped 0.5×2/wk), human flag progression notes, sprint conditioning (top-end speed, not VO2), and the leg-load periodization rule (sprint/plyo/lower/badminton can't all stack in one week).
- Side quests trimmed: Foundation and Cold Shower graduated to untracked habits (joining Protein, graduated earlier). Only Visualization and Reading remain tracked.

**Why:** The 60-Day Challenge ended at 18/20 — but more importantly, Foundation and Cold Shower had been running long unbroken streaks (Cold Shower ~98% across the phase; Foundation an 83-day unbroken streak with zero unexcused misses, every gap life-excused — illness, travel); tracking them as quests was bookkeeping a foregone conclusion and cluttering the end-of-day check-in with questions that didn't need asking. Meanwhile Build Phase had no model at all — no session floor, no milestones, just vibes. This version gave it one, sized to match how Sky actually wanted to train post-reset (mindful, principled, not a fixed map), and added the boot-time activity review so the coach isn't coached blind into a conversation.

---

## v5.1 — "Drop Per-Game Notation" · Apr 11, 2026
**Theme:** Removed per-game `{pre} :: {post}` format — unmaintainable mid-session and hurts focus between games.

**What changed:**
- Removed per-game notes format (`{game} ... | {pre} :: {post}`) from Pre-Session Mental State section.
- Simplified situation playbook item 10: PRE: score remains, post-game notation references removed.

**Why:** Logging mental state per-game requires writing between matches — exactly when focus should be on recovery and the next game, not note-taking. The session-level `PRE: {score}, {word}` written once before play is enough. The per-game format was never consistently used and the friction of doing it was actively harmful to performance.

---

## v5.0 — "Lean Boot + Calibration" · Apr 6, 2026
**Theme:** SOUL stopped doing four jobs at once. Boot got lean. Guardrails got centralized. Calibration got examples.

**What changed:**
- Boot sequence now loads only `SOUL.md`, `training/state.md`, and `training/quest_log.md` (no analytics at boot). Coach checks London time via `TZ=Europe/London date` for ambient awareness.
- Consolidated guardrails into a single section (boot rules, file edit constraints, on-demand loading).
- Extended Situation Playbook with two real-world edges: multi-day gap re-entry and using mental state (PRE:/game-note) data without judgment.
- Tools section slimmed to purpose/when-to-use; full CLI flag reference moved to `skills/pipeline-tools.md`.
- New on-demand companion files introduced:
  - `docs/ref-docs/soul-calibration.md` — good/bad/borderline output anchors
  - `training/opponent_notes.md` — opponent scouting notes (load when opponent named)

**Why:** v4.1 was operational but brittle: too much loaded at boot, rules scattered, and no examples anchoring voice. v5 reduces boot noise (lost-in-the-middle), centralizes hard constraints, and adds calibration examples so the coach stays Phelps under pressure.

**Design rationale (folded in from the v5 design doc, 2026-04-05):** the framing that drove the
overhaul was that **SOUL.md was doing too many jobs at once** — identity, engine mechanics, athlete
data, and tool documentation in one file. Concrete failure modes observed on v4.1:

- **Wrong-time workout prompts** — no time-of-day awareness; Coach suggested finishing a workout without knowing if it was 9am or 9pm.
- **Stale fitness baseline** — "Push-ups: 30, Pull-ups: 12-13" baked into SOUL.md as of Mar 2026, so Coach quoted outdated numbers.
- **Heavy boot context** — SOUL.md + quest_log.md + analytics_snapshot.json + state.md loaded every session, even a rest-day check-in.
- **Tool docs drift** — the CLI-flag section went silently out of sync whenever scripts changed.
- **Scattered guardrails** — "never edit template files" in one section, "don't read coach_notes.md at boot" in another; one missed sentence caused wrong behavior.
- **Over-specified protocols** — 8 numbered rules for persisting session files, quest polarity mechanics spelled out. Correct, but brittle: spec and reality diverge as the system evolves.
- **No calibration examples** — SOUL defined voice but never *showed* it, so there was no anchor for when Coach drifted.

This "one file, too many jobs" diagnosis is the direct ancestor of the A/B/C layer split
(`platform/soul/A_identity.md`, `B_engine.md`, `C_athlete.md`) that landed later — v5 separated the
jobs *within* one file; the split separated them into three.

---

## v4.1 — "Protocol Tightening" · Apr 3, 2026
**Theme:** The coach got sharper at the edges. Boot friction removed, commit discipline enforced.

**What changed:**
- Boot sequence rewritten to skip `coach_notes.md` — it had grown past 200 lines and reading it in full was slowing every session start. The key context now lives in `state.md` as Rolling Session Notes (last 3 sessions inline)
- Weekly kick-off ritual formalised as a named workflow with explicit trigger phrases, so it reliably happens instead of getting absorbed into general conversation
- Pre-commit checklist added to the commit protocol — 6 boxes to tick before `git add`, replacing the informal "remember to save" framing
- Template path corrected (`training/templates/` → `templates/`)

**Why:** Three real sessions with v4.0 surfaced the same friction points each time. The boot sequence was too loose — coaches were reading the wrong paths, skipping the week planning ritual, and committing without a structured check. The rolling notes idea was practical: don't read the whole archive, just keep the last three sessions visible in state.md. Small changes, but the difference between a protocol that holds under pressure and one that drifts.

---

## v4.0 — "The Phelps Rewrite" · Mar 29, 2026
**Theme:** Full personality transplant. The generic coach was retired. Michael Phelps took over.

**What changed:**
- Identity rewritten entirely around Phelps — process over outcome, personal vulnerability, the 2014 DUI and the comeback, the line about pausing to count the medals
- Voice rules locked in: short sentences, casual vocabulary, signature openers ("Look...", "I think...", "For me..."), emotional before analytical
- "What you are NOT" added — not a data analyst, not a drill sergeant, not a therapist
- Core coaching loop defined: Validate → Share → Redirect
- Three modes introduced: Mentor (default), Analyst (weekly planning), Hype Man (milestones)
- "Lead with data" removed as the first coaching rule, replaced with "Lead with feeling, not data"
- Seasons & Arcs added: The Transformation (Mar 2026 → Jan 2027), split into Base / Build / Peak phases
- Situation Playbook added — 8 failure and edge-case scenarios with explicit emotional approach and example language
- Greeting workflow tightened: no day count, no data opener, one contextual opener only
- Analytics workflow reframed: data is in the back pocket, not on the clipboard

**Why:** v3.1 worked operationally but the coach had no real character. Under pressure — a bad session, a losing streak, an injury — it defaulted to structured status reports. Sky's description of what he actually wanted was "a permanent coach who puts a shoulder around you." That's not a feature; it's a personality. The rewrite started from Phelps because his story maps cleanly: elite results, visible failure, comeback through process discipline. The situation playbook came from a specific gap — there was no guidance on what to do when Sky showed up defeated.

**Design rationale (folded in from the v4 design doc, 2026-03-29, implemented in PR #21):** v3.1
produced a capable but *robotic* coach — it led with data, delivered structured status reports, and
treated every interaction like a system update. The stated goal was "a permanent coach who puts a
shoulder around you and guides you through tough times. Not a dashboard with a personality." Phelps
was chosen as the model because his story maps cleanly onto that: elite results, visible public
failure, comeback through process discipline. Voice was synthesized from 15+ primary sources —
see [`../ref-docs/phelps-voice-profile.md`](../ref-docs/phelps-voice-profile.md) (the profile) and
[`phelps-research-notes.md`](phelps-research-notes.md) (raw notes).

---

## v3.1 — "Pipeline Aware" · Mar 28, 2026
**Theme:** The coach learned how the data actually flows.

**What changed:**
- Full tools section added: `fetch_strava.py`, `query_history.py`, `rename_single.py`, `rename_activities.py` — command syntax, flags, when to use each
- Automated sync pipeline documented end-to-end (Strava fetch → rename → enrich → push to dashboard → Netlify build)
- Session files workflow introduced — coach writes a `sessions/YYYY-MM-DD_<workout_id>.json` before the timer is used, so the timer always gets the coach-adjusted version
- `badminton_analytics_snapshot.json` added to boot sequence as the pre-computed analytics source — no live queries needed
- Commit protocol expanded with an explicit file list and push command

**Why:** The pipeline had matured, but a coach booting in a new thread had no way to know it existed. They'd try to run manual steps that the pipeline had already automated, or miss the session file entirely and send Sky into the timer with unadjusted sets. The tools section needed to be complete enough that no agent ever had to read `strava/README.md` to figure out how things worked. Operational clarity, not new features.

---

## v1.6–v3.0 — Undocumented · Mar 25–28, 2026

*These versions were created in the three days between v1.5 and v3.1. They predate this repo's git history and were not logged in coach_notes.md. The jump from v1.5 to v3.1 likely reflects rapid iteration as the data pipeline was being built — the version number climbed faster than the documentation did.*

---

## v1.5 — "Forward Sync" · Mar 25, 2026
**Theme:** The sync pipeline learned to look both ways.

**What changed:**
- `--sync` rewritten as a two-pass operation: forward pass from `newest_synced` to catch new activities, then backward pass to fill historical gaps
- Token file moved from `~/strava_tokens.json` to `strava/strava_tokens.json` (co-located with the scripts that use it)

**Why:** A sync gap was identified on Day 8 — the single-pass backward sync didn't catch activities logged after the last sync point. New sessions were being missed unless Sky manually saved them. The two-pass fix made the pipeline reliable for daily use: run it once, get everything. The token file move was housekeeping, keeping credentials next to the code that needs them.

---

## v1.4 — "History as Ground Truth" · Mar 24, 2026
**Theme:** Raw Strava data became the canonical record. The human-readable log stepped back.

**What changed:**
- Raw activity data moved into `training/history/` as enriched JSON files — the source of truth for all analytics and coaching context
- `workout_log.md` demoted to human-readable summaries only — no longer the primary data store
- Coach_notes and RPE annotations embedded directly in the JSON, alongside the Strava fields

**Why:** The original design stored workout data in a markdown log that was easy to read but hard to query. As the analytics pipeline matured, having the canonical data in structured JSON files made everything downstream — querying, renaming, enrichment, dashboard sync — straightforward and reliable. The markdown log stayed for readability, but the JSON became the truth.

---

## v1.3 — "The Consolidation" · Mar 24, 2026
**Theme:** Five files became two, and the commit protocol went live.

**What changed:**
- Consolidation completed: `SOUL.md` is now the sole source of truth for the coach's static brain
- Old files deleted: `training/SKILL.md`, `training/progress_summary.md`, `training/references/coach_persona.md`, `training/references/periodization_rules.md`
- Commit protocol activated — the mandatory closing ritual for every session

**Why:** The two-file architecture had been planned since v1.0, but this was the moment it actually went live. The old files existed in parallel through v1.1 and v1.2 as a safety net while the new structure was validated. Once the first real coaching sessions ran successfully on SOUL.md + state.md alone, the old files were removed. The commit protocol went live at the same time — the architecture only works if the state is always saved.

---

## v1.0–v1.2 — "The Foundation" · Mar 17–24, 2026
**Theme:** Portable two-file coaching architecture designed and first drafted.

**What changed:**
- `SOUL.md` created — the static coach brain consolidated from five fragmented files into one (~200-250 lines):
  - `training/SKILL.md` → workflows, Sky profile, goals, tools reference
  - `training/references/coach_persona.md` → identity, voice, coaching style
  - `training/references/periodization_rules.md` → weekly schedule, fatigue rules, deload protocol
- `training/state.md` created — the living memory updated every session, replacing:
  - `training/coach_notes.md` → observations, injury tracking, patterns
  - `training/progress_summary.md` → quest tallies, active flags, week plan
- Coach persona at this point: generic motivational coach, "direct & no-nonsense", leads with data
- Boot sequence established: read SOUL.md → read state.md → coach up
- Versioning header introduced: version number + last-updated date

**Why:** The coach's brain was scattered across 5 files. Every new thread required reading all of them before a single coaching decision could be made. There was no enforced save state — insights surfaced mid-conversation disappeared when the thread ended. Injury status was duplicated across three files and frequently out of sync. The two-file architecture solved all three problems at once: one file for what the coach knows about coaching, one for what's happening right now. Any LLM, any thread, any day — boot from two files and you're live. Full design spec: `archive/SOUL_PLAN.md`.
