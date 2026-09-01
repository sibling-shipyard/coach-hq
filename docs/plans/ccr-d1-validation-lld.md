# D1 — Self-correcting validation — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for D1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Closes #736.
Stacked on A1 (needs the always-commit foundation for "partial commit" to mean anything).

## Problem, precisely scoped

Issue #736's literal claim (CI only checks JSON-parses + top-level keys + text-length on 3 files)
is correct but incomplete — there's a real layer #736 doesn't credit: Gemini's structured-output
mode already enforces `enum` constraints server-side for several fields (`memory_update.label`,
`injury_event.status`, `quest_event.status`) — this isn't post-hoc validation, it's the API
constraining what tokens the model can generate. The real gaps:

1. **Referential-id fields aren't enum-constrained.** `injury_event.flag_id` and
   `quest_event.quest_id` are free-text `{ type: "string" }` because valid values change per
   athlete per turn — this is exactly the shape of bug #693 (Gemini inventing a `flag_id`) and the
   general hallucinated-id class.
2. **A validation failure today loses the entire turn, not just the bad field.** An applier throw
   happens inside `commitFilesAtomic`'s blob-building step, aborting the whole atomic commit —
   including the athlete's chat message, which has nothing to do with the bad quest id.
3. **Nothing captures these failures to Sentry.** Only Gemini-call failures are instrumented
   (`captureGeminiFailure`); applier/commit throws are `console.error` only.
4. **Claude/BYOB direct writes have no schema layer at all** — completely unenforced, out of this
   PR's scope (prompt-only discipline, a different runtime), noting it here so it isn't mistaken
   for closed by this work.

The athlete's stated goal: validation failures should not cost real data, ever, if there's any way
to avoid it.

## Fix — three layers, cheapest and most reliable first

**1. Dynamic enum constraints for referential-id fields.** `generationConfigFor(mode, firstSession)`
(`coachReplySchema.ts:371`) is already a pure function rebuilt fresh per request — nothing
structurally blocks passing per-athlete data into it. The current valid quest ids
(`turn.context.quests`) and injury flag ids (`turn.context.injuries`) are already loaded earlier in
turn processing, just not extracted before the `askGemini` call today (currently computed *after*,
for post-hoc validation). Move that extraction earlier and thread it into `generationConfigFor` so
`injury_event.flag_id`/`quest_event.quest_id` become real `enum` fields, scoped to that athlete's
actual current ids for that specific request. This makes a hallucinated id **structurally
impossible to generate** in the common case, not just caught after the fact.

**2. Bounded one-shot corrective retry for anything constraints don't fully prevent** (schema
constraints are strong but not formally airtight — this codebase's own experience already shows
`maxLength` is "a real constraint Gemini receives, not a guarantee it honors," per
`docs/eng-docs/gemini-flow.md:154-155`). Model this after the existing oversized-text-field pattern
(`coachTurn.ts:278-360`, `findOversizedTextField` → one corrective `askGemini` call naming the
specific problem → deterministic fallback if that also fails): detect the specific invalid
reference post-reply, make one small corrective follow-up call naming the actual valid ids, use the
corrected result. Same one-retry cap as the existing pattern — stays inside `vercel.json`'s
`maxDuration: 300` budget.

