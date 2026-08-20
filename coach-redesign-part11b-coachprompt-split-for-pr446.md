# Part 11b — split coachPrompt.ts, add as more commits on PR #446

Not a new PR — these commits land on `core/mode-specific-coach-prompt` (existing #446), on top of
whatever's already there. Branch: `core/mode-specific-coach-prompt` directly.

## Context

`coachPrompt.ts` is down to 675 lines after #445/#446's trims (from 827). The remaining efficiency
work here is organizational, not token-count: the file mixes two genuinely separable concerns.

Per explicit decision: the `reasoning`-field defense-in-depth strip (`BACKLOG.md` items #2/#3) is
**not being built**. The field's been absent from the Gemini response schema since #445/#446 and
nothing has broken — confirmed real gap, deliberately declined, not a bug to fix.

## Scope

1. **Delete `BACKLOG.md` item #1** — confirmed resolved. `coachWrites.ts:12-16`'s own comment
   documents the fix (`coach_since` used to target the deleted `challenge_v2.json`, now targets
   `profile.json`); `coach-chat.ts:616-679` now projects this turn's writes onto the pre-turn
   profile/memory/seasons before checking the completion transition, so the false→true transition
   can actually fire. Nothing left to do.
2. **Delete `BACKLOG.md` items #2/#3** — per the decision above. Not fixed, consciously declined,
   remove the entries so the doc doesn't imply pending work.
3. **Split `coachPrompt.ts` along its real internal seam**:
   - `coachReplySchema.ts` — the `GeminiReply` interface, `GENERATION_CONFIG`/`responseSchema`,
     and the mode-specific schema variants #446 built (`responsePropertiesFor`, `RESPONSE_PROPERTIES`,
     `FSP_ACTIONS`, `RETURNING_CLOSE_ACTIONS`, etc.) — everything that defines *what shape* a
     Gemini response can take.
   - `coachPromptText.ts` — everything that builds the actual prompt strings sent to Gemini:
     `staticSystemText`, `buildDynamicText`, `combineExtraContext`, `activeTemplatesContext`,
     `firstSessionContext`, `onboardingHintsContext`, `injuryFlagsContext`, `activeQuestsContext`,
     `activeWeekSessionsContext`, `buildHistoryContents`, `FEW_SHOT_EXAMPLES`, `MAX_HISTORY_MESSAGES`.
   - Update every import site: `coach-chat.ts`, `geminiClient.ts`, and any test file importing
     directly from `coachPrompt.ts` (grep `from ".*coachPrompt"` / `from ".*coachPrompt.js"` across
     `ui/api/coach-chat/` to find them all).
   - `coachPrompt.ts` itself either goes away entirely (if nothing's left after the split) or
     becomes a thin re-export for anything that genuinely needs both halves together — check
     whether that's actually needed before keeping it around as a pass-through.

## What NOT to do

- Don't touch the mode-specific schema logic's actual behavior — this is a file-boundary move, not
  a redesign. `git diff -M -C` should read as moves, confirming nothing changed semantically.
- Don't build the `reasoning` strip (see above — explicitly declined).
- Don't fold in unrelated cleanup from other plan files (`part12`/`part13`/`part14`) — this PR
  addition is scoped to `coachPrompt.ts`'s split only.

## Verification

- `cd ui && npx tsc --noEmit` clean.
- `npm run test` — same test count as before the split (a pure reorganization shouldn't add or
  remove coverage; if the count changes, that's a signal something moved wrong, not a feature).
- Confirm no import cycle between `coachReplySchema.ts` and `coachPromptText.ts` (if one needs the
  other, the dependency should point one direction only — schema types are a reasonable thing for
  prompt-text to import, the reverse would be a smell).
- `git diff -M -C` on the two new files should show high move-detection against the original
  `coachPrompt.ts`, not read as freshly authored content.

## PR

These land as new commits on #446, not a new PR. Update #446's description to mention the split
once pushed — same pattern as every other addition to a PR already under review in this stack.
