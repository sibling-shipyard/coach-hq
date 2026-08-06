# Coach-Chat Closing Turn: Background-Finish Redesign (Async Close)

Status: **not implemented — proposal for future work, not a current blocker.**

## 0. Why this exists, and why it's not urgent right now

This was originally investigated as a fix for a real production bug: closing turns ("bye"/"wrap")
were failing outright in production, with athletes seeing generic errors and nothing committing.
Root-caused (PR #283) to Gemini's `generateContent` call timing out with no retry, on the largest,
most demanding prompts in the system (closing turns pull 5 extra files + full chat history,
54-64k tokens seen in production logs).

PR #283 fixed the immediate bug: longer per-call timeout (45s), retry-on-504/503 capped to one
retry total (not stacked), and `maxDuration` raised in `ui/vercel.json`.

**Mid-investigation, we confirmed the account has Vercel Fluid Compute enabled**, which per
Vercel's own changelog raises the Hobby plan's function-duration ceiling to a full **300 seconds**
(not the 60s originally assumed). PR #283's worst-case retry chain (~90s) fits comfortably inside
that. So the acute problem — requests dying because Vercel killed the function too early — is
already solved. There is no current fire this document is fixing.

**What this document is:** the fuller structural fix that was designed the same day, before the
300s ceiling was confirmed. It's still worth doing eventually, for reasons that have nothing to do
with hitting a duration ceiling:

- **Better athlete-facing UX.** Right now the athlete's app sits on a spinner for however long
  Gemini + the GitHub commit takes (multiple seconds to over a minute in a bad case). An instant
  "got it, wrapping up..." ack feels dramatically better than a long wait, even if the wait would
  eventually succeed.
- **Removes the ceiling dependency entirely**, rather than just raising it. 300s is generous, but
  it's still a number someone picked, tied to a specific Vercel plan/feature combination that could
  change. A background-finish design doesn't care how long the slow part takes.
- **Decouples request lifecycle from Gemini's actual latency variance.** Gemini's response time is
  not fully in our control (model load, prompt size, provider-side incidents). An architecture that
  isn't racing a clock at all is more robust to that variance than one that's tuned against today's
  observed worst case.

Pick this up whenever it's worth the engineering time relative to other priorities — not because
anything is currently broken.

## 1. Current architecture (what exists today, for context)

The full closing-turn POST path lives in `ui/api/coach-chat.ts`'s `handle()` function, roughly
lines 975-1220. Sequence:

1. `getHeadSha()` — A5 cross-device staleness check, one GitHub API call.
2. `loadCoachContext()` — state.md + quest_log.md (60s in-memory cache, so often free).
3. On a closing turn specifically: `loadChatHistory()` + `loadClosingFileContext()` in parallel —
   pulls `chat_history.json`, `coach_notes.md`, `challenge_v2.json`, `current_week.json`,
   `sleep_log.json`.
4. `askGemini(..., mode: "closing")` — the slow, sometimes-multi-attempt Gemini call (~line 1052).
5. Title/preview computation from the Gemini reply (`geminiTitle`/`fallbackTitle`/`computedTitle`).
6. `resolveFileUpdate()` per proposed file change.
7. `commitFilesAtomic()` — the actual GitHub commit (blob → tree → commit → ref), ~line 1199.
8. `Response.json({ reply, closed: true, threadId, threads, repoSha, profileComplete })` —
   everything, all at once, only after the commit has actually landed.

The non-closing (ordinary turn) response is `{ reply, closed: false, repoSha, stale }` — much
simpler since nothing commits.

Client behavior today (both platforms) treats that single POST response as the complete, final
truth: web (`ui/client/src/pages/CoachChat.tsx` lines ~311-322) clears the local uncommitted draft
(`clearThreadLocally`) and replaces the whole thread list with the server's response the instant
`closed: true` comes back. iOS (`ios/CoachHQ/CoachHQ/Services/CoachChatAPIClient.swift` lines
~200-217) explicitly documents that `sendMessage` "blocks until a closed: true response reports a
real commit happened."

## 2. Proposed design: what moves to the background, what stays synchronous

**Recommendation: `askGemini` stays synchronous. Only `resolveFileUpdate` + `commitFilesAtomic`
move to a background task.**

Why not defer the Gemini call too: the reply text (`reply.reply`) is what the athlete actually
sees and is waiting on — deferring it would mean the instant ack has no real coach response at
all, just "message received," which is a worse experience than the plan is trying to achieve.
`askGemini`'s output is also needed synchronously to decide `session_closed` in the first place
(you can't know if you're closing until Gemini tells you). The commit step, by contrast, is
comparatively fast (a handful of GitHub API round trips) and its outcome isn't something the
athlete needs to see synchronously — nothing about "was the file actually written" is part of the
conversational reply.

This also substantially de-risks the background portion: the slow, variable-latency part (Gemini
generation) stays in the request/response cycle where PR #283's timeout/retry tuning already
governs it; the backgrounded part only needs to survive a few GitHub API calls' worth of time, not
tens of seconds of AI generation.

### New response shape

A third state alongside today's `closed: true` / `closed: false`:

```
{
  reply: string,              // Gemini's actual reply text - shown immediately regardless
  closed: "pending",          // NEW - distinct from true/false, not a boolean
  threadId: string,           // same id that will appear in the eventually-committed thread list
  provisionalThread: ChatThread,  // title/preview computed synchronously, status: "active"
  repoSha: string | null,
  stale: boolean,
}
```

`closed: "pending"` is deliberately a string, not a boolean, so client code handling `closed` as a
simple true/false can't silently misinterpret it via truthy coercion. Both clients' response-shape
types need to become proper three-state discriminated unions (TypeScript on web, likely an enum on
iOS) so the compiler forces every call site to handle all three states explicitly.

Not included in the pending response: the full `threads` list. It isn't trustworthy until the
background commit actually lands — computing it requires the merge against fresh GitHub state that
only happens inside the background task.

### Backend wiring

- Add `@vercel/functions` as a dependency (not currently present — `ui/package.json` today only
  has `@vercel/edge-config`).
- Wrap the deferred work in `waitUntil()`:
  ```ts
  waitUntil(
    backgroundClose(resolvedUpdates, commitMessage, ctx)
      .catch(err => console.error("[coach-chat] background close failed:", err, { repo, finalThreadId }))
  );
  return Response.json({ ...pendingShape });
  ```
- **Background-failure visibility is the sharpest edge of this design.** Today, a failed commit
  returns a 502 the client sees immediately and can react to. Once this ships, a background
  failure has no request left to fail — it only reaches a `console.error` in Vercel's logs, which
  nobody is watching in real time for one athlete's one failed close. This is a genuine UX
  regression risk unless the client-side poll (below) has an explicit, real "give up and tell the
  athlete" path. Do not ship this without that client-side path — "it's logged server-side" is not
  sufficient on its own.

### Runtime question (needs resolving before this work starts)

`ui/api/coach-chat.ts` currently has **no explicit `export const config = { runtime: ... }`**
anywhere (confirmed via grep across `ui/api/`). It uses the Web-standard fetch-handler export
style (`export default { async fetch(req: Request) {...} }`), which historically signals Edge
Runtime by convention but is now also supported on Vercel's Node.js runtime. **Whether this file is
actually deployed as an Edge Function or a Node.js Function today cannot be determined from the
repo alone** — check the live deployment's Functions tab in the Vercel dashboard before starting
this work. This matters because:

- `waitUntil` from `@vercel/functions` is the standard, well-documented path on Node.js runtime.
  It's also usable on Edge (Edge Functions support post-response execution up to 300s via
  streaming, provided the initial response starts within 25s), but Node.js is the more supported,
  less surprising choice.
