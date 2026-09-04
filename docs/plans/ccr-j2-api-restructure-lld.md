# J2 — Restructure `ui/api/` for clarity, especially coach-chat's layers — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for J2 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs after every
other feature PR (A-I) and after J1 — restructuring file *locations* while other PRs are still
landing would create merge conflicts on every one of them. Still runs **before** H1: H1 stays this
redesign's true finish line (closes #735, deletes this plan's own docs), and needs J2's own changes
folded into its final consistency pass, not the other way around.

## Why `ui/api/` lives inside `ui/` at all — answered, not this PR's job to change

Real question asked while scoping this: `ui/api/` is shared backend for both web and iOS, so why
does it live under the frontend-sounding `ui/` folder? Answer, already on record, not something to
revisit here. `kdb/decisions/0011-hq-four-band-layout.md` already considered moving it there:
the right logical home, but deferred, since Vercel's root directory is `ui/`, to the deploy
rewire. `docs/eng-docs/hq-restructure-plan.md` goes further, locking a move as a stated non-goal
for the current restructure phase. Vercel's file-based routing needs `api/` as a direct child of
whatever directory Vercel treats as project root, and that root is configured as `ui/`. Moving it
means a real deploy reconfiguration, already identified, deliberately deferred, not an oversight.
This PR does not touch that; it's about what's *inside* `ui/api/`, not where `ui/api/` itself
lives.

## Scope — audit the whole `ui/api/` tree, design coach-chat's layers explicitly

`ui/api/` today has auth (`ui/api/auth/`), coach-chat (`ui/api/coach-chat/`), and several
standalone routes (`coach-message.ts`, `coach-chat-profile-status.ts`, `repo-file.ts`,
`waitlist.ts`, `widget-snapshots.ts`) plus shared `_lib/` helpers at the `ui/api/` root. Audit each
area for whether its current layout actually helps a new developer find what they're looking for.
This LLD specifies coach-chat's redesign in detail since that's explicitly named; the rest gets the
same audit question without a locked answer here (don't over-design what isn't asked for).

**Coach-chat's `_lib/` is currently flat** — 22 files (as of this redesign's start, before its own
churn) sitting directly in `ui/api/coach-chat/_lib/`, one subdirectory already carved out
(`turnWrites/`). This mirrors the codebase's own three-layer testing philosophy in name only.
The `docs/eng-docs/coach-chat-testing.md` layers are input → decision, decision → file content,
file content → git commit. The *tests* are organized by layer (`_tests/layer1-gemini/`,
`layer2-fields/`, `layer3-commit/`), but the *source* they test isn't. Mirror that structure in
`_lib/` itself, so a developer can tell which layer a file belongs to by its path, not just by
reading it:

- `_lib/gemini/` — the Gemini call itself: `geminiClient.ts`, `coachReplySchema.ts`,
  `coachPromptText.ts`, `soulCache.ts`.
- `_lib/decide/` (name TBD, match whatever this redesign's own work settles on) — decision → file
  content. Includes `coachIntents.ts`, `coachChatFiles.ts`, `coachMemoryFiles.ts`,
  `coachQuestFiles.ts`, `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `coachContext.ts`,
  `coachDay.ts`, `fspWrites.ts`, `turnWrites/` (already a subdirectory, folds in here).
- `_lib/commit/` — file content → git commit: whatever of `chatThreads.ts`, `coachSinceStamp.ts`,
  `activitySync.ts`/`activitySyncTurn.ts` is actually commit-stage logic rather than decision-stage
  (check each, don't assume by name).
- `coachTurn.ts` itself likely stays at `_lib/` root — it's the orchestrator that calls all three
  layers in sequence, not a member of any one of them.

**Do this for real, once the redesign's own churn has settled** — C1 deletes `closeSignal.ts`, D1
adds new files (dynamic-enum helpers, the corrective-retry logic), C2 adds the day-keyed coach_log
logic, D2 may add new validation helpers. Finalize the exact file list and folder boundaries against
what actually exists after I1, not against this snapshot — this LLD gives the shape and the
reasoning, not a frozen file list.

**Two findings from G2's audit, open for J2 (or J1) to resolve.**
- `fspWrites.ts`, listed above under `_lib/decide/`, is dead. `commitTurn` (C1/D1's unified commit
  path) builds its writes from `turn.validUpdates`/`turn.optionalWrites` directly, and no production
  code calls `fspIncrementalWrites`/`ordinaryTurnResponse` any more. Check whether J1 already deleted
  it before assuming it needs a move.
- Layer3-commit's real test file is `ui/api/_lib/_tests/githubGitData.test.ts` today, not under
  `coach-chat/_tests/`, since `commitFilesAtomic` is shared, not coach-chat-specific. Decide whether
  it moves under `coach-chat/_tests/layer3-commit/` to match the `_lib/commit/` split above, or
  layer3 stays outside `coach-chat/` on both the source and test side.

## Execution

One PR, pure file moves + import-path updates — no logic changes. `git mv` each file (preserves
history) rather than delete-and-recreate. Update every import path across `_lib/`, `_tests/`, and
any route file (`coach-chat.ts`, `coach-message/_lib/`) that references a moved file.

## Tests

No new tests — this PR moves files, doesn't change behavior. `npm test` green with zero test
content changes (only import paths inside test files, if any moved test helper's path changed)
confirms nothing broke in the move.

## Done when

Coach-chat's `_lib/` mirrors its own test suite's three-layer structure. `tsc --noEmit` and
`npm test` both clean. A new developer can tell which of the three real turn stages a file belongs
to from its path alone, without opening it.
