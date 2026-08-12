# coach-chat closing follow-up (Part B — deferred)

**Status:** not implemented. Revisit only if the Part A fix (schema reorder + broader close-trigger
regex, shipped separately) doesn't reliably fix empty `file_updates` on closing turns in practice.

## Background

Production repro (2026-08-12, athlete repo coach-skanda-2003): typed "wrap session" correctly, but
Gemini's closing-turn `reasoning` said it was updating `state.md`/`challenge_v2.json`/
`sleep_log.json`, while the `file_updates` array it actually returned was empty. The backend
(`ui/api/coach-chat.ts`) only logged a server-side warning ("close landed with zero file_updates")
and still committed `chat_history.json`, showing the athlete an unqualified "all set and saved"
reply. Root cause: `file_updates` was optional in the Gemini response schema and declared after
`reply`, so nothing forced or verified it matched what `reasoning` claimed.

Part A (shipped) reorders the schema so `file_updates` comes right after `reasoning` and before
`reply`, and broadens the close-trigger regex to catch bare "wrap" and similar casual phrasing.
If that alone doesn't fix things (check Vercel logs for continued "close landed with zero
file_updates" warnings), implement this:

## B1 — automatic one-shot retry on mismatch

In `askGemini` (`ui/api/coach-chat.ts`, ~lines 700-736): if `mode === "closing"` and `file_updates`
comes back empty/absent but `reasoning` implies real content was described (heuristic: reasoning is
non-trivial and doesn't match a "nothing to save" phrase list, e.g.
`/nothing (concrete|new|to save)|no (changes|updates) needed|already reflect(s|ed)|genuinely empty/i`),
fire one follow-up `generateContent` call in the same request:
- Replay the model's own prior turn (`{ role: "model", parts: [{ text: rawText }] }`) plus a new
  `user` turn nudging it: "Your reasoning above described saving specific content, but file_updates
  was empty. Populate file_updates now with the exact edits your reasoning described (or, if there
  is truly nothing to save, say so explicitly in reasoning and leave file_updates empty). Also
  re-set checklist_covered and reply to match whatever you decide here — this is the final answer."
- Use the retry's `file_updates`/`reply`/`checklist_covered` instead of the original.
- Cap at exactly one retry, kept separate from the existing 504/503 transport-retry logic (lines
  ~719-733) — different failure class (content mismatch vs. network failure), must not share state
  or retry counters with it.
- Needs `finishGeminiResponse` (~lines 740-784) refactored so raw response text + parsed body are
  both available before `reasoning` gets stripped, so the retry can replay the prior turn.
- Cost: up to ~45s and one extra Gemini call, only on turns that hit this specific mismatch.

## B2 — athlete-facing honesty guard

If, even after the retry, resolved `validUpdates` is still empty and the mismatch heuristic still
holds, append a short caveat to `reply` server-side (near the existing zero-file_updates warning,
~lines 1179-1198) before it's shown to the athlete or committed to `chat_history.json`, e.g.:

> "(One thing to flag: I ran into trouble saving today's notes — worth double-checking your log
> next time you're in, and let me know if anything's missing.)"

This must run before the chat transcript entry is built, so the caveat is what's actually persisted
and shown — not patched in after the fact.

## B3 — `checklist_covered`

No separate fix needed. It's regenerated for free by B1's retry, since the retry re-runs the whole
schema, not just `file_updates`.

## Verification (when implemented)

- Unit test for the mismatch heuristic (a few strings: the production `reasoning` example above, a
  genuine "nothing to save" example, an empty string).
- New eval transcript (`ui/api/_tests/coach-chat-eval/transcripts/08-close-reasoning-implies-save.json`)
  modeled on the production repro (sleep, cold shower, protein, strength session plan for tomorrow),
  asserting non-empty `file_updates` and the existing `noFabricatedSaveLanguage` check in
  `ui/scripts/eval-coach-chat.ts` passes.
- Add a new internal-only `GeminiReply` field (e.g. `_unsavedContentSuspected`, set by `askGemini`
  after the retry resolves, consumed by the honesty guard) to the eval harness's existing
  internal-field leak check (`"reasoning" in reply`-style check in `eval-coach-chat.ts`).
- After a few days in production, check log volume for how often the retry actually fires — tells
  you whether Part A's reorder alone was handling most cases or whether B1 is pulling real weight.

### Critical files
- `ui/api/coach-chat.ts` — retry logic ~lines 700-736, honesty guard ~lines 1179-1198, new internal
  `GeminiReply` field ~lines 334-345
- `ui/scripts/eval-coach-chat.ts` — internal-field leak check
- `ui/api/_tests/coach-chat-eval/transcripts/` — new regression transcript