- Vercel has deprecated Edge Functions in favor of Node.js-runtime Vercel Functions going forward
  — building new infrastructure on a deprecated runtime is the wrong direction if a migration is
  cheap, which it likely is here (the fetch-handler signature doesn't need to change, only the
  runtime declaration).
- If it turns out `coach-chat.ts` is already running as a Node.js Function despite the fetch-handler
  style, this whole "migrate off Edge" concern may be moot — confirm before assuming work is needed.

If a migration is needed: add `export const config = { runtime: "nodejs" }` (verify current exact
syntax against Vercel's docs at implementation time, since this has shifted across platform
versions) near the top of `coach-chat.ts`.

### `ui/vercel.json`

No changes needed beyond what's already there (`maxDuration: 300` as of today's fix) — `waitUntil`
doesn't have its own separate config knob in `vercel.json`; the platform's post-response execution
budget is governed by the function's own duration/Fluid Compute settings.

## 3. Client polling design (both platforms)

**Reuse the existing `GET /api/coach-chat` endpoint — do not add a new one.** It already returns
`{ threads: withComputedDayOffsets(history.threads, stateMd) }`, freshly read from GitHub on every
call, which is exactly what's needed to detect "did my background close land." (ADR 0017 caps
Vercel deployments at 12 functions on Hobby; this repo is at 7 today, so there'd be room for a new
endpoint if truly needed, but reusing GET is simpler and avoids growing that count at all.)

