# /insights — Agent coaching review

Meta-task only. Do **not** write code, edit files, or run non-readonly tools unless the user asks after the report.

## Context to review

1. **Past conversations:** Use @Past Chats if attached, else search recent agent transcripts (last 5–15 sessions in this repo).
2. **Current session:** Include this chat if it shows recurring patterns.
3. **Existing rules:** Skim `AGENTS.md` and `.cursor/rules/` so suggestions don't duplicate what's already there.

## Patterns to surface

Friction, repeated instructions, scope creep, overengineering, rabbit holes, verbose replies — concrete repeats only, not one-off mistakes.

## Output (~20 lines max)

Numbered list with tab-indented `a.` / `b.` sub-items:

```
## Insights — [date or range]

1. **[Pattern]** (P0|P1|P2|P3)
	a. Evidence: [short phrase]
	b. Fix: [one habit for the agent]

## Rule candidates (1–3)

1. **[AGENTS.md §… or .cursor/rules/foo.mdc]**
	a. Proposed text: [paste-ready, 1–3 sentences]
	b. Why: [pattern prevented]

## Priority summary

- P0/P1: …
- P2/P3: …
```

Propose 1–3 paste-ready rule additions tied to observed patterns — not generic advice. Do not implement unless asked.
