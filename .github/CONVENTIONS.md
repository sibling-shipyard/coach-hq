# Conventions

Universal conventions for all agents. All agent docs reference this file — don't duplicate rules locally.

---

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
- `core: soul layers — periodization overhaul` (regenerates `SOUL.md` via compose)

Always include `fixes #N` in the PR body. PR bodies follow `.github/PULL_REQUEST_TEMPLATE.md`
(GitHub prefills it); issues follow `.github/agents/issue-template.md`.

---

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
- `platform/soul/*.md` (regenerates `SOUL.md`), agent docs, CLAUDE.md, CONVENTIONS.md
- UI source: `ui/client/src/` (components, pages, styles)
- iOS app code (`ios/**` — **never** push directly to main)
- Anything that changes how data is processed or displayed

**If in doubt:** use a branch.

**SOUL changes:** edit `soul/A_identity.md`, `soul/B_engine.md`, and/or `soul/C_athlete.md`, then run
`node platform/scripts/compose-soul.mjs` and commit the layer edits plus the regenerated `SOUL.md`. Never
hand-edit `SOUL.md`.

---

## Knowledge base at commit time

Update the KB in the **same commit** as the change that motivated it — don't leave it for later:

- Made a durable, hard-to-reverse decision? Add or supersede an ADR in `kdb/decisions/`, then
  run `python3 kdb/scripts/gen_adr_index.py`.
- Found a reusable rule for your area? Add a one-liner to your role doc's `## Learnings`.
- Writing a design/architecture doc? Follow `kdb/doc-style.md`.

CI (`validate-kdb`) rejects a malformed ADR, a duplicate number, or a stale index. To catch it
locally before you commit: `ln -s ../../kdb/scripts/pre-commit .git/hooks/pre-commit`.
