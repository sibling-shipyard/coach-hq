# Doc style

**Default: one page max (~20 lines of prose + 1–2 diagrams).** Brief beats thorough.
Need drill-down? Add a separate `*-lld.md` — never bloat the main doc.

## What goes in the main doc
1. **Context** — why now, one sentence.
2. **Decision / goal** — what we're doing, one diagram if topology helps.
3. **Done when** — how we validate (concrete, testable).
4. **Deferred** — P2/P3 follow-ups, one line each.

ADRs use the same budget: Context / Decision / Why / Rejected — a few lines each.

## Executable plans

A plan a worker is briefed from also carries a phase table: `| id | files | deps | owner |`.

**File overlap decides parallelism, not task logic.** Two phases with disjoint `files` sets can
run at once; two that overlap cannot, however unrelated the tasks sound. `owner` is the worker
live in that area, so "reuse before spawn" has somewhere to look. Scope bleed gets checkable
too: a worker's diff must be a subset of its phase's `files`.

## Rules
- Plain English. No restating the diagram in prose.
- Write for a new implementer: show the user flow and storage destination before internal contracts or acronyms.
- Cite real file paths so it's greppable.
- Locked vs deferred — never reopen silently.
- Mermaid: quote labels `id["Label"]`, no semicolons in diagrams, one idea per chart.

## Avoid
- Section templates with 10 headings for a small change.
- Long test plans, risk essays, appendices — those live in the LLD or the PR.
