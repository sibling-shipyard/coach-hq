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

## Done when

Live-test: deliberately trigger a stale/invalid quest id reference on a scratch branch, confirm (a)
the chat message and any other valid writes from that turn still land, (b) Sentry shows the
rejected action, (c) the next turn's context references it.
