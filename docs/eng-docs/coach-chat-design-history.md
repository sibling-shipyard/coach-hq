# Coach Chat — design history

## Context

Coach chat has gone through a foundational redesign plus two follow-on passes, all in real
production use across two live athlete repos. This is the dated record of what changed, why, and
which PR shipped it — **for how the system works today, see
[`coach-chat-flow.md`](coach-chat-flow.md)** (request lifecycle) and
[`gemini-flow.md`](gemini-flow.md) (the Gemini integration specifically). Neither of those docs
carries history; this one does. Originally drafted as a pre-implementation plan
(`coach-chat-redesign-plan.md`, repo root) before Part A/B shipped — moved here and expanded into
a running log once the plan itself was fully implemented, so a single doc covers "what was
planned" and "what actually happened since," not two files that drift apart.

---

## 2026-07-29 — Atomic commits foundation (PR #128)

First version of the current commit model: `chat_history.json` + any file updates land in **one**
atomic commit via the Git Data API (blob → tree → commit → ref), instead of separate REST PUTs
per file. Retention capped at a fixed thread count. This is the foundation the two redesign
passes below build on. See ADR 0012.

---

## 2026-08-03 — Ground-up redesign, Part A + Part B (PRs #215, #216, #221)

The original plan covered three real problems: no caching (every turn re-fetched SOUL.md/
state.md/quest_log.md from GitHub from scratch), the athlete always had to type first with
all-or-nothing full-file regeneration on close, and the First Session Protocol's iOS wiring was
broken (`shouldOpenChatFirst()` was dead code, so a not-yet-intake'd athlete could get stuck on
Home forever).

