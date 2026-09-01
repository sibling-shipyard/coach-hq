# C1 — Remove the closing-turn concept — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for C1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on B3 —
by this point `quest_create`/`season_start` and the other data-fact fields are already unified
across ordinary/closing, so this PR is close to a pure deletion rather than a redesign.

## Why this is safe — full inventory

Nothing outside coach-chat depends on a thread's closed/open state. `ChatThreadStatus` is only
`"active" | "deleted"` — there's no "closed" status anywhere. `ui/api/coach-message.ts` (the
post-sync proactive handler) is entirely content/date-driven, no closing references at all. No
dashboard/widget code reads a closed/open distinction. A "closed" thread today still fully accepts
new messages afterward — closing has only ever meant "the last turn happened to trigger a commit,"
which every turn does now.

## Full removal list

**Backend:**
- `ui/api/coach-chat/_lib/closeSignal.ts` — delete entirely (`isCloseSignal`,
  `wasCloseAttemptPending`, `shouldRequestClose`, `acceptedMessage`, `messageForGemini`'s
  close-specific branch).
- `coachTurn.ts`: remove `closeIntent` computation and the `endConversationRequested` param; the
  eager pre-fetch of `closingFiles`/template manifest/`current_week.json` that was gated to
  `closeIntent` — load these **lazily** instead, only after Gemini's reply actually contains a
  `template_edit`/`session_plan` action, so ordinary turns that don't touch those fields don't pay
  for extra GitHub reads. Merge `commitOrdinaryTurn`/`commitClosingTurn` into one function that
  always writes the full set (data-fact fields already unified by A1/B3; session-artifact fields
  now unified too since "closing" no longer exists).
- `ui/api/coach-chat.ts:187`: remove the `turn.closing ? commitClosingTurn : commitOrdinaryTurn`
  dispatch — one path.
- `coachReplySchema.ts`: collapse `mode` from `ordinary|closing × firstSession` to just
  `firstSession` for prompt-instruction purposes. Remove `session_closed` from the reply schema —
  nothing depends on model confirmation of a close decision anymore. `RETURNING_CLOSE_ACTIONS` /
  `FSP_ACTIONS` split collapses into one always-available action-field list (data-fact fields +
  session-artifact fields together), still split by `firstSession` for `coach_note`'s handling —
  see the C2 LLD for what happens to `coach_note` specifically.
- `coachPromptText.ts`: remove `SESSION_STAYS_OPEN`/close-decision prompt blocks; the model no
  longer needs to be told the session stays open (there's no other option) or asked to confirm a
  close.

**Web** (`ui/client/src/pages/CoachChat.tsx`, `CoachChatWidgets.tsx`, `coachChatModel.ts`): remove
the "End Conversation" button, `endConversationEnabled`/`onEndConversation`, `pendingEndThreadIds`,
`endConversationRequested` from the request body.

**iOS** (`CoachChatView.swift`): remove `canEndConversation`, `pendingExplicitCloseThreadIds`,
`endConversationRequested` from `send(...)`.

## What does NOT change

`coach_since` stamping already doesn't depend on "closing" specifically — `injectCoachSinceIfNeeded`
fires on whichever turn completes the profile (`coachTurn.ts:508`'s lazy-load of `closingFiles` is
gated on the profile-completion transition, not on `closeIntent`), confirmed before this PR — no
change needed there.

## Tests

- Delete `closeSignal.test.ts`.
- `coachTurn.test.ts`/`fullTurnPipeline.test.ts`: remove closing-turn-specific test setup, rewrite
  any test asserting the old ordinary/closing split; add a test confirming `template_edit` now
  commits on an ordinary turn without a close.
- Web/iOS: remove End Conversation button tests; add a check that a long-running thread never
  becomes read-only or blocks new messages (already true today, confirm it stays true).

## Done when

`grep -rn "closeIntent\|closeSignal\|endConversationRequested" ui/api/coach-chat/ ui/client/src/
ios/CoachHQ/` returns nothing. A live scratch-repo conversation: a template edit and a session-plan
change both commit mid-conversation without any close action.