**3. Split the transcript commit from the structured-facts commit, and commit facts
per-validated-batch, not per-turn-atomically.** Chat history (what was said, Coach's reply) commits
independently — it's never at risk from a bad structured field, they're unrelated data. For the
structured-fact writes: validate every action **before** attempting to build any commit (not inside
the blob-resolve closure, which aborts the whole batch on the first throw). Commit everything that
passed; drop only what didn't. A rejected action never disappears silently — capture it to Sentry
with enough detail to see the pattern (see D3), and fold it into next-turn context so Coach can
naturally follow up ("I couldn't quite save that habit update, can you confirm?") instead of the
athlete finding out never.

## What this deliberately does not do

Attempt 100% prevention — layer 2's existence is an admission that constrained generation isn't
formally airtight. The goal is "as close to never as the API allows, and never silent when it does
happen" — not a guarantee no validation failure can ever occur.

## Fix — GitHub commit failure must not discard the reply

Found during this planning pass, not hypothetical: today, when `commitFilesAtomic` fails after its
internal 3-attempt retry, `commitOrdinaryTurn`/`commitClosingTurn` (`coachTurn.ts:622-628`,
`:684-690`) return only `{ error, traceId }` with a 502 — **Gemini's already-generated reply text is
discarded entirely**, even though the model did its job. The athlete never sees what Coach said,
only a save-failure message. This gets more consequential once every turn commits (A1) instead of
only the closing turn — an outage now has one chance to bite per turn with a write, not once per
conversation.

Fix: the error response includes `turn.reply.reply` alongside the error, so the client can show
Coach's actual words plus a clear "but I couldn't save that — try again?" rather than losing the
reply along with the failed write. Bring iOS up to what web already does while here — today web
surfaces the server's specific error string, iOS collapses any 5xx to a generic "something went
wrong" (`UserFacingError.swift:35-42`) and loses even that detail. Both platforms show the same
information: the reply, plus which save failed, plainly.

## Fix — validation-failure signal is now a firm requirement, not left to Coach's next reply

Previously: a rejected action (layer 3's corrective-retry-then-drop path) was surfaced only by
folding it into next-turn context and trusting Coach to mention it — the same "hope the model
remembers" pattern this whole redesign exists to move away from. Firm requirement now: the turn's
response includes a structured field (e.g. `droppedActions: [{ field, reason }]`) whenever layer 3
drops something, independent of whether Coach's own reply happens to mention it. The client shows
an explicit, honest indicator when this is non-empty — not a scary error, but not silent either.
Both platforms already run their own Sentry SDK (`@sentry/react` on web, `sentry-cocoa` on iOS,
confirmed present, not new setup) — capture the dropped-action event there too, client-side, so a
pattern is visible from both ends, not just the backend's `console.error`/Sentry capture.

## Fix — Gemini-call failure gets its own honest, consistent message

A third real failure point, distinct from the two above: the Gemini call itself never returns a
usable reply at all (503/504/429, empty content, malformed JSON) — not "Coach replied but something
after that failed," but "Coach never got to reply." Today this is handled inconsistently:

- Only one retry happens, and only for 503/504 (`geminiClient.ts:150-158`, fixed 500ms backoff) —
  429 and other errors get zero retry. This is not reliable at real conversation scale: issue #668's
  own measurement shows `gemini-flash-latest` going 0-of-5 on real turns even with this retry
  active, which is why the model is currently pinned to `gemini-pro-latest`
  (`geminiModel.ts:5-10`). This PR does not change retry counts or model choice — that's #668's
  territory, not duplicated here.
- The response shape lacks `traceId` (`coachTurn.ts:349-360` returns `{ error: message }` only,
  unlike the commit-failure path's `{ error, traceId }`) — inconsistent for no reason.
- The raw upstream error text leaks straight to the athlete (e.g. a toast literally reading
  `"Gemini request failed (503): ..."`) — not a message a non-technical person should see.
- Both platforms currently show this **identically** to a commit failure — the exact same generic
  "Coach didn't reply — try again," even though "Coach never replied" and "Coach replied but I
  couldn't save it" are genuinely different situations for the athlete to understand.

Fix: give this response the same `{ error, traceId }` shape as the commit-failure path (parity, not
a new pattern), map the raw Gemini error to a friendly message instead of leaking it verbatim, and
make sure the client shows a message distinct from both the commit-failure and validation-failure
cases — ties directly into I1's staged progress indicator, which already names this as one of its
three real failure shapes to display accurately.

## Tests

- `coachReplySchema.test.ts`: assert `generationConfigFor` builds a request with the athlete's
  actual current quest/injury ids as an `enum` when passed athlete context.
- `coachIntents.test.ts`: existing id-guard tests (`applyQuestEvent`, `applyInjuryEvent`) stay;
  add a case for the corrective-retry path (mock a first response with a bad id, confirm the
  retry's corrected response is what gets committed).
- New integration test: a turn with one valid `profile_update` and one invalid `quest_event`
  (post-retry-exhaustion) commits the profile update and drops only the quest event, chat history
  commits either way.
- CI (`validate-data.yml`): port the shape/enum checks that already exist for legacy
  `challenge_v2.json` (per-quest field checks) onto `quests.json`, and add `injuries.json` id
  format/uniqueness checks — closing the specific gaps #736 named.
- New test: a forced `commitFilesAtomic` failure (mock the GitHub call) asserts the error response
  still includes `turn.reply.reply`, on both the ordinary and closing paths.
- New web test: the composer shows Coach's reply text plus a save-failed indicator when the commit
  error response includes a reply.
- New iOS test: `UserFacingError.friendlyMessage` (or its replacement) surfaces the same reply +
  save-failed detail iOS currently drops — parity with web, not just "an error occurred."
- New test: a turn producing a `droppedActions` entry is captured by both the backend's existing
  Sentry pattern and a client-side capture on whichever platform received it.
- New test: a forced Gemini-call failure (mock a 503 with retry exhausted) asserts the response
  carries `traceId` and a friendly message, not the raw upstream error string.
- New web + iOS test: a Gemini-call failure, a commit failure, and a dropped-action all render
  visibly different messages in the same test run — not three paths converging on one generic
  string.

## Done when

Live-test: deliberately trigger a stale/invalid quest id reference on a scratch branch, confirm (a)
the chat message and any other valid writes from that turn still land, (b) Sentry shows the
rejected action from both backend and client, (c) the client shows an explicit indicator, not just
next-turn context. Separately, force a GitHub commit failure and confirm Coach's reply is still
shown to the athlete on both web and iOS, with a clear save-failed message, not a discarded reply.
