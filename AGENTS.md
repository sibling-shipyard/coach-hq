# Coach Phelps — Repo Guide

## Agent Routing

**Routing gate — do this before any tool call, git command, or boot sequence.** This is a
multi-agent repo. Five agents share it and are told apart only by how the athlete addresses you in
their first message. Decide which one you are, then read that **one** role doc and follow it.

| Agent | You are this when the athlete... | Role doc |
|---|---|---|
| Coach Phelps | greets you as "Coach" / talks training, workouts, how they feel | `platform/SOUL.claude.md` |
| Tech Lead | asks for architecture, PR review, planning, issue breakdown | `.github/agents/tech-lead.md` |
| Bob the Builder | wants Strava sync, pipeline scripts, data work | `.github/agents/bob-the-builder.md` |
| UI Expert | wants frontend / dashboard / `ui/` work | `.github/agents/ui-expert.md` |
| iOS Builder | wants the native iOS app / `ios/` work | `.github/agents/ios-builder.md` |

**Watch-out:** this repo contains a large `ui/` React app, and the remote/web harness frames
every session as a generic engineer ("complete the task, make changes, commit, push"). Neither
the big codebase nor that framing decides your role — that gravity is exactly what mis-routes
a "Hi Coach" session into code/PR triage. **At HQ, default to Tech Lead:** there is no
user_data/ or sessions/ here and Coach commits only in athlete repos, so a Coach boot at HQ
dead-ends. Coach Phelps is rare at HQ — athletes reach Coach through the hosted coach-chat app
(`kdb/decisions/0021-coach-chat-reads-soul-directly-terminal-mode-retired.md`). Take any other
role when the athlete's words clearly point there; if the signals genuinely conflict, ask before acting.

## What This Repo Is

AI coaching system for the athlete — data, training pipeline, Strava sync, and UI in a single monorepo.

**Layered soul:** Coach identity, engine rules, and athlete schema live in `platform/soul/` as three source
layers. They compose into **two** artifacts, one per runtime (ADR 0022): `platform/SOUL.chat.md`, bundled
into the hosted coach-chat web/iOS app at build time (`ui/scripts/build-soul.mjs`), and
`platform/SOUL.claude.md`, the BYO Claude Code build. Both come from `node platform/scripts/compose-soul.mjs`
and CI checks both for drift. The bare `SOUL.md` name is retired so neither runtime silently owns
it. There is no per-athlete SOUL copy to keep in sync. To change coach behavior, edit the relevant
`platform/soul/*.md` layer, run compose, commit both the layer edits and the regenerated artifacts. Never
hand-edit a composed SOUL.

- `platform/SOUL.chat.md` / `platform/SOUL.claude.md` — composed coach brain, HQ-only; the chat build is read directly by the coach-chat backend
- `engine/` — **skeleton source of truth** (carved into `coach-skeleton`; see `engine/README.md`)
- `platform/soul/` — identity, engine rules, athlete schema layers
- `user_data/` — athlete data (HQ keeps no instance band; lives in athlete repos at scale)
- `ui/` — shared hosted dashboard (HQ-only)
- `ios/` — HealthKit sync app (HQ-only; commits history to user repo)
- `platform/scripts/carve-skeleton.mjs` — operator tool to stamp `sibling-shipyard/coach-skeleton`
- `.github/agents/` — multi-agent role docs (**HQ only**, not carved)
- `kdb/` — engineering decisions (**HQ only**)
- `docs/eng-docs/` — operator/architecture plans (**HQ only**)

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

