# Conventions

Universal conventions for all agents. All agent docs reference this file — don't duplicate rules locally.

---

<!-- AGENT-KIT:START id="conventions-generic" -->
## Commit Messages

Format: `<prefix>: <description>`

| Prefix | Used by | When |
|---|---|---|
| `coach:` | Coach Phelps | Session data: state.md, coach_notes.md, challenge_v2.json, sessions/, roadmap.md |
| `core:` | Tech Lead | Architecture, `soul/` layers, docs, agent configs |
| `feat:` | Bob, UI Expert | New features — include issue ref: `feat: <desc> (#N)` |
| `fix:` | Bob, UI Expert | Bug fixes — include issue ref: `fix: <desc> (#N)` |
| `data:` | Pipeline (auto) | Auto-generated: sync, quest_log, sync_status |
| `ui:` | UI Expert | Frontend-only changes with no data impact |
| `ios:` | iOS Builder | App code (Swift/SwiftUI) — include issue ref: `ios: <desc> (#N)`; iOS Builder also uses `core:` for cross-cutting changes |

**Coach format:** `coach: day-N — <brief summary>`
Example: `coach: day-8 — shoulder-modified workout, strong session`

**feat/fix must reference the issue:** `feat: add session heatmap (#12)`

No `Co-Authored-By` footers on any commit.

---

## Branch Naming

| Pattern | Used by | Example |
|---|---|---|
| `feat/<issue-N>-<brief>` | Bob, UI Expert | `feat/12-session-heatmap` |
| `fix/<issue-N>-<brief>` | Bob, UI Expert | `fix/7-quest-log-clamp` |
| `feat/ios-<feature-name>` | iOS Builder | `feat/ios-widgetkit-engine` |
| `fix/ios-<description>` | iOS Builder | `fix/ios-sync-race-condition` |
| `core/<brief>` | Tech Lead | `core/soul-v2` |

Coach Phelps pushes session data **directly to main** — no branches needed.

Note: this is a discipline-based convention, not a GitHub-enforced path rule — branch protection applies repo/branch-wide, not per-path.

---

## PR Titles

Format: `<prefix>: <description> (#N)`

Examples:
- `feat: add run pace chart (#12)`
- `fix: clamp quest streak display at 0 (#7)`
- `core: soul layers — periodization overhaul` (regenerates both composed SOUL builds via compose)

## PR Body

Prefill: `.github/PULL_REQUEST_TEMPLATE.md`. Issues: `.github/agents/issue-template.md`.

1. **For humans** — ≤5 lines plain English at the top. What landed and why a human cares.
   Paths, checklists, and agent plans stay *below* the divider — do not replace them with the blurb.
2. **Issue link — required** (keeps the project board alive):
	- Mid-stack or partial ship → `Refs: #N` (links; **does not** close the issue)
	- Last PR that finishes the issue's Done when → `Fixes: #N` (closes on merge)
	- Same `#N` on every PR in the stack. Never ship with neither keyword.
3. Closing keywords (`Fixes` / `Closes` / `Resolves`) only on the finishing PR — first merge
   must not close a multi-PR issue.

## Issues and Project 4

