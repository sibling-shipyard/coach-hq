# Doc overhaul: LLD

> Status: Plan · Owner: Tech Lead · Verified: 2026-09-19

Overview, decisions and stack summary: `docs/plans/doc-overhaul.md`. This file is the build handoff.

## Stack mechanics

- Linear stack, one PR per theme, merged bottom-up (`.github/CONVENTIONS.md` § Stacked PRs).
  `final base` is the previous PR's branch. PR 1 branches off `main` after the plan PR merges.
- File overlap decides parallelism. PRs 11 and 12 touch no doc files, so they can be built in parallel
  with PRs 3 to 10 and rebased into the stack before review.
- A PR's diff stays a subset of its `files` cell. Verify with `gh pr view <n> --json files`.
- Late cross-cutting fixes go on the top of the stack, not the bottom.
- Each doc PR: commit, `bash platform/scripts/check.sh --quiet`, push, wait for green on the pushed SHA.
- Workers write in the same order every time: read the source, draft `## Agent`, then write `## Human`
	from it. A subagent per PR, briefed cold. I review the diff, open the PR and push. Bob owns PR 11.
- Reuse the four diagrams from the closed branches `docs/p1-gemini-flow`, `docs/p1-coach-chat-docs`
	and `docs/p1-diagrams` (`git checkout <branch> -- <svg>`). Verify each against the source before it
	ships. They are not trusted as written.

## Stack table

| PR | milestone | outcome | final base | files | owner | parallel with | result |
|---|---|---|---|---|---|---|---|
| 1 | M1 | Shape and rule | `main` | `kdb/doc-style.md`, `AGENTS.md`, `STEERING.md`, `docs/eng-docs/README.md`, `docs/eng-docs/platform-agent-kit.md`, `platform/agent-kit/VERSION` | Tech Lead | none | New style, rule, hist folder rule live |
| 2 | M1 | Archive and delete | PR 1 | `docs/hist/**`, moved and deleted docs, citation sites | Tech Lead | none | `docs/hist/` populated, plans clean |
| 3 | M2 | LLM cluster | PR 2 | `gemini-flow`, `chat-llm-seam`, `llm-provider-current` (deleted), `chat-provider-bench`, `env-vars`, two plans, 2 SVG pairs | Tech Lead | 11, 12 | ADR 0046 true everywhere |
| 4 | M2 | Coach-chat docs | PR 3 | `coach-chat-{flow,daily,testing,test-scenarios,fsp,message}`, 1 SVG pair | Tech Lead | 11, 12 | Front door plus lifecycle diagram |
| 5 | M3 | Data, soul, platform, ops | PR 4 | see PR 5 below | Tech Lead | 11, 12 | Entity map, scaling plan trimmed |
| 6 | M3 | iOS docs | PR 5 | see PR 6 below | Tech Lead | 11, 12 | iOS docs current |
| 7 | M3 | Ref-docs | PR 6 | `docs/ref-docs/*`, `platform/skills/pipeline-tools.md` | Tech Lead | 11, 12 | Athlete-facing docs clean |
| 8 | M4 | Overview and CI | PR 7 | `platform-system-overview.md`, `ops-ci-workflows.md`, 1 SVG pair | Tech Lead | 11, 12 | One doc explains the system |
| 9 | M4 | Deploy, web, widgets | PR 8 | `ops-deploy-topology.md`, `platform-web-client.md`, `ios-widgets.md` | Tech Lead | 11, 12 | Front end and hosting documented |
| 10 | M4 | Data path | PR 9 | `data-current-week.md`, `data-derived-pipeline.md`, `platform-athlete-repo-lifecycle.md` | Tech Lead | 11, 12 | Data path documented |
| 11 | M5 | Scrub, app | PR 10 | `ui/api/**`, `ui/scripts/**`, `engine/**` comments only | Bob the Builder | 3 to 10 | No tells in app code |
| 12 | M5 | Scrub, platform | PR 11 | `platform/scripts/**`, `.github/agents/*.md`, `platform/soul/*.md`, kept plans | Tech Lead | 3 to 10 | No tells in platform |
| 13 | M6 | Lock | PR 12 | `kdb/scripts/validate_kdb.py`, `.githooks/pre-commit`, `platform/scripts/checks.conf`, `platform/tests/**`, workflow `paths:`, both plan files (deleted) | Tech Lead | none | CI enforces |

## PR detail

**PR 1: shape and rule.**
1. Rewrite `kdb/doc-style.md`. Keep ADR and executable-plan sections. Replace "one page max" with the
	Human/Agent shape, no cap on Human, Agent splits into `<name>-lld.md` past about 150 lines.
	Add the diagram rule (mermaid default, SVG pair for dense architecture views).
	Drop "(PR #586 feedback, rated 2/5)" and "(handover rated 1/5)".
2. `AGENTS.md`: replace "Comments: write the constraint, not the chronology" with the universal
	no-audit-trail rule (text below). Rewrite "Doc feedback" so a low
	rating becomes a rule line with no rating in it. Add the `docs/hist/` row to Doc upkeep.
