# Coach Chat — design history

> Status: Historical · Owner: UI Expert · Verified: 2026-08-20

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

## 2026-08-20 — Turn-stage decomposition

The message path moved from one 635-line `handle()` into explicit stages in `coachTurn.ts`:
request parsing, context loading, Gemini, write assembly, ordinary commit, closing commit, and
best-effort template generation. `coach-chat.ts` now authenticates and dispatches those stages.
The narrow `coachWrites.ts` helper was renamed `coachSinceStamp.ts` to match its real role.

## 2026-07-29 — Atomic commits foundation (PR #128)

First version of the current commit model: `chat_history.json` + any file updates land in **one**
atomic commit via the Git Data API (blob → tree → commit → ref), instead of separate REST PUTs
per file. Retention capped at a fixed thread count. This is the foundation the two redesign
passes below build on. See ADR 0012.

---

## 2026-08-03 — Ground-up redesign, Part A + Part B (PRs #215, #216, #221)

The original plan covered three real problems: no caching (every turn re-fetched SOUL.md/
state.md/rendered quest context from GitHub from scratch), the athlete always had to type first with
all-or-nothing full-file regeneration on close, and the First Session Protocol's iOS wiring was
broken (`shouldOpenChatFirst()` was dead code, so a not-yet-intake'd athlete could get stuck on
Home forever).

**Part A — day-to-day chat (PR #215):**
- **A1** Retention simplified to `active | deleted` only (dropped the `archived` tier) — delete
  is immediate and permanent, no restore. `MAX_RETAINED_THREADS = 7`, flat cap on active threads.
- **A2** Confirmed no per-day chat limit existed anywhere — documented, not changed.
- **A3** Preload: new `GET /api/coach-chat-context` warms a 60s in-memory server cache
  (`ui/api/_lib/coachChatFiles.ts`) for state.md/rendered quest context, fired once per app load on both
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

**PR review follow-ups (same day, before merge):**
- The 504-timeout retry was dead code: `fetchWithTimeout` *throws* a 504-tagged Error on its own
  abort rather than resolving a Response, so the `res.status === 504` check could never actually
  see it — only the genuine HTTP 503 branch ever fired. Fixed by converting a thrown 504 into a
  resolved 504 `Response` inside `callGemini`, so the existing retry logic works for the exact
  failure mode this PR set out to fix (skanda-2003 code review).
- Worst-case latency could still stack past `maxDuration`: the 400 stale-cache retry and the
  504/503 retry were independent `if`s, so an unlucky request could chain 3 full
  `GEMINI_GENERATE_TIMEOUT_MS`-budget calls back to back (~135s) — Vercel kills the function
  before that finishes, so the reliability fix wouldn't help in that combined-failure path. Capped
  to one retry total (`if`/`else if`, mutually exclusive) and raised `maxDuration` to 120 to give
  the now-bounded ~90s worst case real headroom (same reviewer).
- Checked whether 120 (or even the bounded ~90s worst case) was actually safe on this account's
  plan: confirmed via the live Vercel dashboard that Fluid Compute is enabled, which per Vercel's
  own changelog raises Hobby's function-duration ceiling to the full 300s, not the 60s that
  applies without it. Raised `maxDuration` to 300 (the actual confirmed ceiling) rather than
  leaving it at a number picked before that was known — removes any need to keep re-deriving
  worst-case arithmetic across every stage (file reads, Gemini retries, commit retries) by simply
  using the real headroom available. This also meant the full "return fast, finish in background"
  redesign considered the same day was no longer an urgent fix (the timeout problem it targeted is
  already solved by the 300s ceiling) — captured instead in `docs/plans/coach-chat-follow-up.md`
  for optional future work, not implemented now.

---

## 2026-08-14/15 — Coach commit MVP: stop silent drops, `coach_note`, retry + honesty guard (PR #287)

Forensic audit of `coach-skanda-2003` found real closes weren't saving coach files at all: 5 close
commits over 30 days, 0 wrote a coach file — only `chat_history.json` landed each time.
`coach-akash-suresh` showed the same shape. Split into two design docs to keep scope tight:
`coach-commit-mvp.md` (Split 1/P0 — prove a minimal fix on one file) and `docs/plans/coach-intent-schema.md`
(Split 2/P1 — extend the same pattern to the rest of the coach files). Summarized here as the
dated historical record; see those docs directly for full detail (`coach-commit-mvp.md` stays a
live eng-doc since Split 1 shipped as designed, `coach-intent-schema.md` lives in `docs/plans/`
since Split 2 was never built).

**Split 1 / P0 (shipped as designed):**
- `resolveFileUpdate` returns `{ok, path, reason}` instead of a bare `null` — every silent drop
  (unwritable path, no edits/merge_patch, all edits no-op, blank result, unfetched content) now
  logs its specific reason.
- `COACH_CHAT_BRANCH` env var (defaults to `main`) makes the commit branch configurable, so a real
  close can be tested end to end on a scratch branch instead of writing to a live athlete's repo.
- Structured `close-trace` log line per close (`traceId`, `threadId`, what was proposed vs.
  committed/dropped and why, timing) — one line answers "what happened to this specific close,"
  replacing scattered unconnected `console.warn`s.
- `coach_note`: the model reports a short (2-3 sentence) plain-English note instead of proposing
  an exact-match edit to `coach_notes.md`; the server appends it with today's date at commit time
  (`appendCoachNote()`). Immune to the exact-match/patch-parse failure modes `file_updates` edits
  have, since it's pure append. `coach_notes.md` was fully removed from the edits-eligible file
  set as part of this — `file_updates` proposals against it are now rejected outright, not
  silently discouraged by prompt text alone.

**Split 2 / P1 — not built as originally scoped.** The intent-schema doc's plan (extend the
`coach_note` pattern to `session_note`/`quest_events`/`sleep`, delete `applyStringEdits`/
`applyJsonMergePatch` entirely, rewrite SOUL.md §12) never shipped — `file_updates` and both apply
functions are still in active use for `state.md`/`challenge_v2.json`/`current_week.json`/
`sleep_log.json`. Superseded by a different direction (see `docs/plans/coach-chat-follow-up.md`),
not carried forward as a live roadmap item.

