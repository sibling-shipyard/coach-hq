# Coach Chat — Ground-Up Redesign (Web + iOS)

**Status key:** ✅ done · 🚧 in progress · ⬜ not started

## Context

Coach chat today has three real problems, surfaced through research + recent bugfix history (`6201bfa`):
1. Every turn re-fetches SOUL.md/state.md/quest_log.md from GitHub with no caching, so even the first reply pays full latency.
2. The athlete has to type first — there's no "coach opens the conversation" behavior — and file-write is all-or-nothing full-file regeneration, which is expensive and risks silent data loss if Gemini forgets to include a file.
3. First-time athletes have a real (if partially-built) First Session Protocol already specified in `platform/soul/B_engine.md` §10 and a matching `## Athlete Profile` template in `state.md`, but the iOS-side wiring to actually land them in it — and to correctly detect when it's done — is broken: `shouldOpenChatFirst()` (the only function meant to route a not-yet-intake'd athlete into chat) is dead code, so an athlete who finishes native onboarding without ever opening Chat gets stuck on Home forever with a blank profile and no nudge back.

This plan covers a full redesign split into two independently shippable parts (separate branches, planned together since they share files):
- **Part A** — day-to-day chat behavior (retention, unlimited daily chats, preloading, coach-speaks-first, cross-device staleness detection, close-session follow-ups, write strategy).
- **Part B** — First Session Protocol wiring fix (native onboarding → chat handoff, resumability, profile-completion detection).

Both parts share the underlying commit/write mechanism and the "coach speaks first" mechanic, which is why Part B depends on Part A's greeting-turn design landing first.

Branch: `coach-chat-redesign-part-a` (Part A, current). Part B will be its own branch off `main` once Part A merges.

---

## Part A — Day-to-day coach chat redesign

### A1. ✅ Retention: exactly 7 most recent, hard delete, no archive
- Drop the `archived` status entirely. `ChatThread.status` becomes `active | deleted` only (was `active | archived | deleted`).
- Delete = immediate, permanent removal from `chat_history.json`. No restore, no delete-forever second step, no undo toast.
- `MAX_RETAINED_THREADS = 7` stays, but semantics change: cap applies to `active` threads only (deleted threads are gone immediately, not counted). Creating a new thread when already at 7 active evicts the oldest active thread. Deleting a thread when below 7 does **not** trigger any backfill/eviction on the next new thread.
- Files touched: `ui/api/coach-chat.ts` (`applyRetention()`, `ChatThread` interface, PATCH handler simplified to immediate hard-delete), `ui/client/src/pages/CoachChat.tsx` / `CoachChatWidgets.tsx` (Archive/Restore/Delete-Forever UI removed, sidebar is Delete-only), `ios/CoachHQ/CoachHQ/Models/CoachChatModels.swift` + `CoachChatView.swift` / `CoachChatPreviewData.swift` (status enum + struct fields updated). ADR 0012 amended (not superseded) with a dated addendum.

### A2. ✅ Unlimited chats per day
- Confirmed: no per-day chat limit exists anywhere in `coach-chat.ts` or the iOS client. No code change — noted here so nobody "fixes" this later thinking it's a gap.

### A3. ✅ Preload context files on app/site load
- New read-only endpoint `GET /api/coach-chat-context` returning `{soul, state, questLog}` — the same three files `coach-chat.ts` reads per turn, exposed for warming.
- Shared read/caching logic extracted into `ui/api/_lib/coachChatFiles.ts` (`loadCoachContext`, 60s in-memory TTL cache keyed by repo) — both `coach-chat.ts` and `coach-chat-context.ts` use it, so a warm-up followed shortly by a real turn skips a redundant GitHub round-trip.
- **Web**: `ui/client/src/lib/prefetchCoachContext.ts`, fired once from `App.tsx`'s `Gate` component as soon as auth resolves — fire-and-forget, no client-side state held (the point is warming the server cache, not caching content client-side).
- **iOS**: `CoachChatAPIClient.prefetchContext()`, called from `MainTabView.swift`'s existing `.task` block (runs once when the app becomes active with a valid session).
- Scope is warming the raw files only — the actual Gemini greeting call still fires when the athlete lands on the coach-chat page/tab (A4), not before.

