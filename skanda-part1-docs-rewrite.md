# Part 1 — rewrite coach-chat docs for the redesign

## Branch

Stacks directly on `#448`'s tip (`core/split-coach-turn-writes`). Doesn't depend on parts 2-4 —
this file documents the live current schema/flow, and can land in any order relative to them, but
per the stack order it goes first.

## Why

`docs/eng-docs/coach-chat-flow.md` and `docs/eng-docs/gemini-flow.md` predate the
mode-specific-prompt/insights/write-splitting work (#443-448). There's no schema/enums/data-
structure reference doc at all for the current `profile.json`/`memory.json`/`injuries.json`/
`coach_log.json`/`seasons.json`/`quests.json`/`progress.json`/`progressions.json`/
`current_week.json` shapes — the closest things today are scattered type definitions in
`ui/api/coach-chat/_lib/coachQuestFiles.ts`, `coachMemoryFiles.ts`, etc., not a reader-facing doc.
Related epic: **#378** ("Coach data redesign — group files by how often they change").

## What to write

All new/rewritten files live under `docs/eng-docs/`, following the front-matter rule in
`docs/eng-docs/README.md`: `> Status: Current · Owner: Tech Lead · Verified: <date>`.

### 1. `coach-chat-daily.md` (new)

The ordinary-turn flow end to end. What `handle()`'s stages do today post-decomposition
(#447/#448 split it into `ui/api/coach-chat/_lib/coachTurn.ts` + `turnWrites/*.ts` + the stage
functions in `coach-chat.ts`): request in, context load (`loadCoachContext`/`renderCoachContext`),
which files get read, the Gemini call (mode-specific schema per #446), each reply field's write
path (one row per `turnWrites/*.ts` file — reuse that folder's own `README.md` table as the
source, don't re-derive it by hand), the commit.

Diagrams (mermaid):
- One sequence diagram: athlete → API route → context load → Gemini → write builders → GitHub
  commit → response.
- One file read/write map: which files are read every turn vs. only closing turns vs. only when
  an action field fires.

### 2. `coach-chat-fsp.md` (new)

First Session Protocol specifically — #431/#432/#434 (all merged) changed this substantially:
incremental writes as facts are given (not batched at close, per #432), the reliability fix, the
end-conversation-without-guessing behavior (#434). Cover what's different about an FSP turn vs.
an ordinary turn (different prompt context, different completion-detection logic in
`coachTurn.ts`/`turnWrites/profileWrite.ts`'s `projectProfileCompletion`), with its own mermaid
diagram showing the incremental-write loop across multiple turns until profile completion,
referencing ADR 0018's `coach_since` stamping at the completion transition.

### 3. `gemini-flow.md` (rewrite in place — it already exists, update, don't duplicate)

Reflect: mode-specific schemas (#446 — `coachReplySchema.ts`; confirm this file actually exists
post-#447/#448's split before citing it, verify with `Read`/`grep`, don't assume from memory),
the prompt trim (#445), explicit context caching (`ui/api/coach-chat/_lib/soulCache.ts` — already
has a good header comment, use it as the source, don't re-derive the caching design from
scratch).

### 4. `coach-data-schema.md` (new — the big one)

Every file the coach owns or reads, current shape, every enum. Source directly from the
TypeScript in `ui/api/coach-chat/_lib/` (`coachQuestFiles.ts`, `coachMemoryFiles.ts`,
`coachChatFiles.ts`, `coachWeekFiles.ts`, `coachWorkoutFiles.ts`, `workoutSchema.ts`, and whatever
module holds `profile.json`/`injuries.json`'s types — locate it, don't guess the filename). These
interfaces **are** the schema, so this doc should read as a faithful prose+table rendering of
them, not a reinvention.

Structure:
- One section per file (`profile.json`, `memory.json`, `injuries.json`, `coach_log.json`,
  `seasons.json`, `quests.json`, `progress.json`, `progressions.json`, `current_week.json`,
  workout templates/sessions): path, purpose, full field table, every enum's allowed values
  (e.g. `QuestType`, `WorkoutType`, `ExerciseType`, `ProgressRow.status`, `ProgressRow.source`),
  who writes it and when.
- **"What Gemini gets as input"**: exact context assembly — what `renderCoachContext`/
  `loadCoachContext` include, tiered by turn type if applicable, byte/size budget if one exists
  (cite the actual trimming logic in `coachPrompt.ts`/`coachPromptText.ts` — verify these
  filenames against current source first, they may have shifted post-#447/#448).
- **"What Gemini can write" (`GeminiReply` action fields)**: every field on the reply schema,
  which mode(s) expose it, which `turnWrites/*.ts` file consumes it, which file(s) it lands in.
  This is the doc-form of the `turnWrites/README.md` table plus the schema variance #446
  introduced — cross-reference both, don't duplicate content that already lives in
  `turnWrites/README.md` (link to it instead of restating its table).
- Mermaid ER-style diagram (or a simple box diagram, per `kdb/doc-style.md`) showing file
  relationships (e.g. `quests.json` ↔ `progress.json` via `quest_id`, `seasons.json` ↔
  `progress.json` via `season_id`).

### 5. Optional — "redesign in one page" (agent's judgment, flag if skipped)

A short entry-point doc, one page per `kdb/doc-style.md`, linking to all 4 docs above plus
`turnWrites/README.md`, for a developer who's never touched this area. Not required if the 4 docs
above are individually well cross-linked instead.

## Doc style

Every new/rewritten doc follows `kdb/doc-style.md` (short, diagram-led, plain English) and the
front-matter rule above. Diagrams are mermaid.

## Verification

Every file path, type name, and field name cited must be checked against the actual current
source (`grep`/`Read` the real file) before writing it into the doc — this doc set's whole point
is accuracy after a redesign that outran its docs, so writing plausible-sounding but unverified
field names defeats the purpose. Doc-only change, no `tsc`/test run needed, but run
`node kdb/scripts/validate_kdb.py` since it checks front matter and path references.
