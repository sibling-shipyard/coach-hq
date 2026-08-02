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

### A5. ✅ Cross-device conflict — no hard lock, commit-based staleness detection
- No proactive lock. `getHeadSha()` added to `ui/api/_lib/coachChatFiles.ts` (cheap, always-fresh, uncached — a single `GET /git/ref/heads/main`).
- Every ordinary-turn/close response includes `repoSha` (current HEAD sha, or the post-commit sha on close). The client (`coachChatModel.ts`'s `lastKnownSha` map, `CoachChatAPIClient.swift`'s equivalent static dict) remembers it per thread and sends it back as `knownSha` on the next message in that thread.
- If `knownSha` doesn't match the actual current HEAD at request time, `coach-chat.ts` sets `stale: true` on the response and forces `loadCoachContext(..., { fresh: true })` to bypass the 60s cache, so Gemini's context reflects whatever changed. Web surfaces this with a toast ("Coach caught up on changes from your other device"); iOS tracks/sends the SHA correctly but doesn't yet surface a toast for it (see cleanup debt below — skipped touching iOS's `Toast` state machine without a compiler to verify against).
- Files: `ui/api/coach-chat.ts`, `ui/api/_lib/coachChatFiles.ts` (`getHeadSha`), `ui/client/src/components/coach-chat/coachChatModel.ts`, `ui/client/src/pages/CoachChat.tsx`, `ios/CoachHQ/CoachHQ/Models/CoachChatModels.swift`, `ios/CoachHQ/CoachHQ/Services/CoachChatAPIClient.swift`.

### A6. ✅ Close-session keywords + side-quest follow-up dedup
- `CLOSE_SESSION_PATTERN` expanded with "bye coach," "see you tomorrow," "catch you later," and a fixed "that's it/all for today/now" alternation.
- Side-quest dedup: `todaysOtherThreadsSummary()` in `coach-chat.ts` filters `chat_history.json`'s threads to today (via the existing `computeDayOffset`/timezone logic), excludes the thread currently being closed, and builds a short "already covered today" context block only fetched/injected when the turn is actually a close-intent turn (no extra read on ordinary turns). Passed to `askGemini` as `extraContext`, appended into the system instruction alongside the existing closing-mode block. Implemented entirely in `coach-chat.ts` rather than `platform/soul/B_engine.md` - the closing-turn prompt block already independently paraphrases SOUL.md §12 for this no-shell-access context rather than deferring to the composed SOUL.md text, so this follows the same existing pattern.

### A7. ✅ Write strategy — old_string/new_string for markdown, JSON merge-patch for JSON
- New `ui/api/_lib/fileEdits.ts`: `applyStringEdits()` (sequential exact-and-unique-match replace, mirrors this session's own Edit tool discipline — an `old_string` that's absent or ambiguous is skipped, not fatal to the rest of the turn) and `applyJsonMergePatch()` (RFC 7396, recursive object merge, `null` deletes a key, arrays replace wholesale).
- `file_updates` schema is now `{path, edits?, merge_patch?, content?}` — exactly one populated per entry, chosen by file type: `edits: [{old_string, new_string}]` for `state.md`/`coach_notes.md`, `merge_patch` (a JSON-encoded **string**, not a nested object — Gemini's structured-output schema doesn't reliably support open-ended objects) for `challenge_v2.json`/`current_week.json`/`sleep_log.json`, `content` (full file, unchanged) for session files.
- **Real architectural gap this surfaced and fixed**: Gemini was never given the current content of `coach_notes.md`/`challenge_v2.json`/`current_week.json`/`sleep_log.json` at all before A7 — it was blindly regenerating "full new content" for files it had never seen. That only sort-of worked under full-file-regen; edits/merge-patches need real current content to target. New `loadClosingFileContext()` fetches all four (best-effort, `null` if not yet written) **only on closing turns** and injects them into the prompt. Ordinary (non-closing) turns still only see `state.md`/`quest_log.md`, so the prompt now explicitly tells Gemini it may only propose edits to `state.md` on an ordinary turn (the one file whose current content it does have every turn) and to defer everything else to the close-out.
- `resolveFileUpdate()` in `coach-chat.ts` applies the right strategy per file against whatever current content that turn actually had, dropping (not failing the whole commit for) anything unwritable, unresolvable, or blank. `COACH_WRITABLE_FILES` is now derived from `MARKDOWN_EDIT_FILES ∪ JSON_MERGE_FILES` instead of a separate literal list, so the two can't drift.
- `maxOutputTokens` reduced 32768 → 16384 (edits/patches are far smaller than whole-file bodies; kept generous since a close can still touch several files).
- Files: `ui/api/coach-chat.ts`, `ui/api/_lib/fileEdits.ts`.

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
- iOS doesn't yet surface a toast for A5's `stale` flag (web does). `CoachChatView.swift` has no `Toast` state wired up today (other views like `ActivityListView.swift` do); adding one here means new `@State`/`.toast()` modifier plumbing that's safer to do with an Xcode build available to verify, rather than blind in this environment.

## Open implementation-time details (not blocking, flag during build)
- Exact JSON merge-patch implementation (hand-rolled vs a small dependency) — decide during A7.
- Whether session files (`SESSIONS_PREFIX`) keep full-file `content` writes or also move to a patch format — likely full-file, confirm when touching A7.
- Server-side context cache TTL for A3 is 60s — tune based on observed latency.

## Verification
- **Part A**: manual test via web dev server (`npm run dev` in `ui/`) — open coach-chat cold, confirm coach greets first with no typing; send 8+ separate day chats, confirm oldest of the 7 gets evicted only on the 8th *new* thread, not on delete; delete a thread, confirm no eviction on next new thread until back at 7; simulate a close from a second tab, confirm the first tab surfaces the staleness message on its next send (A5). iOS: build in Xcode, run through the same flows on simulator.
- **Part B**: iOS simulator run through full onboarding → confirm lands in Chat, Coach greets referencing native sport/goal hints; kill app mid-intake, relaunch, confirm same thread resumes; finish protocol, confirm `state.md` Athlete Profile populated + `challenge_v2.json` written in one commit, confirm next relaunch goes to Home.
- Both parts: confirm `ADR 0012` amendments are complete and accurate (Tech Lead review requirement per AGENTS.md — architectural decision changes need an ADR).
