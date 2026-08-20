# Backlog — things to re-check while rebuilding coach-chat

Not a plan, not a design doc — just a running list of specific things found broken/deferred
while stripping coach-chat down (`coach-chat-reliability-debug`, merged as PR #350), so they
don't get silently forgotten while modularizing and building back up on `coach-chat-modularization`.
Delete each line once it's actually re-checked/fixed, not just remembered.

## 4. P2: consolidate coach-chat's 3 routes behind a catch-all, matching auth/

`coach-chat.ts`, `coach-chat-context.ts`, `coach-chat-profile-status.ts` are 3 separate
Vercel-routed files (3 functions) at flat, hyphenated URLs (`/api/coach-chat`,
`/api/coach-chat-context`, `/api/coach-chat-profile-status`). Could become
`coach-chat/[...action].ts` (1 function), the same pattern `auth/[...action].ts` already uses
(ADR 0017) — Vercel counts a catch-all as one function regardless of how many sub-paths it
dispatches internally.

Not urgent: we're at 7/12 functions, no cap pressure. And unlike auth's consolidation (which
didn't change any URL, since `/api/auth/*` already matched all 7 files), these 3 URLs don't
share a path prefix today — moving to a catch-all would change them (e.g. to
`/api/coach-chat/context`), requiring updates in the web frontend (`coachChatModel.ts`,
`prefetchCoachContext.ts`) and iOS (`CoachChatAPIClient.swift`'s 3 hardcoded paths, plus doc
comments in `CoachChatModels.swift`/`CoachSetupState.swift`/`CoachChatLocalCache.swift`). Do as
its own small PR if/when worth it for consistency, not bundled with anything else.

## 5. P2: decompose `handle()` in `ui/api/coach-chat.ts`

254 lines doing everything in one function: parse the request body, resolve close-intent (regex
+ pending-attempt lookback), call Gemini, build the `chat_history.json` write, conditionally
build the `coach_notes.md` write, inject the `coach_since` stamp, commit atomically, then shape
the response. Original module-split plan proposed breaking it into one function per lifecycle
stage (parse request → resolve close intent → call Gemini → build writes → commit → respond).

Deferred on purpose: Part B (state.md edits, then JSON writes one file at a time) keeps growing
this same function, so the right time to decide the split boundaries is once Part B's shape is
known — not now, which would mean redoing the split later anyway.
