# Coach chat — testing

> Status: Current · Owner: Tech Lead · Verified: 2026-08-26

## Context

Two separate tools test coach-chat, and neither existed with a durable home doc before this one -
`docs/plans/coach-chat-redesign-testing.md` is a one-off verification checklist (deleted once its
steps are done), not a reference for how testing works day to day.

## The two tools

**`npm run eval:coach-chat`** (`ui/scripts/eval-coach-chat.ts`) - runs golden transcripts
(`ui/api/coach-chat/_tests/coach-chat-eval/transcripts/`) against a live Gemini call. No real repo
writes happen; it calls `askGemini()` directly, not the full commit pipeline. A transcript is
either one message (`mode`/`userMessage`/`expect`) or a real multi-turn conversation
(`turns: [...]`) - a vague first mention, a clarifying detail two turns later, exactly how a real
athlete actually talks. Paid per call (ADR 0024), so it's manual/CI-gated, never on every PR.

**`npm run test:coach-chat-manual`** (`ui/scripts/run-manual-coach-chat-test.ts`) - drives a real
conversation through the real `handle()` in `coach-chat.ts` against a real athlete repo
(`coach-skanda`/`coach-akash`), using `gh auth token`. Real Gemini calls, real GitHub commits.
`--branch` is optional - omit it and the script names and creates its own scratch branch off the
repo's real default branch; it refuses outright to run against the real default branch or `main`.
Use `--greet` / `--message "..."` for one turn, or `--turns <file.json>` for a scripted
conversation - see `ui/scripts/examples/` for three ready-to-run ones.

## Derived vs. observed - the one thing to never blur

Both tools log to `tests/<YYYY-MM-DD>/<eval|manual>/`, committed to git (not gitignored) - a
permanent, dated record of every run: what was sent, the raw reply, PASS/FAIL/ERROR, and which
files changed. That last field carries a `confidence` tag:
- `"derived"` (eval only) - a guess, based on which action field fired. No real write happened.
- `"observed"` (manual only) - a real `git diff` across the turn's before/after commit sha. Ground
  truth, not a guess.

Never treat a `derived` entry as evidence of a real bug - only `observed` entries are.

## Done when

A run's console output ends with `N/M passed`; open the newest file under `tests/<today>/` to see
the real input/output/diff behind that number.
