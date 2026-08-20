# Part 8 / PR 1 — coach log window, 3 → 5

Stacked on PR #435 (`core/revert-soul-to-akash-baseline`) — branch off that, or off `main` if #435
has merged by the time you start. First PR in a longer stack; see
`coach-redesign-part9-pr2-generators-and-insights.md` for what comes next, but nothing here
depends on it — this PR is self-contained.

## Context

`coach_log.json` (`user_data/coach/coach_log.json`) is an unbounded, append-only array of session
notes — one row per closed session, never rotated. It's already windowed at render time:
`coachContext.ts`'s `recentSessionNotesSection()` does `rows.slice(-RECENT_SESSION_WINDOW).reverse()`
with `RECENT_SESSION_WINDOW = 3` today — only the last 3 rows, formatted as short bullets, ever
reach the Gemini prompt. Athlete confirmed 5 is the right number instead of 3.

Separately: the whole file gets fetched and parsed from GitHub on every turn regardless of window
size (GitHub's Contents API can't do a byte-range read), so the file keeps growing forever and
every turn pays an ever-larger fetch cost even though only 5 rows are ever used. That's a real
finding but **explicitly deferred, not built in this PR** — file it as a GitHub issue instead (see
below).

## Scope — exactly this, nothing else

1. In `ui/api/coach-chat/_lib/coachContext.ts`, change `RECENT_SESSION_WINDOW` from `3` to `5`.
   That's the entire code change in this PR.
2. File a GitHub issue: "coach_log.json grows unbounded — cap/rotate storage" — describe the
   finding above (whole file fetched every turn, only last 5 rows ever used, no rotation/archive
   exists). Tag **P2**. Add it to `ROADMAP.md`'s Backlog section (the M3, 10+ users list, near the
   other P2 backlog items like `#68`/`#21`/`#239`/`#265`/`#247`).

Do not build the rotation/archive logic itself in this PR — it's explicitly out of scope, filed
for later.

## Verification

- `cd ui && npx tsc --noEmit`, `npm test -- --run` clean.
- Find the existing test(s) covering `recentSessionNotesSection`/`RECENT_SESSION_WINDOW` (grep
  `ui/api/coach-chat/_tests/` for either name) and update the expected window size — extend the
  existing test, don't duplicate it.
- Live scratch-branch check: create a scratch branch off a real athlete repo with 6+ rows already
  in `coach_log.json` (or add them), confirm a fresh chat turn's context shows the last 5, not 3.
  Follow the verification discipline in `coach-redesign-part4b-fsp-reliability.md` — check the
  actual rendered context / real API response, not just that the code compiles.
- Confirm the filed issue number is referenced in `ROADMAP.md`'s new backlog line.

## PR

Small PR against `main` (or stacked, per current branch topology). Title something like
`core: widen coach_log recent-session window to 5`. Body: one paragraph on the finding, the
window change, and a link to the filed rotation issue. Leave open for Akash's review before merge,
same as every PR in this stack.