3. `docs/eng-docs/README.md`: add `docs/hist/`, drop the deleted-doc anecdote (lines 22 to 25).
4. `STEERING.md`: add `ROADMAP.md` to the reading order.
5. Bump `platform/agent-kit/VERSION`. The carve sanitizer forbids provider names in the block.
6. Migrate `platform-agent-kit.md` to the new shape as the first worked example.

The rule text:
> No audit trails, anywhere: code comments, docs, role docs, READMEs. No issue or PR numbers, no dates
> outside `Verified:`, no "was", "now", "previously", "legacy", "no longer", "used to", "formerly",
> "as of". State what is true today. Git is the archive. Exceptions: ADR Context, `SOUL_HISTORY.md`,
> `docs/hist/`, and a comment where the old shape still binds the code (write the constraint, not the story).

**PR 2: archive and delete.** Repoint every citation in the same PR (`grep -rn <name>` over the repo).
| Doc | Action | Known citation sites |
|---|---|---|
| `coach-chat-design-history`, `coach-commit-mvp`, `hq-port-plan`, `hq-restructure-plan`, `phelps-research-notes`, `soul-C-schema`, `website-unification-history`, `activity-naming-migration`, `challenge-v2-schema` | move to `docs/hist/` | ADRs 0006, 0045, `engine/lib/challenge_schema.py`, `carve-skeleton.mjs` header, `env-vars.md`, `SOUL_HISTORY.md` |
| `docs/plans/backend-decision`, `coach-chat-prompting-research` | move to `docs/hist/` | none found |
| `docs/plans/ops-agent-setup`, `agent-restructure`, `coach-chat-live-test-round-2`, `openrouter-m2-chat-lld`, `gemini-full-removal-if-ever` | delete | code comments cite `openrouter-m2-chat-lld`, repoint to `chat-llm-seam.md` |
| `docs/plans/coach-conversation-widgets-roadmap` | set `Status: Plan` (it says Current) | none |
`SOUL_HISTORY.md` stays. Scripts and the carve sanitizer cite it.

**PR 3: LLM cluster.**
1. `gemini-flow.md`: rewrite as the call path (prompt shape, retries, response schema, model pin).
	Chronology out. Human section explains one coach reply, start to finish.
2. `chat-llm-seam.md`: absorb `llm-provider-current.md` (provider choice, ADR 0046, cost). Adopt the
	adapter-seam diagram. Add the one-line "full Gemini removal is deferred" note.
3. `chat-provider-bench.md`: fix the `gemini-pro-latest` claim, drop the measurement-log narrative.
4. `env-vars.md`: `LLM_PROVIDER` default and `GEMINI_API_KEY` wording, add `COACH_CHAT_DEBUG_PROMPT`
	and `COACH_CHAT_EXPOSE_USAGE` (read in code, undocumented).
5. Plans `chat-openrouter-migration` and `chat-coach-bench`: fix the stale "production still selects
	Gemini" claim and the `ui/eval/` paths.

**PR 4: coach-chat docs.**
1. `coach-chat-flow.md`: stop being an index. Rewrite as the coach-chat front door: what a turn does,
	request lifecycle diagram, links to the rest. Fix "backed by Gemini".
2. `coach-chat-daily.md` and `coach-chat-testing.md`: trim, new shape, fix ADR 0046 claims, remove
	citations to files that do not exist.
3. `coach-chat-test-scenarios.md`: stays a catalog. Fix the transcript count (21, not 23), drop "new;"
	labels.
4. `coach-chat-fsp.md`, `coach-chat-message.md`: migrate to the new shape, verify against code.
5. **Grading gate.** The athletes rate PR 3 and PR 4 docs 1 to 5. Anything 3 or below is rewritten
	before PR 5 starts. Rewrites go into the same PR, not a new one.

**PR 5: data, soul, platform, ops.**
1. `coach-data-schema`: rewrite around the entity map. Tables move to Agent.
2. `scaling-plan`: collapse to current status and links. Strava and Gemini claims go. Human explains the two-repo model.
3. `skeleton-layout`: drop the banner, fix about 28 dead paths, set Current honestly.
4. `soul-path-to-v6`: trim to the thesis.
5. `ops-observability`: fix the production model claim.
6. Migrate the rest: `soul-two-builds`, `github-auth`, `golden-dataset`, `sentry-runbook`, `platform-workouts-compiler`.

**PR 6: iOS.**
1. `ios-app-spec`: drop the Strava and Netlify framing and title.
2. Migrate `ios-sync`, `ios-xcode-setup`, `healthkit-richer-signals` and its `-lld`, `hr-zones`.
3. Promote `ios/CoachHQ/AppState-StateMachine.md` to `docs/eng-docs/ios-app-state.md` in the new shape.
4. Fold `ios/DESIGN.md` and `ios/5-5-ROADMAP.md` into the matching eng-doc, or give them front matter.

