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

Branch: `feat/<N>-<brief>` · mid-stack PR: `Refs: #N` · finishing PR: `Fixes: #N`
```

Tech Lead writes issues this way. Workers implement **Done when** only. Do not build deferred items.
