# Doc style

**Default: one page max (~20 lines of prose + 1–2 diagrams).** Brief beats thorough.
Need drill-down? Add a separate `*-lld.md` — never bloat the main doc.

## What goes in the main doc
1. **Context** — why now, one sentence.
2. **Decision / goal** — what we're doing, one diagram if topology helps.
3. **Done when** — how we validate (concrete, testable).
4. **Deferred** — P2/P3 follow-ups, one line each.

ADRs use the same budget: Context / Decision / Why / Rejected — a few lines each.

## Rules
- Plain English. No restating the diagram in prose.
- Cite real file paths so it's greppable.
- Locked vs deferred — never reopen silently.
- Mermaid: quote labels `id["Label"]`, no semicolons in diagrams, one idea per chart.

## Avoid
- Section templates with 10 headings for a small change.
- Long test plans, risk essays, appendices — those live in the LLD or the PR.
