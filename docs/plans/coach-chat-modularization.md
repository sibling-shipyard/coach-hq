# coach-chat modularization

> Status: Current · Owner: Tech Lead · Verified: 2026-08-15 · Issue: [#288](https://github.com/sibling-shipyard/coach-phelps-hq/issues/288)

**Context.** `ui/api/coach-chat.ts` holds four unrelated concerns. It measured 1271 lines on
2026-08-14 and 1614 on 2026-08-15 — #287 added 343 lines in a day, and #286 is queued to add
~100 more. The cost is review quality, not runtime: a PR tuning prompt wording and a PR changing
commit authority look identical in the file list, so a reviewer can't tell blast radius from the
diff. This doc is the plan for #288; it is not started.

## Ordering — do this after #286

A pure move is the most conflict-hostile change there is: it touches every line without changing
behaviour, so git has nothing to rebase against a rewrite of the same hunks. It goes last.

```
   #287 coach-commit-mvp          ✅ MERGED 2026-08-15 (70395e5)
                │
                ▼
   #286 core/coach-intent-schema-p1     ⚠️ OPEN, conflicts with main in 7 files
   coach-chat.ts +179/-77                  coach-chat.ts
   adds _lib/coachIntents.ts (343)         coach-chat-file-updates.test.ts
                │                          eval transcripts 03, 04, 05, 07
                │                          eval-coach-chat.ts
                ▼
        rebase #286 on main, land it
                │
                ▼
        PR 1 move  ──►  PR 2 decompose      ◄── this doc
```

#286 extracts `ui/api/_lib/coachIntents.ts` — the same direction as this plan, so it pre-carves
the write-resolution half rather than fighting it. **Re-measure `coach-chat.ts` after it lands**
and re-cut the map below against the real file; the shape holds, the exact line counts won't.

## Target modules — carved by reason-to-change

Issue #288 proposes three seams (Gemini-facing / write-resolution / HTTP handler). This is the
same cut at finer grain — #288's Gemini half splits into prompt vs client, and its
write-resolution half is largely `coachIntents.ts` once #286 lands.

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

All under `ui/api/_lib/`. No barrel files — the import path is the signal, hiding it defeats the
point. Comments in this file are load-bearing (`GEMINI_MODEL` deprecation history, the A8 schema
field ordering, the A5 staleness check); they move with their code or the move failed.

## Done when

1. **PR 1** — `git diff -M -C` reports moves, not rewrites. The tests in `ui/api/_tests/` change
   exactly one import line each; any change to a test *body* means it stopped being a move.
   `npm test` green.
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
- **Not touching** — `generate-widget-snapshots-from-aggregate.bundle.js` (generated),
  `ui/client/src/components/ui/` (vendored shadcn).