### A4. ✅ Coach speaks first
- New `POST {action: "greet"}` request shape on `/api/coach-chat`, handled by `handleGreet()`: reuses today's still-unanswered greeting thread if one exists (`status active, dayOffset 0, messages.length === 1, role coach`), otherwise calls Gemini in a new `"greeting"` mode (`askGemini`'s `TurnMode` param, replacing the old `closing: boolean`) and commits a new thread with just Coach's opening line via `commitFilesAtomic`.
- **Web**: `coachChatModel.ts`'s `greet()`, wired into `CoachChat.tsx` via `ensureTodayThread()` (called on mount) and `startNewConversation()` (called explicitly) — landing on the page or starting a new conversation always calls `greet()` instead of showing an empty composer. Retired `EmptyChatPane`'s canned-greeting/starter-prompt UI as the default landing view (component still exists in `CoachChatWidgets.tsx`, just unused — flagged as cleanup debt below).
- **iOS**: `ChatGreetResponse` model, `CoachChatAPIClient.greet()`, `CoachChatView.swift`'s `loadThreads()` calls `greetNow()` when there's no today-thread yet, and the "New conversation" action in the history sheet calls it explicitly too. Removed the old hardcoded local greeting string ("Hey, I'm Coach Phelps") from `materializeThreadIfNeeded` — that's now Gemini's job, not a client-side fallback string.
- **Not yet done**: iOS changes haven't been built/run in Xcode (no toolchain in this environment) — needs a real build check before merge.

### A5. ⬜ Cross-device conflict — no hard lock, commit-based staleness detection
- No proactive lock. Assume single-device use as the norm; handle the edge case (both web and iOS open at once) via detecting a new commit landed, not via blocking — same philosophy as iOS's existing sync staleness handling.
- Mechanism: every response from `coach-chat.ts` (greeting, turn, close) includes the current HEAD/blob SHA that was read for that turn. Before sending the *next* message in an open thread, the client includes the SHA it last saw; the server compares it to the actual current SHA at request time.
- If mismatched: surface this to the athlete ("Looks like you wrapped up a session on your other device — let me catch up") and re-read fresh context before proceeding with this turn.
- No new infra — reuses GitHub API's existing `sha` fields.
- Files: `ui/api/coach-chat.ts` (turn handler — SHA echo + comparison), `ui/api/_lib/githubGitData.ts` (reuse existing ref-sha plumbing), `coachChatModel.ts` / iOS equivalent (carry last-seen SHA per thread).

### A6. ⬜ Close-session keywords + side-quest follow-up dedup
- Expand `CLOSE_SESSION_PATTERN` with more natural phrasing ("bye coach" etc.).
- Side-quest dedup: no structural field exists for "what was discussed today." Implement by having the close-turn prompt include a summary of today's other closed threads (filtered from `chat_history.json` by date in the athlete's timezone) as extra context, with an explicit "don't ask again if already covered today" instruction. Prompt-level logic in `platform/soul/B_engine.md`'s close-session instructions plus `coach-chat.ts` assembling the extra context block.

### A7. ⬜ Write strategy — old_string/new_string for markdown, JSON merge-patch for JSON
- `file_updates` schema changes from `{path, content}` (full file) to a discriminated shape:
  - Markdown files (`state.md`, `coach_notes.md`): `{path, edits: [{old_string, new_string}, ...]}` — exact-match replace, rejected (not fatal) per-file if `old_string` doesn't match.
  - JSON files (`challenge_v2.json`, `current_week.json`, `sleep_log.json`): `{path, merge_patch: {...}}` — RFC 7396 JSON Merge Patch, validated as parseable JSON before committing.
  - Session files under `SESSIONS_PREFIX`: likely stay full-file `content` — confirm during implementation.
- Gemini's `responseSchema` and the close-turn prompt both need rewriting.
- Files: `ui/api/coach-chat.ts`, new `ui/api/_lib/fileEdits.ts` helper (old_string/new_string apply + JSON merge-patch apply).

