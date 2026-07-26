# Issue Template

Use this format when creating GitHub issues for workers. The issue should be a **self-contained prompt** — the worker should have full context from the issue alone, with no follow-up needed.

---

**Repo:** Always `<your-github-username>/<your-repo-name>` — replace with your own repo once you've set it up.
PRs go on this repo. Reference issues with `fixes <your-github-username>/<your-repo-name>#X` in the PR body.

**Title:** `[ui-expert]`, `[bob]`, or `[ios]` prefix + concise description

**Labels:** `ui-expert`, `bob-the-builder`, or `ios-builder`

**Body:**

```markdown
## Context
[Why this change is needed. Link to the bigger picture. Reference any design docs.]

## Current Behavior
[What happens now. Include code snippets, line numbers, or screenshots if relevant.]

## Desired Behavior
[What should happen after the fix/feature.]

## Scope

**Files to touch:**
- `path/to/file.tsx` — [what to change]

**Files NOT to touch:**
- `path/to/file` — [why]

**Reference docs:**
- `docs/some-spec.md`
- Link to related PR or issue

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] No TS errors in changed files (`npx tsc --noEmit`)
- [ ] Tested in browser / locally

## Guardrails
- Commit prefix: see `.github/CONVENTIONS.md`
- Branch: `feat/<issue-N>-<brief>` or `fix/<issue-N>-<brief>`
- PR must reference this issue: `fixes #X`
```