**PR 7: ref-docs.** Only three ref-docs ship: `current-week-contract.md`, `timer-state-machine.md`,
and `platform/skills/pipeline-tools.md` (`PROPAGATED_DOCS`, `carve-skeleton.mjs:574`). Scrub tells in
those three. Give every other ref-doc standard front matter. Fix the `HOW_IT_WORKS` citation in the
README and the dead paths in `season-close.md`. Decide `milestone-schema.md` (historical, cited only by
docs): move to `docs/hist/`.

**PR 8 to 10: new docs.** Each in the new shape, each verified against source. Read lists:
| Doc | Read |
|---|---|
| `platform-system-overview.md` (with glossary: HQ, athlete repo, skeleton, carve, horcruxes, FSP, engine, BYOB, widgets) | `AGENTS.md`, the band READMEs, ADRs 0011, 0022, 0025, 0036 |
| `ops-ci-workflows.md` (12 HQ workflows, 4 athlete-side, required vs manual vs scheduled, path gating) | `.github/workflows/*`, `kdb/scripts/*`, `platform/scripts/check.sh`, `checks.conf`, ADRs 0024, 0047 |
| `ops-deploy-topology.md` | `ui/vercel.json`, `ui/scripts/build/*`, `ui/api/README.md`, ADR 0017 |
| `platform-web-client.md` (pages, data flow, adding a widget) | `ui/client/src/App.tsx`, `hooks/useRepoData.ts`, `useWidgetSnapshots.ts` |
| `ios-widgets.md` (extension, snapshot store, token pipeline) | `shared/warm-instrument/*`, `ios/CoachHQ/CoachHQWidget/`, ADRs 0005, 0039, 0043 |
| `data-current-week.md` (writers, rollover paths, contract) | `engine/lib/current-week*.mts`, `engine/scripts/*rollover*`, ADRs 0042, 0049 |
| `data-derived-pipeline.md` | `engine/scripts/*`, `engine/.github/workflows/sync.user.yml` |
| `platform-athlete-repo-lifecycle.md` | `carve-skeleton.mjs`, `engine/.github/workflows/*`, ADR 0030 |

Two-repo topology diagram goes into the overview (PR 8). Rating gate: athletes rate the overview.

**PR 11 and 12: scrub.** Comment-only edits, no behavior change. Keep the constraint, drop the story.
Worst files first: `ui/api/coach-chat/_lib/turnReplyValidation.ts`, `_lib/llm/coachReplySchema.ts`,
`_lib/requestCoachReply.ts`, `_lib/sentry.ts`, `coach-chat.ts`, `auth/[...action].ts`. PR 12 also
scrubs the remaining plans, except plans with an open PR against them (revisit at rebase).
Verify each PR with the tell grep below, then the full local gate.

**PR 13: lock.**
1. `validate_kdb.py`: for Current eng-docs in the branch diff, error if `## Human` or `## Agent` is
	missing, out of order, or Human is empty. No length cap. Skip `docs/hist/`, `README.md`,
	`SOUL_HISTORY.md`, Historical docs and plans.
2. Extend the tell scan (`.githooks/pre-commit:67`) to markdown and to `existing`, `formerly`,
	`was removed`, `was deleted`, `as of`, `#NNN`, `PR #`. Added lines only. Add a CI copy, since a
	local hook is bypassable.
3. Add both to `checks.conf`, and make sure a workflow `paths:` list actually runs them (a comment
	mentioning `check.sh` proves nothing).
4. Tests in `platform/tests/`. Run each check against a real marked file, not its regex.
5. Delete `docs/plans/doc-overhaul.md` and this file.

## Carve and backfill

Runs after PR 12 merges, before PR 13. Skip if `git diff` over PRs 1 to 12 shows none of the three
propagated docs changed.
1. Run `node platform/scripts/carve-skeleton.mjs` to populate `coach-skeleton`. The diff must show only
	the propagated docs.
2. Backfill the athlete repos, all local under `~/Projects/`. Candidates: `coach-skanda`,
	`coach-akash`, `coach-prateek`, `coach-shreyas`, `coach-phelps-template`. The athlete confirms the
	list before I touch any repo.
3. Only `propagated/docs/` is written. Coach's files (`user_data/coach/*`, ledger, sessions) are never
	touched. Find the existing update path in `platform/README.md` and the carve script first. Do not
	hand-copy if a sync script exists.
4. Verify per repo: `git diff --stat` shows only `propagated/docs/`. Push each with
	`git pull --rebase origin main && git push origin main`, only after the athlete says so.

## Verification commands

```bash
python3 kdb/scripts/validate_kdb.py > /tmp/kdb.log 2>&1; grep -c "^error" /tmp/kdb.log
grep -rniE "legacy|no longer|previously|formerly|was removed|was deleted|as of|used to be|now uses" docs kdb .github/agents AGENTS.md
grep -rnE "\(#[0-9]{2,4}\)|PR #[0-9]+" docs kdb .github/agents AGENTS.md
```
Path check: extract backticked paths from each Agent section and `ls` them (the audit loop, reused).
Negative test for PR 13: a scratch branch that touches an old doc without the sections, and a comment
with `(#123)`, both fail CI.
