# Backlog — things to re-check while rebuilding coach-chat

Not a plan, not a design doc — just a running list of specific things found broken/deferred
while stripping coach-chat down (`coach-chat-reliability-debug`, merged as PR #350), so they
don't get silently forgotten while modularizing and building back up on `coach-chat-modularization`.
Delete each line once it's actually re-checked/fixed, not just remembered.

## 1. `coach_since` (Day-N counter) stamping is currently dead

Found in review of PR #350, before merge. `wasProfileComplete` and `profileComplete`
(`ui/api/coach-chat.ts`, in `handle()`) are both computed from the same unedited `stateMd` now
that state.md is no longer edited by the stripped-down flow — so the false→true transition
`injectCoachSinceIfNeeded` looks for can never fire. A new athlete completing the First Session
Protocol under this design would never get `coach_since` stamped on `challenge_v2.json`, so the
Day-N badge stays broken for them.

**Not fixed on purpose** — whatever state.md/file-write wiring comes back during modularization
will very likely fix this incidentally (once something edits state.md again mid-close, the two
values stop being identical). Re-check once state.md writes are wired back in: does `coach_since`
actually stamp correctly on a real First Session Protocol completion?

## 2. `reasoning` field defense-in-depth strip was removed

The old code always did `delete parsed.reasoning` before returning a `GeminiReply`, specifically
so a schema drift or a stale cached prompt couldn't leak internal model reasoning text through to
the athlete. That strip doesn't exist any more now that `reasoning` isn't in the schema at all.
Low risk day to day, but if `reasoning` (or any other internal-only field) comes back as part of
the modularized design, make sure whatever replaces `finishGeminiResponse` re-adds an explicit
strip rather than relying on "it's not in the schema so it won't happen."

## 3. Eval harness's reasoning-leak check is currently vacuous

`ui/scripts/eval-coach-chat.ts`'s `if ("reasoning" in reply) failures.push(...)` no longer
verifies a real code guard (see #2) — it only passes because the schema doesn't ask for
`reasoning`, not because anything strips it if the model emits it anyway. Revisit alongside #2.

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