**Real bugs found through two days of live testing against a real athlete repo (not synthetic
transcripts alone), fixed the same PR:**
- The close-trigger regex required "wrap"/"close"/"end" to be followed by "session" — a bare
  "wrap" (or "Lets wrap") never routed into closing mode at all, so Gemini answered as an ordinary
  turn and hallucinated closing-sounding language without anything actually committing. Broadened
  the trigger to catch casual bare sign-offs.
- **Bigger bug, found by actually testing the multi-turn flow, not just single messages:**
  answering Coach's own clarifying close-question (e.g. "8hrs" in reply to "how'd you sleep?")
  never re-triggered closing mode on its own, since that answer alone doesn't match the trigger
  regex. Gemini would still return `session_closed: true` and a fully convincing "all set, logged"
  reply — directly violating the ordinary-turn prompt's own instruction to set `session_closed:
  false` — while nothing committed at all. Fixed by having the trigger remember a pending close
  for a few turns (`wasCloseAttemptPending`) instead of relying on the model to self-regulate a
  second time; the underlying reasoning had already proven unreliable once (see Part B below), so
  a second reliance on the same kind of self-regulation wasn't trusted either.
- The close-trace itself had a bug: it logged `"committed"` before `commitFilesAtomic` actually
  ran, so a close that threw partway through still asserted success in its own diagnostic. Moved
  the log to fire only after a real commit lands (or with a `commit_failed` variant in the catch
  block).
- The model was observed narrating visible character-count arithmetic into the `title` field
  itself (e.g. "...Wait that is too long, shorten to under 28 chars... exactly 27 chars: ...")
  when the prompt asked for an exact character budget — burning output-token budget on it, and
  once breaking JSON validity outright mid-generation. The server already truncates title safely
  (`truncateTitle`), so the prompt was softened to "a handful of words" with an explicit
  instruction not to show any length-adjustment work, rather than asking for exact arithmetic.

**Part B — retry + honesty guard (shipped, formerly its own `coach-chat-closing-followup.md` design doc, folded in here since that code was later removed on `coach-chat-reliability-debug` — see below):**
Root-caused from a live repro (traceId `xuij2ft9`) where `reasoning` explicitly described a
`state.md` edit while `file_updates` still came back empty — confirmed the schema-reorder fix
alone (moving `file_updates` ahead of `reply` in the declared property order) wasn't sufficient.
- `hasUnsavedContentMismatch()`: true when `reasoning` is substantial, doesn't match a "nothing to
  save" phrase pattern, and both `file_updates` and `coach_note` are empty/too short.
- On a mismatch, `askGemini` fires exactly one automatic follow-up call, replaying the model's own
  prior raw response plus a nudge to actually populate `file_updates` or `coach_note` (whichever
  fits) — kept fully separate from the transport-level 504/503 retry logic (different failure
  class: content mismatch, not a network error).
- If the mismatch still holds after the retry, the POST handler appends an honest caveat to the
  athlete-facing `reply` ("I ran into trouble saving today's notes...") before it's shown or
  persisted, instead of leaving an unqualified "saved" claim standing.
- Made `coach_note` the *guaranteed* fallback rather than an equal alternative to `file_updates`:
  the closing prompt now tells the model to duplicate real content into `coach_note` whenever it
  isn't fully confident a `file_updates` edit will land, since `coach_note` never fails to match.

**Known, accepted limitation, confirmed via extensive live testing, not fixed in this pass:**
Gemini itself is still not fully reliable even with all of the above — it can claim in `reasoning`
that it's saving specific content while leaving `file_updates`/`coach_note` both empty (reproduced
on the production model, not just an exploratory pin), and was observed producing a degenerate
repetition loop in `title` that burned its entire output budget before reaching the fields that
matter. This is a live, ongoing model-reliability question, not something resolved by more
prompt/schema tweaking alone in this pass — tracked as a still-open item, not a bug ticket, since
there's no known code fix yet.

---

## 2026-08-15/16 — Modularization: coach-chat.ts split into single-purpose modules (PR #356)

`coach-chat.ts` mixed HTTP handling, Gemini prompt/transport, thread persistence, day/timezone
math, close-signal detection, and write authority in one file (1614 lines at peak, ~1049 after
the reliability-debug strip-down above). Split into `ui/api/coach-chat/_lib/`: `coachDay.ts`,
`closeSignal.ts`, `chatThreads.ts`, `coachPrompt.ts`, `geminiClient.ts`, `coachSinceStamp.ts`, plus
the two pre-existing coach-chat-specific `_lib` files (`coachChatFiles.ts`, `soulCache.ts`)
moved in alongside them. `coach-chat.ts` itself is now just the HTTP handler. Pure move - no
behavior change, verified via `tsc`, the full test suite (same 102 tests, only import lines
changed), the eval harness, and a live close-turn test on the `test/close-verification` scratch
branch with the actual commit content checked directly in the athlete's repo.

A follow-up pass gave `coach-chat/` its own top-level folder (`coach-chat/_lib/`,
`coach-chat/_tests/`) as a true sibling of `auth/`, rather than nesting under the generic root
`_lib/` (which is meant for cross-cutting infra only - `fileEdits.ts`, `githubGitData.ts`,
`httpTimeout.ts`). Also relocated the 5 remaining coach-chat test files and the eval-transcript
fixtures into `coach-chat/_tests/`, matching how `auth/_tests/` holds all of auth's own tests.
Added `README.md` index files to `ui/api/`, `ui/api/auth/`, and `ui/api/coach-chat/` (Path\|Role
tables, matching the existing `engine/README.md`/`platform/README.md` convention one level
deeper) so the structure is self-documenting. The 3 Vercel-routed files
(`coach-chat.ts`/`coach-chat-context.ts`/`coach-chat-profile-status.ts`) stay flat at top-level
`api/` - Vercel routes by literal file path, so nesting them would change live URLs (tracked as
`BACKLOG.md` #4, deferred, not done here).

No ADR: this is internal code organization, not a locked/architectural decision - nothing about
external behavior, URLs, or data shape changed.

---

## Superseded verification issues

Manual test checklists have been filed and re-filed as the system changed underneath them
(#222 for the original redesign, #267 for the caching/close-reliability pass, #280 for the
close-save-reliability/greet-materialization pass) — see the current consolidated checklist
issue for what's actually still unverified as of the latest pass.
