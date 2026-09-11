# Coach-chat redesign — real end-to-end testing

> Status: Current · Owner: Tech Lead · Verified: 2026-09-02

## What this doc used to be

Through late August this doc tracked a real-athlete-repo verification checklist (Frontend,
Daily flow, FSP) against the coach-chat stack as it stood then - closing-turn detection,
`challenge_v2` rendering, the old First Session steps. The chat-commit redesign (see
[`coach-chat-design-history.md`](../eng-docs/coach-chat-design-history.md)'s 2026-09-02 entry)
replaced most of that system outright: no more closing turn, no more `challenge_v2`, a different
schema entirely. That checklist verified a system that no longer exists, so it's gone rather than
kept as a false record - git history has it if anyone needs the old log entries.

## Where the current testing story actually lives

- **What runs on every commit, no network:** [`coach-chat-testing.md`](../eng-docs/coach-chat-testing.md)
  - the layered suite (`layer1-gemini`/`layer2-fields`/`layer3-commit`/`integration`), what each
  layer actually mocks, and why.
- **Live-API tools:** same doc, "The two live-API tools" section - `npm run eval:coach-chat`
  (golden transcripts against a real Gemini call) and `npm run test:coach-chat-manual` (a real
  conversation through the real endpoint against a real athlete repo).
- **The redesign's own final live-verification pass** - one consolidated run against the fully
  integrated stack, right before it merges to `main` - is K1's job. While that plan doc still
  exists it has the authoritative checklist and results; once K1 lands, its durable outcome folds
  into `coach-chat-testing.md` and this doc's own remaining reason to exist goes with it.

## Why this file still exists at all

The athlete's call, not the standard delete-on-ship rule. This redesign followed that rule for its
own `ccr-*.md` LLDs. This one was kept a little longer instead, as a pointer for anyone who lands
here from an old link, rather than deleted the same day the checklist it tracked stopped applying.
