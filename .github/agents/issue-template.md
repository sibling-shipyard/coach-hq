# Issue Template

Self-contained prompt for a worker. **Keep it one screen (~20 lines).** Worker should not need a follow-up thread.

**Title:** `[ui-expert]` / `[bob]` / `[ios]` + concise description

**Body:**

```markdown
## Goal
One sentence — what and why.

## Done when
1. [testable criterion]
2. [testable criterion]

## Scope
**Touch:** `path/file` — [one line each]
**Don't touch:** [paths + why, if non-obvious]

## P2/P3 (do NOT build)
- [deferred nice-to-haves, one line each]

Branch: `feat/<N>-<brief>` · PR: `fixes #N`
```

Tech Lead writes issues this way. Workers implement **Done when** only; **P2/P3** goes to backlog, not the PR.
