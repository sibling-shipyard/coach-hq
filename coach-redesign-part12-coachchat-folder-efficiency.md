# Part 12 — decompose handle() + coach-chat/_lib/ folder cleanup

Stacked on #446 (once part 11b's `coachPrompt.ts` split lands). Branch off
`core/mode-specific-coach-prompt`'s updated tip.

## Context

`BACKLOG.md` #5 ("decompose `handle()` in `ui/api/coach-chat.ts`") was deliberately deferred until
"Part B's shape" was known — that's now true, the whole redesign stack (#435-446) is done.
`docs/plans/coach-chat-modularization.md`'s Part 1 (pure module split) shipped as PR #356; its Part
2 (decompose `handle()` itself) never happened. This PR does that Part 2, plus folder-wide cleanup
found along the way.

**`BACKLOG.md` #4 (three-route consolidation behind a catch-all) is explicitly NOT part of this
pass** — leave it in `BACKLOG.md` unchanged, still open, still P2.

## Part A — decompose `handle()`

`handle()` in `ui/api/coach-chat.ts` is currently **~635 lines** (171-806 on the current tip —
`BACKLOG.md`'s "254 lines" estimate is stale, from before Parts 8-11 grew it). Natural stage
boundaries, confirmed by reading the actual current file:

| Stage | Lines | Size |
|---|---|---|
| GET (list threads) | 175-180 | 6 |
| parse/dispatch | 183-207 | 25 |
| context load + close-intent + lazy fetches | 209-264 | 56 |
| Gemini call | 266-292 | 27 |
| write-building (all optional `FileEntry`) | 294-614 | ~320 |
| profileComplete transition + `coach_since` | 616-679 | 64 |
| `generateTemplatesAfterCompletion` closure | 681-704 | 24 |
| non-closing commit + response | 706-733 | 28 |
| closing commit + response | 735-803 | 69 |

**Target shape**: one function per row, EXCEPT fold "profileComplete transition" into
"write-building" — see obstacle 1 below for why. Effectively 8 functions, not 9.
`handleGreet()` (79-168) is already close to this granularity and needs no changes.

**Real obstacles, address each explicitly, don't paper over them:**

1. **The `coach_since`/`profileComplete` block mutates a `FileEntry` built two stages earlier** —
   line 673 mutates `profileUpdateWrite.resolve`, an object constructed at 457-465, in place. Fold
   this transition-detection directly into the write-building stage (recommended — they're
   conceptually one thing: "what does this turn write to the athlete's repo"). Don't keep it
   separate and thread `profileUpdateWrite` back in as mutable state — that defeats the point of
   splitting stages apart.
2. **`generateTemplatesAfterCompletion` is a closure over ~9 outer variables**, defined mid-function,
   invoked from two different later branches (~732, ~792/793). Make it a real function with
   explicit parameters once its defining scope moves.
3. **Two divergent commit/response paths** (closing vs. non-closing) share almost all upstream
   state but diverge on which `FileEntry[]` gets committed and what shape the JSON response takes.
   Thread one shared "turn context" object through explicitly — not 15+ positional arguments per
   extracted function, which is what a naive split would produce.
4. **Early returns as `Response.json(...)` mid-function** (lines 187, 206, 216, 291, 728, 783).
   Follow the pattern already established in this same file: `handleGreet()` (79-168) and the
   top-level `fetch()`'s `resolved instanceof Response` branching on `handleGreet`'s result. Each
   extracted stage returns `Response | T`; the caller checks `instanceof Response` and
   short-circuits.
5. **`traceId`, `now`, `timezone` minted once, threaded through nearly every stage** — pass as a
   shared context object, don't recompute per extracted function. Recomputing risks two stages
   silently using different values for what should be one turn's identity.

**Scope discipline:** this is a pure decomposition — `git diff -M -C` should read as moves plus
signature changes, not behavior changes. "Done" bar (matching `coach-chat-modularization.md`'s own
original criteria for this exact undone work): `handle()` itself under ~150 lines (just the
orchestrator calling each stage in order), same tests green, one new test per extracted stage where
it has meaningful internal logic worth testing in isolation (write-building and the two
commit/response stages — not the trivial GET/parse/dispatch stages).

**`BACKLOG.md` maintenance:** delete item #5 once this lands.

## Part B — folder-wide cleanup, while already touching these files

1. **`ui/api/coach-chat/README.md`'s `_lib/` table is stale** — documents 11 of the 18 actual
   files. Missing: `coachQuestFiles.ts`, `coachWeekFiles.ts`, `coachWorkoutFiles.ts`,
   `fspWrites.ts`, `onboardingWrites.ts`, `workoutSchema.ts` (all added by later PRs, never
   backfilled into the README). Add all 6 rows with a one-line Role description each, matching the
   table's existing format. Do this regardless of how much of Part A lands — low-risk, standalone.
2. **`coachWrites.ts`'s naming and header comment have drifted from its actual job.** It's now 37
   lines (`ClosingFileContext`, `loadClosingFileContext`, `injectCoachSinceIfNeeded`), but its
   header comment still calls it "the write-authority half of coach-chat" — `coachIntents.ts` is
   the real write-authority module now (every actual field applier lives there). Either rename to
   match its narrow real job (e.g. `coachSinceStamp.ts`) or fold its two functions into
   `coachIntents.ts` outright — 37 lines with a misleading header doesn't justify staying separate.
   Whichever you pick, fix the header comment either way; don't leave it describing a role the file
   no longer has.
3. **Naming inconsistency across write-related files** — `coachMemoryFiles.ts`/`coachQuestFiles.ts`/
   `coachWeekFiles.ts`/`coachWorkoutFiles.ts`/`coachChatFiles.ts` (`*Files.ts`, data-shape/path
   modules) vs. `fspWrites.ts`/`onboardingWrites.ts` (`*Writes.ts`, turn-scoped write assembly) vs.
   `coachWrites.ts` (breaks both patterns). Resolving item 2 fixes the worst offender. Don't rename
   `fspWrites.ts`/`onboardingWrites.ts` in this pass unless it's genuinely free while you're
   already touching that area — this is a nice-to-have flag, not the point of the PR.
4. **`workoutSchema.ts`** is the one file without a `coach` prefix, unlike every sibling — likely
   fine as-is (the prefix would be redundant given its only caller is `coachWorkoutFiles.ts`).
   One-line note in the PR description, not a required change.

## Verification

- `cd ui && npx tsc --noEmit`, `npm run test` clean throughout.
- For Part A: `git diff -M -C` should show moves for the pure-decomposition portions, confirming
  the split preserved behavior rather than rewriting it.
- Live scratch-branch smoke test of a real chat turn — greet, an ordinary ongoing-chat turn, and a
  closing turn, end to end via the hosted API — after Part A specifically. This is the highest-risk
  change in this PR: decomposing `handle()` wrong would be silent in unit tests if a stage's
  extracted boundary subtly changes what state a later stage sees, and would only surface on a real
  turn hitting the wrong code path. Check the actual committed files via the GitHub API afterward,
  same discipline as the rest of this stack.

## PR

Branch off #446's tip. Title something like `core: decompose coach-chat handle() and clean up the
_lib/ folder`. Body: the stage table, the 5 obstacles and how each was resolved, the folder cleanup
items, confirmation `BACKLOG.md` #5 is deleted and #4 is untouched. Leave open for review.
