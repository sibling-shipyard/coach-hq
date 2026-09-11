# Issue Template

Self-contained prompt for a worker. **Keep it one screen (~20 lines).** Worker should not need a follow-up thread.

**Title:** `Area: plain-English problem or outcome` (max 90 characters)

**Body:**

```markdown
[Two short sentences — what changes, then why it matters. No heading.]

## Done when
1. [testable criterion]
2. [testable criterion]

## Scope
**Touch:** `path/file` — [one line each]
**Don't touch:** [paths + why, if non-obvious]

## P2/P3 (do NOT build)
- [deferred nice-to-haves, one line each]

Branch: `feat/<N>-<brief>` · mid-stack PR: `Refs: #N` · finishing PR: `Fixes: #N`
```

Tech Lead writes issues this way. Workers implement **Done when** only; **P2/P3** goes to backlog, not the PR.
For M3/M4 work, assign GitHub's native parent chain up to one same-milestone `epic` before linking
an implementation PR. Only the root epic receives the `epic` label.

Run `kdb/scripts/check_issue_contract.py` before `gh issue create` — nothing else runs it until a
PR links the issue. It wants the bare milestone code (`M3`), not the full title `gh issue create`
needs (`M3: Scale to 10 users`). No epic yet in this milestone? File as `Later` or create the epic
first.
