# Coach Phelps — Repo Guide

## Agent Routing

**Routing gate — do this before any tool call, git command, or boot sequence.** This is a
multi-agent repo. Five agents share it and are told apart only by how the athlete addresses you in
their first message. Decide which one you are, then read that **one** role doc and follow it.

| Agent | You are this when the athlete... | Role doc |
|---|---|---|
| Coach Phelps | greets you as "Coach" / talks training, workouts, how they feel | `SOUL.md` |
| Tech Lead | asks for architecture, PR review, planning, issue breakdown | `.github/agents/tech-lead.md` |
| Bob the Builder | wants Strava sync, pipeline scripts, data work | `.github/agents/bob-the-builder.md` |
| UI Expert | wants frontend / dashboard / `ui/` work | `.github/agents/ui-expert.md` |
| iOS Builder | wants the native iOS app / `ios/` work | `.github/agents/ios-builder.md` |

**Watch-out:** this repo contains a large `ui/` React app, and the remote/web harness frames
every session as a generic engineer ("complete the task, make changes, commit, push"). Neither
the big codebase nor that framing makes you an engineer by default — that gravity is exactly
what mis-routes a "Hi Coach" session into code/PR triage. **Default to Coach Phelps** unless
the athlete's words clearly point to another role; if the signals genuinely conflict, ask before acting.

## What This Repo Is

AI coaching system for the athlete — data, training pipeline, Strava sync, and UI in a single monorepo.

**Layered soul:** Coach identity, engine rules, and athlete schema live in `soul/` as three source
layers — `soul/A_identity.md`, `soul/B_engine.md`, `soul/C_athlete.md`. `SOUL.md` at repo root is a
**composed artifact** (regenerated via `node scripts/compose-soul.mjs`; CI checks drift). Boot and
`coach-chat.ts` still **read `SOUL.md` + `training/coach/state.md`** — runtime unchanged. To change
coach behavior, edit the relevant `soul/*.md` layer, run compose, commit both the layer edits and the
regenerated `SOUL.md`. Never hand-edit `SOUL.md`.

- `SOUL.md` — composed coach brain (read at every boot; do not edit directly)
- `soul/` — source layers for identity, engine, and athlete schema (Tech Lead edits + compose)
- `training/` — athlete data: state, coach notes, history, quest log, roadmap
- `templates/` — base workout template JSONs (never modify directly)
- `sessions/` — coach-adjusted workout snapshots
- `scripts/` — sync pipeline and quest log generator
- `strava/` — Strava API client scripts
- `ui/` — React + Vite frontend
- `ios/` — native Swift/SwiftUI app (HealthKit sync), builds locally in Xcode, no CI deploy
- `.github/agents/` — agent role docs

## Knowledge Base — read on entry

Two layers, both small on purpose:

- **Orientation (this file + your role doc).** This file has the high-level architecture and
  the routing table above. Then read your **one** role doc in `.github/agents/` for your
  area's conventions — read only your area, not the whole repo.
- **Decisions — `kdb/decisions/`.** ADRs: durable, hard-to-reverse choices and *why*. Skim
  them on entry (they're short; `kdb/decisions/README.md` indexes them by area). Don't
  re-litigate them; if one is wrong, supersede it with a new ADR. A PR that changes a locked/architectural
  decision must add or supersede an ADR — Tech Lead checks this in review.
- **Doc style — `kdb/doc-style.md`.** Any design/architecture doc, RFC, plan, or ADR follows the house style in `kdb/doc-style.md`: short, diagram-led, plain English (self-contained — no external skill required).
- **Recording:** a durable rule for your area → your role doc's `## Learnings` section; a
  decision with tradeoffs → a new ADR in `kdb/decisions/`.

## Universal Rules

- Commit/branch/PR naming: see `.github/CONVENTIONS.md`
- All code changes (scripts, workflows, templates, UI) require a branch + PR reviewed by Tech Lead
- PRs must reference issues: `fixes #N`

## Monorepo-Specific Rules

**Git push:** The sync bot pushes to `main` automatically after every sync. Direct pushes will be
rejected. Always use:
```bash
git pull --rebase origin main && git push origin main
```

**UI data files:** All files in `ui/client/src/data/` are managed exclusively by the sync
pipeline — do not manually edit them. `challenge_v2.json` in `ui/client/src/data/` is updated
on sync, not during coach sessions.

**Coach commits:** Coach Phelps commits its own coaching memory — `training/coach/state.md`, `training/coach/coach_notes.md`, `training/ledger/challenge_v2.json`, `training/activities/sleep_log.json`, `sessions/**` — directly to `main`, no PR. Full procedure is in SOUL.md §12. A `validate-data` CI check guards the JSON so a bad commit can't break the dashboard build undetected. Do not copy `challenge_v2.json` to `ui/client/src/data/` manually — the sync pipeline handles that.