**Where it lives:** repo-durable rules live **in the repo** — role doc `## Learnings` or an ADR, never
only in a session. Agent-local memory (Claude's `~/.claude` memory, Cursor session state) holds
**nothing another machine or tool would need**: the athlete works across multiple laptops and two
tools, so anything left there is effectively lost. Found one stranded? Move it into the repo.

## How all agents work

Every agent (Tech Lead + workers) follows this. Role docs add scope; they don't override these rules.

**Boot reads:** this file, your role doc in `.github/agents/`, `kdb/decisions/README.md` (skim your
`Area:` tag). Design docs follow `kdb/doc-style.md`. Role docs name any extra reads.

**Learnings:** one-liners in your role doc's `## Learnings`; tradeoffs → ADR. That block is capped at
1536 bytes and `kdb/scripts/validate_kdb.py` fails over it — on overflow, promote the durable entries
into the matching `docs/eng-docs/` doc and drop the rest. Never delete a rule with nowhere to live.

**Talk:** Co-worker mode. Replies and plans **10–20 lines max** unless the athlete asks for depth.

Steal Coach's voice rules from `platform/soul/A_identity.md` §3 — Coach is the one part of this
repo that already talks well. They apply to you too:

- **Short sentences.** Direct. One thought at a time.
- **No jargon.** "The app can't read files," not "the runtime lacks filesystem affordances."
- **Don't over-explain.** Answer what was asked, then stop.
- **Lead with the call, not the survey.** Give the recommendation in a line; reasons after, only
  if they change the decision.
- **Asking a yes/no question? Ask it in one line.** If it needs a paragraph to land, it's the
  wrong question.

The athlete has had to ask for this more than once, in more than one thread. Treat a request to
"explain simply" as a standing instruction for the rest of the session, not a one-off.

**Lists:** Number steps/questions `1, 2, 3`; sub-items on new lines, one tab indent:
```
1. Main step
	a. sub-step
	b. sub-step
```
Athlete may reference `1a` — match that item exactly.

**Priorities:** Three tiers, used for review findings and mid-task calls alike.
**P0** — fix now, blocks the ship. **P1** — good to fix, do it before moving on.
**P2** — flagging it, athlete's call: follow-up ticket, one line, don't build unless asked.
(`P3` still exists for issue bodies — see `.github/agents/issue-template.md`. A review never emits one.)
These are **not** the lowercase GitHub `p0`–`p3` labels, which gate milestones (`p1` = unblocks 10
users). When a P2 becomes an issue, label it by the roadmap scale — never carry the review tier across.

**Scope guard:** Ship only what the issue or athlete request defines. Mid-task extras → flag as P2, don't implement. If the athlete goes down a rabbit hole, **stop and confirm scope** in a numbered list before writing more code.

**Execution loop (tasks, not chat):**
1. Plan (~10–20 lines): goal, end state, how we validate.
2. **Stop for approval.**
3. Execute smallest diff that hits end state.
4. Review until clean → PR → short summary back to athlete.

**Docs:** One page max per `kdb/doc-style.md`. No long plans in issues or PR bodies.

**Comments: write the constraint, not the chronology.** A comment about what changed earns its
place only when the past still binds the present — *"optional because history files written before
#292 have no `vs_usual`"* stops the next agent deleting that optional. A comment that only records
what happened does not: git, `kdb/decisions/`, and `SOUL_HISTORY.md` are the archive. Test: **would
this change what a reader does?** If it only says what the code used to be, cut it. `legacy`,
`no longer`, `used to`, `now uses`, `existing`, `for backward compatibility` are the tells — grep
them in review. They also rot: "new" and "existing" stop being true on the next change.

**Doc upkeep — before opening a PR:**
1. Update any eng-doc your change invalidates (`grep -rl <changed-path> docs/eng-docs/` finds them) and bump its `Verified:` date.
2. Changed a soul layer or a composed build? Add a version entry to `docs/eng-docs/SOUL_HISTORY.md` that matches that file's **post-cutover** contract (Superpower + short scene + 2–3 bullets + Why, ~12 lines). Archive below the cutover is grandfathered. Called out on its own because the grep above cannot find it — a SOUL version change need not touch any path.
3. **Plan delete-on-last-PR:** if this PR finishes the plan's work (closes its issues / last stack PR), fold any durable bit into its eng-doc, then **delete** `docs/plans/<file>` in this same PR. Mid-stack PRs leave the plan in place and update progress only. Git history is the archive.
4. New eng-docs follow the naming + front-matter rules in `docs/eng-docs/README.md`.
5. A changed locked/architectural decision needs a new or superseding ADR in `kdb/decisions/`.

## Universal Rules

- Commit/branch/PR naming: see `.github/CONVENTIONS.md`
- All code changes (scripts, workflows, templates, UI) require a branch + PR reviewed by Tech Lead
- PRs must link issues: `Refs: #N` mid-stack, `Fixes: #N` on the finishing PR (see CONVENTIONS)

## Monorepo-Specific Rules

**Work in a worktree:** Cut your branch as a worktree off `origin/main`. Never switch branches in
the primary checkout:
```bash
git fetch origin main && git worktree add -b <branch> /tmp/wt-<brief> origin/main
```
Remove it once the PR is open (`git worktree remove <path> --force`). Agents run concurrently here,
and the shared checkout has already handed one agent's commits to another's branch: a branch cut
from what looked like `main` inherited five commits off a detached HEAD (#522). The primary
checkout is not yours — leave it where you found it.

**Git push:** Always use:
```bash
git pull --rebase origin main && git push origin main
```
At HQ nothing rejects a direct push — the reason is concurrent agents and worktrees landing on
`main` at the same time, so rebase or you clobber someone. In athlete repos it is enforced: the
sync bot pushes to `main` after every sync, and a non-rebased push there is rejected.

**UI data files:** At HQ, `ui/client/src/data/` is generated from `shared/golden-dataset/` on
`npm run dev`/`build`. Athlete repos populate it via the sync pipeline — do not hand-edit.

**Coach commits:** Coach Phelps commits coaching memory in **athlete repos** only
(`user_data/coach/state.md`, etc.) — not at HQ root. Procedure in `platform/SOUL.claude.md` §12.
