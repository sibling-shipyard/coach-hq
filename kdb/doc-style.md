# Doc style

**Default: one page max (~20 lines of prose + 1–2 diagrams).** Brief beats thorough.
Need drill-down? Add a separate `*-lld.md` — never bloat the main doc.

## What goes in the main doc
1. **Context** — why now, one sentence.
2. **Decision / goal** — what we're doing, one diagram if topology helps.
3. **Done when** — how we validate (concrete, testable).
4. **Deferred** — P2/P3 follow-ups, one line each.

ADRs use the same budget: Context / Decision / Why / Rejected / Enforces — a few lines
each, plus an optional How to apply. Rules and the prose checks live in
`kdb/decisions/README.md`; write new ones from `kdb/decisions/0000-template.md`.

## Executable plans

Milestones remain the outcome layer. Each milestone contains **1–3 PRs, one by default**; more than
three means the milestone is too large and should split. Every milestone has one exit test even when
several PRs contribute to it.

The execution layer is a PR stack table:
`| PR | milestone | outcome | final base | files | owner | parallel with | done when |`.
`final base` shows review and merge order. `parallel with` shows work that can be built concurrently
after its shared contract is fixed; rebase those branches into the declared linear stack before review.

**File overlap decides parallelism, not task logic.** Two PRs with disjoint `files` can run at once;
overlapping PRs cannot, however unrelated they sound. A PR's diff must remain a subset of its listed
files. Follow `.github/CONVENTIONS.md` for stack mechanics, issue links, and bottom-up merge order.

## Rules
- Plain English. No restating the diagram in prose.
- Write for the named reviewer first. Put paths, hashes, endpoint fields, and test matrices in a clearly
  marked build handoff, not the opening story (PR #586 feedback, rated 2/5).
- Cite real file paths so it's greppable.
- A handover carries only what is **not** in the repo. Whatever the next agent reads on boot —
  `AGENTS.md`, its role doc, the running plan — must not be restated (handover rated 1/5).
- Locked vs deferred — never reopen silently.
- Mermaid: quote labels `id["Label"]`, no semicolons in diagrams, one idea per chart.

## Avoid
- Section templates with 10 headings for a small change.
- Long test plans, risk essays, appendices — those live in the LLD or the PR.