### Flow, once `closed: "pending"` comes back

1. **Do not clear the local draft yet.** Web's `clearThreadLocally` / iOS's `CoachChatLocalCache`
   clearing currently happens immediately on any `closed` response — this needs to move to only
   fire once the poll below confirms the commit actually landed. Until then, the draft stays as
   the source of truth for what the athlete sees if they leave and come back.
2. **Show `provisionalThread` immediately** in the thread list/sidebar — optimistic UI, so the
   athlete sees their conversation reflected right away even though the real commit hasn't
   happened yet. A subtle "saving..." affordance is a nice-to-have, not required for correctness.
3. **Poll `GET /api/coach-chat`**, looking for `finalThreadId` in the returned list with content
   matching what was just closed. Message count/content match is a more reliable "did MY close
   land" signal than comparing titles (two closes could theoretically race, and title generation
   has its own variability — see PR #283's title-corruption fix).
4. **On match:** treat as confirmed. Clear the local draft now, replace `threads` state with the
   real fetched list (carries the actual committed title/preview), update the active thread if
   still relevant.
5. **On give-up (poll timeout):** do NOT silently assume success. Keep the local draft intact and
   surface a real error/retry affordance to the athlete — this is what replaces today's synchronous
   502 visibility, and it's not optional (see the background-failure-visibility concern above).

### Suggested polling parameters (starting point, not gospel)

