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

**Layered soul:** Coach identity, engine rules, and athlete schema live in `platform/soul/` as three source
layers. At HQ, the composed artifact is `platform/SOUL.md` (regenerated via `node platform/scripts/compose-soul.mjs`; CI checks drift). Athlete repos and boot still use root `propagated/SOUL.md` + `user_data/coach/state.md`. To change
coach behavior, edit the relevant `platform/soul/*.md` layer, run compose, commit both the layer edits and the
regenerated `platform/SOUL.md`. Never hand-edit the composed SOUL.

- `SOUL.md` — composed coach brain (HQ: `platform/SOUL.md`; athlete repos: `propagated/SOUL.md` — do not edit directly)
- `engine/` — **skeleton source of truth** (carved into `coach-skeleton`; see `engine/README.md`)
- `platform/soul/` — identity, engine rules, athlete schema layers
- `user_data/` — athlete data (HQ keeps no instance band; lives in athlete repos at scale)
- `ui/` — shared hosted dashboard (HQ-only)
- `ios/` — HealthKit sync app (HQ-only; commits history to user repo)
- `platform/scripts/carve-skeleton.mjs` — operator tool to stamp `sibling-shipyard/coach-skeleton`
- `.github/agents/` — multi-agent role docs (**HQ only**, not carved)
- `kdb/` — engineering decisions (**HQ only**)
- `docs/eng-docs/` — operator/architecture plans (**HQ only**)
- `docs/ref-docs/` — coach skeleton carve source (5 files → athlete `propagated/docs/`)

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
**Recording:** durable rule for your area → that role doc's `## Learnings` (one line, when you discover it mid-task). Tradeoffs with cost → ADR in `kdb/decisions/`.

## How all agents work

Every agent (Tech Lead + workers) follows this. Role docs add scope; they don't override these rules.

**Talk:** Co-worker mode. Replies and plans **10–20 lines max** unless the athlete asks for depth.

**Lists:** Number steps/questions `1, 2, 3`; sub-items on new lines, one tab indent:
```
1. Main step
	a. sub-step
	b. sub-step
```
Athlete may reference `1a` — match that item exactly.

**Priorities:** Quality compromise → **P0/P1** (must fix now). Overengineering / nice-to-have → **P2/P3** (follow-up ticket, one line — don't build unless asked).

**Scope guard:** Ship only what the issue or athlete request defines. Mid-task extras → flag as P2/P3, don't implement. If the athlete goes down a rabbit hole, **stop and confirm scope** in a numbered list before writing more code.

**Execution loop (tasks, not chat):**
1. Plan (~10–20 lines): goal, end state, how we validate.
2. **Stop for approval.**
3. Execute smallest diff that hits end state.
4. Review until clean → PR → short summary back to athlete.

**Docs:** One page max per `kdb/doc-style.md`. No long plans in issues or PR bodies.

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

**UI data files:** At HQ, `ui/client/src/data/` is generated from `shared/golden-dataset/` on
`npm run dev`/`build`. Athlete repos populate it via the sync pipeline — do not hand-edit.

**Coach commits:** Coach Phelps commits coaching memory in **athlete repos** only
(`user_data/coach/state.md`, etc.) — not at HQ root. Procedure in SOUL.md §12.