---

## Part B — First Session Protocol wiring fix

### B1. ⬜ Native onboarding stops writing the dead `user_data/profile.md`
- Remove the commit in `OnboardingRevealFlow.swift` / `HealthKitSyncManager.swift`'s `extraFiles` plumbing for this write — confirmed zero consumers anywhere in the repo.
- Sport(s) + goal answers cached locally only (UserDefaults, no TTL) as onboarding hints for the first chat turn. If absent (reinstall, web-only), First Session Protocol just asks fresh.

### B2. ⬜ Backend computes and exposes `profileComplete`
- After any close-turn commits `state.md`, parse the `## Athlete Profile` section and check each required field is non-blank. Include `profileComplete: boolean` in the close-turn response.
- New lightweight `GET /api/coach-chat/profile-status` for iOS to poll on launch without a chat turn.

### B3. ⬜ Fix routing: live server check drives Chat-vs-Home, every launch, until complete
- Replace the dead `shouldOpenChatFirst()` heuristic with a live `profile-status` check on every launch while the Keychain flag is false; flip the flag and go Home once `profileComplete: true`.
- Files: `CoachSetupState.swift`, `MainTabView.swift` (actually wire the call site — currently missing entirely).

### B4. ⬜ SOUL.md First Session Protocol edits
- `platform/soul/B_engine.md` §10: accept native onboarding hints (sport/goal) as pre-filled context, reflect back for confirmation instead of re-asking cold. Recompose `platform/SOUL.md` via `compose-soul.mjs` after editing the layer.

### B5. ⬜ Resumability
- Falls out of B2 + B3 + A4 combined: an unclosed thread + `profileComplete: false` routes back into the same thread on every relaunch. No separate mechanism needed.

---

## Part C — Update docs/eng-docs/coach-chat-flow.md
⬜ Not started. Done last, after both Part A and Part B have merged — documentation-only, not a blocker for either implementation branch. Follows `kdb/doc-style.md`.

---

## Known cleanup debt (non-blocking)
- `EmptyChatPane`, `CHAT_STARTERS`/`ChatStarter`, and their supporting icon components in `CoachChatWidgets.tsx` / `coachChatModel.ts` are now dead code (unused since A4 retired the canned-greeting landing view). Left in place to limit blast radius while the rest of Part A lands; safe to delete in a follow-up pass once A5-A7 are done and the diff is reviewed.
- iOS's `chatWelcomeShown`/`preferredName` AppStorage flags and the `"welcome-coach"` message-id filter in `CoachChatView.swift` are now vestigial (their real job moved server-side in A4) but harmless — left alone rather than risk unverified Swift surgery without a local Xcode toolchain to compile-check against.

## Open implementation-time details (not blocking, flag during build)
- Exact JSON merge-patch implementation (hand-rolled vs a small dependency) — decide during A7.
- Whether session files (`SESSIONS_PREFIX`) keep full-file `content` writes or also move to a patch format — likely full-file, confirm when touching A7.
- Server-side context cache TTL for A3 is 60s — tune based on observed latency.

## Verification
- **Part A**: manual test via web dev server (`npm run dev` in `ui/`) — open coach-chat cold, confirm coach greets first with no typing; send 8+ separate day chats, confirm oldest of the 7 gets evicted only on the 8th *new* thread, not on delete; delete a thread, confirm no eviction on next new thread until back at 7; simulate a close from a second tab, confirm the first tab surfaces the staleness message on its next send (A5). iOS: build in Xcode, run through the same flows on simulator.
- **Part B**: iOS simulator run through full onboarding → confirm lands in Chat, Coach greets referencing native sport/goal hints; kill app mid-intake, relaunch, confirm same thread resumes; finish protocol, confirm `state.md` Athlete Profile populated + `challenge_v2.json` written in one commit, confirm next relaunch goes to Home.
- Both parts: confirm `ADR 0012` amendments are complete and accurate (Tech Lead review requirement per AGENTS.md — architectural decision changes need an ADR).
