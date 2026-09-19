# Doc overhaul: audit, Human/Agent style, no audit trails

> Status: Plan · Owner: Tech Lead · Verified: 2026-09-19

## Context

Opening a doc in `docs/eng-docs/` means reading all of it to learn what the system does. The audit
(63 docs checked against HEAD `672b14c9`) found:

- 24 of 63 accurate. 11 stale, 3 with dead paths, 12 too long to skim, 7 historical, 4 shipped plans.
- ADR 0046 (production runs on OpenRouter) never reached env-vars, coach-chat-daily, coach-chat-flow,
  gemini-flow, coach-chat-testing, chat-provider-bench.
- The provider cluster (gemini-flow, llm-provider-current, chat-llm-seam, chat-provider-bench)
  explains the same seam four times.
- 799 audit-trail lines: 537 `#NNN` refs, 161 dates, plus "no longer", "legacy", "previously".
  Worst: ui/api 345, docs/eng-docs 280, docs/plans 110. `kdb/doc-style.md` itself says "rated 2/5".
- Nothing gives a current end-to-end picture. `scaling-plan.md` still calls Gemini the coach and
  Strava live. No glossary exists. CI workflows, cron and week rollover, Vercel topology, the web
  client, widgets and tokens, the derived-data pipeline and the athlete-repo lifecycle have no doc.
- The chronology rule exists only as a local pre-commit regex on added code comments. Markdown and CI
  are not checked.

End state: every Current eng-doc opens with a plain-language Human section, then an Agent section
with paths. No chronology anywhere. A hard check keeps it that way.

## Decisions already made

1. Historical docs move to `docs/hist/`, untouched. No deletes for them.
2. Scrub audit trails everywhere including code comments.
3. Missing Human/Agent sections on a touched eng-doc is a hard error.

## The new doc shape (goes in `kdb/doc-style.md`)

```
# Title
> Status: Current · Owner: <role> · Verified: <date>

## Human
What it is, how it works at a high level, what it does and what it does not do.
Plain language, no file paths. As long as the idea needs. A mermaid diagram (flow, sequence,
or a PR-lens view of what touches what) is expected wherever the system has moving parts.

## Agent
Paths, symbols, contracts, env vars, commands, gotchas. What exists today.
```

- Human answers "what is this and how does it work" for someone who never opens the repo.
  No line cap. Some systems cannot be explained short, and cutting them makes it useless.
- Agent is today's style. Over ~150 lines, split the drill-down into `<name>-lld.md`.
- Exempt: `docs/hist/`, `README.md`, `SOUL_HISTORY.md`, `docs/plans/`, ADRs (own format).
- Replace the "one page max" line with the Human guidance above plus the Agent split rule.
- Remove "(PR #586 feedback, rated 2/5)" and "(handover rated 1/5)".

## The no-audit-trail rule

Wording for `AGENTS.md` (replaces "Comments: write the constraint, not the chronology" with a
universal rule, same slot):

> No audit trails, anywhere. Not in code comments, docs, role docs, READMEs, or PR-independent
> prose. No issue or PR numbers, no dates outside `Verified:`, no "was / now / previously /
> legacy / no longer / used to / formerly / as of". State what is true today. Git is the archive.
> Exceptions: ADR Context, `SOUL_HISTORY.md`, `docs/hist/`, and a comment where the old shape still
> binds the code (say the constraint, not the story).

Also fix the "Doc feedback" rule so a low rating becomes a rule line with no rating in it.

## PR stack

Freshness gate first: open PRs #1216, #1217, #1218 rewrite gemini-flow, coach-chat daily/testing and
add diagrams. They overlap PR 3 and PR 4 files. I will not merge them. Either they land first or PR
3/4 waits and rebases. Your call at execution time.

| PR | outcome | files | owner | result |
|---|---|---|---|---|
| 1 | Style + rule text | `kdb/doc-style.md`, `AGENTS.md`, `docs/eng-docs/README.md`, `platform/agent-kit/VERSION`, `docs/eng-docs/platform-agent-kit.md` | Tech Lead | New shape and rule written. No enforcement yet |
| 2 | Archive and delete | `docs/hist/**`, `docs/plans/**`, citation fixes in code and ADRs | Tech Lead | 7 Historical docs, `backend-decision.md` and `activity-naming-migration.md` moved to `docs/hist/`, shipped plans deleted |
| 3 | Fix stale facts and merge cluster | env-vars, coach-chat-flow, coach-chat-daily, coach-chat-testing, gemini-flow, llm-provider-current, chat-llm-seam, chat-provider-bench, ops-observability, ios-app-spec, skeleton-layout, scaling-plan, root `README.md`, `ui/README.md` | Tech Lead (docs) | ADR 0046 true everywhere, provider cluster folded into `chat-llm-seam.md`, dead paths fixed |
| 4 | Migrate remaining docs to Human/Agent | all other Current eng-docs | Tech Lead (docs) | Every Current eng-doc has both sections |
| 5 | New docs | `platform-system-overview.md` (with glossary), `ops-ci-workflows.md`, `ops-deploy-topology.md`, `data-current-week.md`, `data-derived-pipeline.md`, `platform-web-client.md`, `ios-widgets.md`, `platform-athlete-repo-lifecycle.md` | Tech Lead (docs) | Gaps closed, each in the new shape |
| 6 | Scrub code comments, app | `ui/api/**`, `ui/scripts/**`, `engine/**` | Bob the Builder | Tell lines gone, constraints kept |
| 7 | Scrub code comments, platform | `platform/scripts/**`, `.github/agents/*.md`, `platform/soul/*.md` | Tech Lead | Same, in Tech Lead scope |
| 8 | iOS docs and ref-docs front matter | `ios/DESIGN.md`, `ios/5-5-ROADMAP.md`, `ios/CoachHQ/AppState-StateMachine.md` (becomes `docs/eng-docs/ios-app-state.md`), `docs/ref-docs/*.md`, `docs/ref-docs/README.md` | Tech Lead | iOS design and state docs live in eng-docs in the new shape, or are folded in. Ref-docs get standard front matter |
| 9 | Carve and backfill | `platform/scripts/carve-skeleton.mjs` run, `coach-skeleton`, local athlete repos (`propagated/docs/` only) | Tech Lead | Skeleton re-carved, athlete repos backfilled. Skipped if PR 8 and PR 1 change nothing that ships |
| 10 | Enforce | `kdb/scripts/validate_kdb.py`, `.githooks/pre-commit`, `platform/scripts/checks.conf`, `platform/tests/**`, `.github/workflows/*` covering the new check | Tech Lead | Hard errors live |