Issues are the work record; [Project 4](https://github.com/orgs/sibling-shipyard/projects/4) is the
human view. Every issue uses the contract in `.github/agents/issue-template.md`:

- `Area: plain-English problem or outcome` title, at most 90 characters.
- Exactly two short preview sentences, then `## Done when` and `## Scope`.
- Exactly one `area:*` label and one `type:*` label, plus an M3, M4, or Later milestone.
- Effort is Low / Medium / High in Project 4. The retired `p0`–`p3` labels are not a priority scale.

`needs-triage` is automation-owned: it marks a malformed issue and blocks a linked PR. A valid issue
that still needs a product or scope call uses `needs-decision` and asks one concrete question; do not
start implementation until that question is answered.

Project status follows Backlog → Ready → In progress → In review → Done. Ready is a human triage
decision; draft PRs set In progress, ready PRs set In review, and a merged finishing PR sets Done.
Use the Needs triage, Now, Later, and By area views instead of a second priority field.

---

## Stacked PRs

**Default for multi-part work.** One PR per theme, each branching off the previous one, merged
bottom-up. A seven-PR stack (#399–#405) is what proved this out. Small sequential PRs off `main`
are still right for work that genuinely has no ordering.

Four mechanics make it work — skip one and it turns into the mess stacking is famous for:

1. **One PR per theme, not per arbitrary slice.** Each has to stand on its own in review. If you
	can't say what a PR is *about* in one line, it's a slice, not a theme.
2. **Fix at the lowest branch that owns the problem, then rebase-cascade upward** with
	`git rebase --onto <fixed-base> <old-base>` and `git push --force-with-lease`. Never patch the
	same bug at two levels.
3. **Verify each PR's file list against the branch**, not against local `main` — a stale `main`
	has under-reported a branch here before. `gh pr view <n> --json files`, or
	`mcp__github__pull_request_read` with `method: get_files` in sessions with no `gh`.
4. **Merge bottom-up**, and rebase the whole stack onto current `main` before you start.
5. **`Refs: #N` on PRs 1…n−1; `Fixes: #N` only on PR n.** Board stays linked; issue closes once.

**Put late-arriving cross-cutting edits at the TOP of the stack, not the bottom** — even when
they belong to the bottom PR semantically. An edit at the base forces a rebase of everything
above it; the same edit on top costs nothing.

**Plan docs:** the last PR that finishes a `docs/plans/` plan deletes that plan file in the same
PR (`AGENTS.md` § Doc upkeep). Git history is the archive.

---

<!-- AGENT-KIT:END -->
## Direct-to-Main vs Branch + PR

Paths below are the athlete-repo layout (`user_data/`, `gen/`) - HQ itself doesn't hold populated
coach data (ADR 0011, R5); these conventions apply once carved out to a real athlete repo.

**Direct to main (no PR):**
- Coach session data: `user_data/coach/state.md`, `user_data/coach/coach_notes.md`, `user_data/ledger/challenge_v2.json`, `sessions/`
- Pipeline-generated: `user_data/activities/hist/`, `gen/quest_log.md`, `user_data/sync_status.json`
- UI data bundle (pipeline writes): `ui/client/src/data/`
- Activity renames (history JSON only)

**Always branch + PR:**
- Scripts, workflows, GitHub Actions
- Templates (`user_data/activities/workout_plans/templates/*.json`)
- `platform/soul/*.md` (regenerates the composed SOUL builds), agent docs, CLAUDE.md, CONVENTIONS.md
- UI source: `ui/client/src/` (components, pages, styles)
- iOS app code (`ios/**` — **never** push directly to main)
- Anything that changes how data is processed or displayed

**If in doubt:** use a branch.

**SOUL changes:** edit `soul/A_identity.md`, `soul/B_engine.md`, and/or `soul/C_athlete.md`, then run
`node platform/scripts/compose-soul.mjs` and commit the layer edits plus both regenerated builds,
`platform/SOUL.chat.md` and `platform/SOUL.claude.md` (ADR 0022). Never hand-edit a composed SOUL.

---

## Knowledge base at commit time

Update the KB in the **same commit** as the change that motivated it — don't leave it for later:

- Made a durable, hard-to-reverse decision? Add or supersede an ADR in `kdb/decisions/`, then
  run `python3 kdb/scripts/gen_adr_index.py`.
- Found a reusable rule for your area? Add a one-liner to your role doc's `## Learnings`.
- Writing a design/architecture doc? Follow `kdb/doc-style.md`.

CI (`validate-kdb`) rejects a malformed ADR, a duplicate number, or a stale index. The full local
gate enables the repo's versioned hooks for the current clone with repository-local git config:

```bash
bash platform/scripts/check.sh --quiet
```

`.githooks/pre-commit` runs the knowledge-base validator, refuses staged `node_modules` paths and
absolute-target symlinks, flags added comments that record chronology instead of a constraint, and
blocks a direct commit to `main`. It is plain git, so it holds under Claude Code, Codex and Cursor
alike. `.githooks/pre-push` runs the full local gate and blocks on required-check failures.
`validate-soul` reports a non-blocking warning, matching GitHub. GitHub checks remain authoritative.
