# coach-chat modularization

> Status: Current · Owner: UI Expert · Verified: 2026-08-15

**Context.** `ui/api/coach-chat.ts` is 1271 lines holding four unrelated concerns. The cost is
review quality, not runtime: a PR tuning prompt wording and a PR changing commit authority look
identical in the file list, so a reviewer can't tell blast radius from the diff. Two open PRs
(#286, #287) rewrite large parts of this file right now, so ordering is the first question.

## The queue

A pure move is the most conflict-hostile change there is — it touches every line without
changing behaviour, so git has nothing to rebase against a rewrite of the same hunks. It goes
last. The collision between #286 and #287 exists already and is not caused by this work.

```
   #286 core/coach-intent-schema-p1        #287 coach-commit-mvp
   coach-chat.ts  +179/-77                 coach-chat.ts  +377/-54
   adds _lib/coachIntents.ts (343)         CI: UNSTABLE
   CI: CLEAN                                        │
        │                                           │
        └──────────► conflict, 7 files ◄────────────┘
                     coach-chat.ts
                     coach-chat-file-updates.test.ts
                     eval transcripts 03, 04, 05, 07
                     eval-coach-chat.ts
                             │
                             ▼
              land #286, rebase #287 onto it, land #287
                             │
                             ▼
                   THEN  PR 1 move  ──►  PR 2 decompose
```

#286 already extracts `ui/api/coach-chat/_lib/coachIntents.ts` — same direction as this plan, so it shrinks
the remaining split rather than fighting it. Re-measure the file after both land; if it drops
under ~600 lines, drop `chatThreads` from the carve and revisit.

## Target modules — carved by reason-to-change

```
                     ui/api/coach-chat.ts   (handler only, ~150 lines)
                                  │
     ┌────────────┬───────────────┼───────────────┬──────────────┐
     ▼            ▼               ▼               ▼              ▼
 coachDay.ts  chatThreads.ts  coachPrompt.ts  geminiClient.ts  coachWrites.ts
    pure          pure            pure             I/O            pure
 tz, offsets   merge, LRU     schema,          call, cache     which files
 day number    retention      few-shots,       retry, parse    Coach may
 dividers      title clean    prompt text                      write + how
     │             │               │               │              │
 changes when  changes when    changes         changes when   changes when
 date rules do  ADR 0012 does  weekly          infra does     authority does
                               (coaching)                     (security)
```

All under `ui/api/coach-chat/_lib/`. No barrel files — the import path is the signal, hiding it defeats
the point. Comments in this file are load-bearing (`GEMINI_MODEL` deprecation history, the A8
schema field ordering, the A5 staleness check); they move with their code or the move failed.

## Done when

1. **PR 1** — `git diff -M -C` reports moves, not rewrites. The 5 tests in `ui/api/coach-chat/_tests/`
   change exactly one import line each; any change to a test *body* means it stopped being a
   move. `npm test` green.
2. **PR 2** — `handle()` is under ~150 lines, one function per lifecycle stage, same tests green
   plus one new test per extracted stage.
3. **Both** — a live chat turn: ordinary reply writes nothing, a close commits once. Code review
   does not catch Gemini-facing regressions.
4. No ADR. No locked decision changes; ADR 0012 retention behaviour is relocated, not altered.

## Deferred

- **P2** — sport-analytics lens models duplicate `weekStartKey`, `shiftWeekKey`, `localDateKey`,
  `calculateWeeklyStreaks`, `buildHeaderStats` three times across badminton/running/calisthenics.
  Worth a shared `lensCore.ts` only if a fourth lens is coming.
- **P3** — `ios/CoachHQ/CoachHQ/Views/WarmInstrumentHomeView.swift` is 1797 lines, the largest in
  the repo, with no tests to protect a split. iOS Builder's call, not now.
- **Not touching** — `generate-widget-snapshots-from-dashboard-snapshot.bundle.js` (generated),
  `ui/client/src/components/ui/` (vendored shadcn).