Order rationale: 1 first (defines shape). 2 before 3 so I do not fix docs that are about to leave.
6 and 7 can run parallel with 3 to 5 (disjoint files). 8 after 5. 9 after 8, since ref-docs are the
only docs that ship. 10 last, so the check passes on a clean tree.
Scaling-plan gets trimmed to a plan-era Human/Agent doc in PR 3, then the overview in PR 5 replaces
it as the entry point.

## PR 10 check details

- `validate_kdb.py`: for Current eng-docs in the branch diff, error if `## Human` or `## Agent` is
  missing or out of order, or Human is empty. No length cap. Historical,
  `docs/hist/`, README, SOUL_HISTORY skipped.
- Extend the tell scan (`.githooks/pre-commit:67`, plus a CI copy since hooks are bypassable) to
  markdown and to `existing`, `formerly`, `was removed`, `was deleted`, `as of`, `#NNN`, `PR #`.
  Scan added lines only.
- Test both against a real marked file (Tech Lead learning: run it, do not read the regex).

## PR 9: carve and backfill

Docs that reach athlete repos: `docs/ref-docs/*` (carved by `PROPAGATED_DOCS`,
`carve-skeleton.mjs:574`, to `propagated/docs/`) and `platform/skills/pipeline-tools.md`. The
agent-kit `doc-style` block reaches kit consumers by tag, not through the athlete repos.

1. Confirm which ref-docs actually changed in PRs 1 to 8. None changed means PR 9 is skipped.
2. Run the carve to populate `coach-skeleton`. Check the diff is only the changed docs.
3. Backfill the live athlete repos, all local under `~/Projects/`. Candidates: `coach-skanda`,
   `coach-akash`, `coach-prateek`, `coach-shreyas`, plus `coach-phelps-template`. I will confirm
   the list with you before touching any of them. Only `propagated/docs/` is written. Coach's
   own files (`user_data/coach/*`, ledger, sessions) are never touched.
4. Find how athlete repos take updates today (I have not confirmed a backfill script exists, so I
   read `platform/README.md` and the carve script's post-run path first) and use that, not a
   hand copy.
5. Verify: `git diff --stat` per repo shows only `propagated/docs/`, then pushes go through
   `git pull --rebase origin main && git push origin main` in each repo, only after you say so.

## Risks

- **Hard error blocks unrelated PRs** that touch an old doc. Mitigated by PR 4 and PR 8 migrating all of
  them before PR 10 lands.
- **Carve:** doc-style is carved to other repos. Editing the block changes `blocks/doc-style.md`,
  needs the VERSION bump, and the sanitizer forbids provider names in that text.
- **Moving files to `docs/hist/`** breaks citations. Known ones: `challenge-v2-schema` (kept in
  place, it is cited by `engine/lib/challenge_schema.py`; I will check each candidate before
  moving), ADR 0006/0045, env-vars, `carve-skeleton.mjs:15`. Each gets repointed in the same PR.
  `SOUL_HISTORY.md` stays put, `validate_kdb.py` and `carve-kit.mjs` cite it.
- **Code scrub is large** (~400 lines, Bob's area). Comment-only edits, no behavior. CI must stay
  green on the pushed SHA.
- **Human sections written from code, not memory.** Each is checked against the source before I
  accept the PR.

## Verification

1. `bash platform/scripts/check.sh --quiet` after committing, before each first push.
2. `python3 kdb/scripts/validate_kdb.py`: zero errors, warning count lower than today.
3. Path check: every backticked path in the Agent sections exists (the audit's loop, reused).
4. Grep for the tell words over docs, kdb, role docs, AGENTS.md, code comments: zero hits outside
   the named exceptions.
5. Negative test for PR 10: a scratch branch that touches an old doc without the sections fails CI,
   and a comment with `(#123)` fails the hook and CI.
6. Every PR: `gh pr checks <n>` green on the pushed SHA before I report done.
7. Doc feedback: after PR 5, ask you to rate the overview 1 to 5 for ease of reading.