**Part A — day-to-day chat (PR #215):**
- **A1** Retention simplified to `active | deleted` only (dropped the `archived` tier) — delete
  is immediate and permanent, no restore. `MAX_RETAINED_THREADS = 7`, flat cap on active threads.
- **A2** Confirmed no per-day chat limit existed anywhere — documented, not changed.
- **A3** Preload: new `GET /api/coach-chat-context` warms a 60s in-memory server cache
  (`ui/api/_lib/coachChatFiles.ts`) for state.md/quest_log.md, fired once per app load on both
  platforms, ahead of the eventual Gemini call.
- **A4** Coach speaks first: new `POST {action: "greet"}`. At this point in the design, greet
  *did* commit a thread server-side (same-day reuse check prevented repeated-open duplicates) —
  see 2026-08-06 below for why and how that changed.
- **A5** Cross-device staleness: `repoSha` echoed on every response, client sends it back as
  `knownSha`; a mismatch triggers a forced fresh context read and a "Coach caught up on changes
  from your other device" toast on both platforms.
- **A6** Close-keyword set expanded ("bye coach," "see you tomorrow," "catch you later," "that's
  it/all for today/now"), plus same-day side-quest dedup so a second same-day conversation
  doesn't re-ask what an earlier one already covered.
- **A7** Write strategy: `file_updates` moved from whole-file regeneration to targeted
  `edits`/`merge_patch`/`content` per file type (`ui/api/_lib/fileEdits.ts`) — the real gap this
  surfaced was that Gemini had never been shown the current content of `coach_notes.md`/
  `challenge_v2.json`/`current_week.json`/`sleep_log.json` at all before this; it was blindly
  regenerating files it had never seen.

**Part B — First Session Protocol wiring (PR #216):**
- **B1** Native onboarding stopped writing a dead `user_data/profile.md` (zero consumers,
  confirmed) — caches sport/goal locally in `OnboardingHints` (UserDefaults) instead.
- **B2** Backend computes `profileComplete` generically from `state.md`'s `## Athlete Profile`
  section (any non-blank `- **Label:**` line, not hardcoded field names) — new
  `GET /api/coach-chat-profile-status` endpoint (folded into a Vercel function-count fix, ADR
  0017, after briefly breaking the 12-function cap).
- **B3** `shouldOpenChatFirst()` rewritten to call the live profile-status check instead of
  inferring completion from thread existence (which was always wrong and got worse once A4
  shipped, since a thread existed the instant Chat opened).
- **B4** SOUL.md's First Session Protocol (`platform/soul/B_engine.md` §10) reflects onboarding
  hints back for confirmation instead of asking cold, when present.
- **B5** Resumability traced and confirmed correct with no new code needed at the time (later
  found to have a real gap once local caching was added properly — see 2026-08-06 below).

**PR #221 (audit fixes)** followed shortly after with review-driven fixes: `sending` state scoped
per-thread instead of one global flag (web), `lastKnownSha` pruning, and others.

---

## 2026-08-06 — Prompt architecture, explicit caching, eval harness (PRs #263, #268, #266, #271-275)

Triggered by hitting Gemini free-tier limits blocking real testing — used as the moment for a
broader prompt/caching pass rather than a quick unblock.

**Prompt architecture (PR #263):**
- Reordered `systemInstruction` so the volatile timestamp (`todayContextLine()`) moved from 3rd
  position to last, making the rest of the prompt a stable, cacheable prefix (previously
  invalidated implicit caching on every single call).
- Added 3 few-shot examples covering the highest-stakes failure modes (ordinary turn with nothing
  to save, closing turn with missing info, closing turn with a real well-formed edit).
- Added a `reasoning` field to the response schema, filled before `reply` — OpenAI's
  structured-outputs guidance reports a large accuracy gain on schema-shaped tasks from this
  ordering.
- Added `MAX_HISTORY_MESSAGES = 40` — previously only thread *count* was capped, not messages
  within one long-running thread.
- `platform/SOUL.md` bundled into the Vercel function at build time instead of fetched from each
  athlete's own repo every single turn (was a real per-athlete, per-turn GitHub round-trip for a
  100% generic file).

**Eval harness (PR #268):** 7 golden transcripts + a structural rubric checker
(`ui/scripts/eval-coach-chat.ts`) — catches reasoning leaks, fabricated-save language, wrong
write-allowlist paths.

**Skeleton trim (PR #266):** terminal/BYO-Claude-Code coaching mode retired from the
`coach-skeleton` carve template (confirmed nobody uses it — coach-chat web/iOS is the only real
athlete-facing surface). ADR 0021.

**Explicit Gemini caching (PR #271, refined in #272/#273):**
- SOUL's static prefix uploaded once via Gemini's explicit-caching API instead of relying on
  implicit (best-effort) caching — guaranteed 90% discount vs. best-effort.
- Found and fixed two real production bugs during rollout, both via the same "verify against
  real traffic, not just code review" process: the REST path was stale (Vercel renamed
  `/v1/edge-config/...` to `/v1/global-config/...`), and the initial API token was project-scoped
  when Global Config writes need account-level scope.
- Verified live: `cachedContentTokenCount: 13576` reused identically across two real messages in
  one session while `promptTokenCount` grew with history — confirmed the same cache entry is
  genuinely being hit turn-to-turn, not just configured.

**Diagnostic logging (PR #274, #275):** standing `[coach-chat] Gemini usage: prompt=... cached=...`
log line on every reply; four previously-silent `catch` blocks in `coach-chat.ts` (askGemini
failures in both greet and message-send paths, both `commitFilesAtomic` call sites) now log the
real error instead of returning a bare status code with zero trace.

---

## 2026-08-06 — Close-save reliability, greet stops committing, client polish (PRs #276-279)

Real usage on both live athlete repos (not synthetic testing) surfaced two serious problems,
confirmed via actual commit history: closes were landing without saving real content far more
often than expected, and empty greetings were permanently eating retention slots.

**Backend (PR #276):**
- **Close-save observability**: added logging for a close that lands with zero `file_updates`,
  and for the model's own `reasoning` on every closing turn (previously deleted immediately,
  never visible anywhere). Strengthened the closing-turn prompt with an explicit, mechanical
  self-check ("list every concrete fact this conversation contains that state.md doesn't already
  have") instead of relying on prose alone.
- **`handleGreet()` stopped committing anything.** Confirmed via git history on both live repos:
  the overwhelming majority of recent commits were empty `coach: chat — new conversation`
  greetings with zero athlete engagement — the same-day reuse check from A4 (2026-08-03) only
  prevented *repeated* same-day duplicates, not a new empty thread every day the athlete opened
  the tab without replying. Removing the commit (rather than tightening the reuse check further)
  also fixed threads staying permanently titled "New conversation" — that bug was
  `existing?.title ?? computedTitle` discarding the real close-time title because greet had
  already committed the placeholder one.

**Web (PR #277):**
- Client materializes the greeting as a local-only thread (server no longer does it).
- Added `react-markdown` — coach replies previously showed literal `**`/`-` characters.
- Sidebar copy ("Newest 7 kept — oldest drop off automatically" → "LAST 7 THREADS", matching iOS)
  and the relative age badge (`D-1`/`D-2` → a real date) and divider label (frozen
  "TODAY · 2:00 AM" on old threads → computed fresh) fixed.
- Added `localStorage`-based persistence for uncommitted conversations — web had no client-side
  cache at all before this; a refresh mid-conversation lost everything.

**iOS (PR #278):**
- Same greet-materialization fix as web.
- `CoachChatMarkdownBlock` added for list rendering (`AttributedString` only supported inline
  bold/italic).
- Same age-badge/divider fixes as web — required adding `createdAt` to `ChatThread`'s Codable
  model (server always sent it, client never decoded it).
- **Found and fixed the real cause of "an in-progress conversation vanishes after
  force-quit/relaunch"** (tracked informally since B5's 2026-08-03 resumability check, and
  formally in issue #244): `CoachChatLocalCache` was caching correctly the whole time, but
  `restoring()` only ever overlaid cached messages onto threads the *server* already knew about.
  A genuinely uncommitted conversation (which is now every conversation, until it closes) only
  ever exists under its local-only id — invisible to a restore pass that only matches against the
  server's list. Added a scan for orphaned local-only cache entries. Web's
  `findOrphanedLocalThreadIds` mirrors the same fix.

**Docs (PR #279):** this document created; `coach-chat-flow.md`/`gemini-flow.md` updated to
describe the resulting current state and stripped of historical "what changed" narrative (moved
here).

**Known, accepted tradeoffs from this pass** (not bugs, decided against fixing):
- No server-side dedup when two tabs/devices greet at almost the same instant on an empty day —
  costs at most one redundant Gemini call.
- Close-save reliability is now *visible* (logging) and *nudged* (stronger prompt), not
  code-guaranteed — no way to force 100% prompt compliance from a model.

---

## 2026-08-06 — Orphan-restore day-offset bug + stale-greeting cleanup (PRs #280-#282)

Filed a consolidated manual test checklist (issue #280, superseding #222 and #267) to work
through everything shipped in the two passes above against real, live behavior rather than code
review alone. Two independent code reviews of #276-278 (iOS Builder and UI Expert, working
separately) each found the same real bug before manual testing even started.

**The bug (PR #281):** the local cache introduced by #277/#278 only ever persisted a thread's
`messages`, never a `createdAt` — so when restoring an orphaned (never-committed) thread, there
was nothing to recover a real creation date from, and both platforms hardcoded `dayOffset: 0`.
Concretely: greet on Day 1, don't reply, close the app; reopen on Day 3 — the stale Day-1
greeting gets restored looking like "today's" thread, `ensureTodayThread`/`todayThread` picks it
up before a fresh greet ever fires, and the athlete sees the same frozen Day-1 opener instead of
a new one. Directly contradicted #276-278's own stated goal of a fresh greeting on every open.

**Fix:** both platforms already embed an epoch-ms timestamp in message ids (`d-<ms>`/`c-<ms>`) —
recover `createdAt` from the divider's own id on restore instead of hardcoding "today," and
compute a real `dayOffset` from that (`epochMsFromMessageId`/`computeLocalDayOffset` on web,
`epochMs`/`dayOffset` on iOS). Same reviews also caught a second, related bug: repeated "New
conversation" taps each left their own orphaned cache entry with no cleanup, and which one won
as "today's thread" on next restore was nondeterministic (dictionary/localStorage key iteration
order) — fixed by clearing any previous unreplied local greeting before materializing a new one.

**Follow-up (PR #282):** #281 correctly stopped a past-day unreplied greeting from masquerading
as today, but left it *displayed*, correctly dated, forever — a permanent single-message "ghost"
thread cluttering the sidebar/history. Since nothing worth keeping exists in an unreplied
greeting once its day has passed, this drops it entirely at restore time instead: clear the
cache entry, don't materialize a thread for it. A same-day unreplied greeting is untouched — only
past-day orphans get dropped.

---

## 2026-08-06 — Closing-turn reliability: Gemini timeout/retry, unbounded commits, title corruption

Real-world report (both athlete accounts, iOS and web): "bye"/"wrap" either did nothing at all
(iOS showed the generic "GitHub is having issues" 500-class error, the typed message stuck unsent)
or committed but skipped the mandated sleep/side-quest questions, plus one thread title came back
with literal Chinese characters mixed into English text. Diagnosed against real production Vercel
Runtime Logs rather than guessing — the logs showed the actual failures were `askGemini` itself
throwing (`Request to generativelanguage.googleapis.com timed out`, and a couple of genuine Gemini
503 "high demand" responses), not anything GitHub/commit-related; the "GitHub is having issues"
message is a shared generic string in `UserFacingError.swift`'s 500-599 case, unrelated to the
actual failing service.

**Root cause:** the Gemini `generateContent` call shared the same flat 25s timeout
(`UPSTREAM_TIMEOUT_MS`) as plain GitHub file reads, with no retry on either a timeout or a 503.
Closing turns send the largest prompts in the system (54k-64k tokens seen in the log sample, vs
~18-19k for ordinary turns — 5 extra files plus full chat history) and ask for the hardest
generation (structured close-out JSON), making them the turn most likely to legitimately exceed
25s. When it did, `askGemini` threw before `commitFilesAtomic` was ever reached — nothing
committed, and the athlete just saw a generic failure. Confirmed this is not a billing/quota
issue: paid tier raises the requests/tokens-per-minute ceiling, not per-request latency or 503
immunity.

**Fix:**
- The `generateContent` call now uses its own 45s timeout (`GEMINI_GENERATE_TIMEOUT_MS`),
  separate from the 25s file-read default. `ui/vercel.json` now sets an explicit
  `maxDuration: 60` for `api/coach-chat.ts` so the platform ceiling isn't silently the real limit
  underneath the raised in-code timeout.
- A 504 (our own timeout) or 503 (Gemini overload) now triggers one retry with a short fixed
  backoff — additive to the existing stale-cache-400 retry, not a replacement.
- `commitFilesAtomic`'s GitHub calls (`ghGet`/`ghPost`/the ref-move `fetch`) had no timeout
  wrapper at all — a stalled write could hang indefinitely. Now wrapped in `fetchWithTimeout`. The
  existing "did the ref-move actually land before we retry" safety recheck (avoids a double-commit
  after a lost response) now also fires on a `fetchWithTimeout` 504, not just a raw `status ==
  null` network error, since a timeout is the same "we don't know what happened" case.
- Added a diagnostic-only `checklist_covered` field to the closing response schema, logged
  alongside `reasoning` — the prompt already has an intentional "close anyway" escape hatch on a
  second close attempt with info still missing, so this lets a future report be told apart as
  "legitimate escape hatch" vs. "silently skipped on a first close" instead of guessing.
- Title corruption: primarily addressed at the source — the closing prompt now explicitly asks
  for plain English only, and the few-shot examples model a plain-English `title` value alongside
  the rest of the expected shape. `sanitizeTitle()` (strips non-ASCII) is a fallback safety net,
  not the primary fix. Separately (unrelated to this specific report, but a latent risk found
  while in this code): both server (`coach-chat.ts`) and web (`coachChatModel.ts`) title
  truncation switched from `.slice()` (UTF-16 code units, can split a surrogate pair) to a
  codepoint-safe `truncateTitle()` (`Array.from`-based). iOS's existing `String.prefix` was
  already grapheme-safe — no change needed there.

---

## Superseded verification issues

Manual test checklists have been filed and re-filed as the system changed underneath them
(#222 for the original redesign, #267 for the caching/close-reliability pass, #280 for the
close-save-reliability/greet-materialization pass) — see the current consolidated checklist
issue for what's actually still unverified as of the latest pass.