- Poll every ~3s for the first several attempts (the commit step itself is normally fast once
  Gemini's reply is already known — this covers the common case quickly).
- Back off to every ~8-10s after that.
- Give up after ~90s total — long enough to exceed the background task's realistic worst case
  (a few GitHub API calls, even with retries, shouldn't need anywhere near that), so a slow-but-
  eventually-successful close isn't reported as failed prematurely.

These numbers aren't grounded in production telemetry yet — treat as a reasonable starting point
for whoever implements this, tunable after real data comes in.

There's no existing shared "poll with backoff" primitive in this codebase to reuse — the only
comparable precedent is `coach-chat-profile-status.ts`, which iOS polls on a timer, but that
interval-loop logic lives entirely client-side in iOS with nothing generic exposed. Each platform
will need its own (small) poll-loop implementation; what's reused is the endpoint, not the loop.

### Web-specific changes

- `ui/client/src/components/coach-chat/coachChatModel.ts` (`sendMessage`'s return type, ~lines
  223-254): add the third arm to the response union:
  `{ closed: "pending"; reply: string; threadId: string; provisionalThread: ChatThread; stale?: boolean }`.
  The existing `rememberRepoSha` call (~line 248) should NOT fire on the `pending` state — only
  once the poll confirms the real commit.
- `ui/client/src/pages/CoachChat.tsx` (~lines 311-322): new branch for `result.closed === "pending"`
  — set `provisionalThread` into `threads` state, keep the local draft, start the poll (a new hook
  or an inline `useEffect`/`setInterval` scoped near where `sendMessage` is called — this is UI
  polling behavior, belongs in the component/a UI hook, not `coachChatModel.ts`'s data layer).

### iOS-specific changes

- `ios/CoachHQ/CoachHQ/Services/CoachChatAPIClient.swift` (~lines 200-217): update `sendMessage`'s
  doc comment (currently says it blocks until a real commit is confirmed — no longer true).
  `ChatSendResponse`'s `closed` field likely needs to become an enum rather than `Bool` — locate its
  exact `Codable` definition (not confirmed in this session's research; check the same file or a
  shared model file) and convert.
- The `shaStore.rememberAndPrune` call (~lines 213-216) should similarly defer until poll-confirmed.
- `CoachChatLocalCache` is the direct iOS analog of web's local-draft persistence — same
  don't-clear-until-confirmed treatment applies.
- Worth looking at the existing `coach-chat-profile-status` polling consumer on iOS for interval-
  loop style consistency, even though it's a different endpoint.

## 4. Suggested PR split

Following this repo's established pattern for multi-area changes (precedent: PRs #276 backend /
#277 web / #278 iOS / #279 docs, all for one comparably-sized redesign earlier this project):

**PR A — Backend** (Tech Lead or Bob the Builder)
- `ui/api/coach-chat.ts`: runtime config resolution, `waitUntil` wiring, closing-branch restructure
  (defer `resolveFileUpdate`/`commitFilesAtomic`), new `closed: "pending"` response shape,
  background-failure logging.
- `ui/vercel.json`: any runtime-related config updates.
- `ui/package.json`: add `@vercel/functions`.
- Test coverage for the pending-response path and background-task success/failure — likely a new
  test file (e.g. `coach-chat-background-close.test.ts`). Verify `@vercel/functions`'s `waitUntil`
  has a mockable/testable seam before assuming standard vitest patterns apply cleanly — this is a
  real implementation risk worth spiking early, not assuming.

**PR B — Web** (UI Expert)
- `coachChatModel.ts`: response-type union, `sendMessage`'s pending branch, deferred sha-remembering.
- `CoachChat.tsx`: pending-state handling, poll loop, deferred draft-clear.
- Associated test updates wherever close-handling is currently covered.

**PR C — iOS** (iOS Builder)
- `CoachChatAPIClient.swift`: `sendMessage` logic/doc update, `ChatSendResponse.closed` type change,
  deferred sha-remembering.
- New poll-loop implementation (file placement is iOS Builder's call, matching existing patterns).
- `CoachChatLocalCache` deferred-clear integration.

**PR D — Docs** (Tech Lead, likely)
- `docs/eng-docs/coach-chat-flow.md`: update the closing-turn section to describe the pending/poll
  model as current-state (once shipped).
- `docs/eng-docs/coach-chat-design-history.md`: dated entry for the change.
- `docs/eng-docs/gemini-flow.md`: likely minimal changes, since `askGemini` itself stays
  synchronous — confirm at implementation time whether anything here actually shifted.
- Consider a new ADR: this introduces a genuinely new three-state response contract and a
  background-execution pattern that doesn't exist elsewhere in the codebase yet — arguably
  significant enough to be ADR-worthy (precedent: ADR 0012 covers commit atomicity, ADR 0017
  covers function count). Tech Lead's call whether to write one now or fold the rationale into the
  design-history entry only.

### Sequencing

**PR A must merge together with (or immediately before) B and C** — unlike the earlier #276-278
split, which shipped additive/backward-compatible changes gradually, this response-shape change is
genuinely breaking. An old client talking to the new backend would see `closed: "pending"` and not
know what to do with it (whatever its fallback behavior is, it's undefined here). Either coordinate
a same-day merge across all three, or have the backend feature-flag the pending path off until both
clients are ready. PR D can trail slightly since it documents already-shipped behavior.

## 5. Open questions for whoever picks this up

1. ~~Is Fluid Compute enabled?~~ **Resolved: yes**, confirmed via the live Vercel dashboard. Hobby +
   Fluid Compute = 300s ceiling (Vercel's own changelog). This is why this whole redesign is no
   longer urgent.
2. **Is `coach-chat.ts` actually deployed as Edge or Node.js today?** Not resolvable from the repo
   alone (no explicit `export const config` anywhere) — check the Vercel dashboard's Functions tab
   for the live deployment before starting. Determines whether a runtime migration is even needed.
3. **Response-shape rollout coordination**: same-day coordinated 3-PR merge, or does the backend
   need an actual feature flag to decouple deploy timing from client readiness? Needs a decision
   before PR A is written, since it affects PR A's scope (flag logic or not).
4. **UX for the poll-timeout "give up" state**: silent (draft just sits there for the athlete to
   notice next time) vs. an active toast/error/retry affordance? This is a product decision, not
   purely technical, and affects PR B/C scope non-trivially — get an explicit answer before
   implementing either client.

## 6. Reference: files this touches

- `ui/api/coach-chat.ts` — core backend logic.
- `ui/vercel.json` — runtime/duration config.
- `ui/package.json` — new `@vercel/functions` dependency.
- `ui/client/src/components/coach-chat/coachChatModel.ts` — response types, `sendMessage`.
- `ui/client/src/pages/CoachChat.tsx` — pending-state UI handling, poll loop.
- `ios/CoachHQ/CoachHQ/Services/CoachChatAPIClient.swift` — response handling, poll loop.
- `ios/CoachHQ/CoachHQ/Services/CoachChatLocalCache.swift` — deferred-clear integration.
- `docs/eng-docs/coach-chat-flow.md`, `docs/eng-docs/coach-chat-design-history.md`,
  `docs/eng-docs/gemini-flow.md` — doc updates once shipped.
- Possibly a new ADR under `kdb/decisions/`.
