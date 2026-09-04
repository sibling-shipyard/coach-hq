# K1 — Final live test pass before this redesign ships — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-02

Execution detail for K1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Runs **last**,
after H1 — the actual gate before this whole stack merges to `main`, not one more milestone
alongside the others.

## Problem

Every PR in this redesign deferred its own live-Gemini and live-scratch-repo checks — each one
individually reasonable (paid API calls, ADR 0024's gate), but nothing ever consolidated them into
one real pass against the final, fully-integrated stack. Per-PR eval runs test that PR's own diff
in isolation; they don't prove the whole redesign together still does what the HLD's own "Done
when" section promises. Right now that promise is unverified end to end.

## Fix — one consolidated live pass, with real evidence per item

Run against the final integrated branch (every PR in this stack landed, right before merge to
`main`), not a scratch branch missing later work:

1. **Full `npm run eval:coach-chat` on `gemini-pro-latest`** (the real production model — see
   `geminiModel.ts`). Triage every failure: fix it, or file it as its own issue and note it here
   as a known, accepted gap. 2026-09-02's run (11/15 flash, 12/15 pro, logged in
   `tests/2026-09-02/eval/`) is a starting point, not the final answer — re-run once every PR in
   the stack has actually landed together.
2. **Live multi-day scratch-repo conversation, C2's own "Done when"**: one `coach_log` row per
   day that had messages, updated in place as the day progresses, absent on inactive days,
   present whenever another structured write also fired that turn. Never run live — C2's PR body
   flagged it, never done.
3. **Two live scratch-repo conversations, E1's own "part that matters most"**: same fact stated
   with two different `coaching_style` values, confirming Coach's reply text actually reads
   differently — direct/unpadded vs. progress-first vs. reasoning-first. Never run live.
4. **Re-verify #807 and #808** (both filed during G1's live eval pass): `plan_edit` silently
   dropped without a wrap-up cue, and `quest_create` flaky (~1 in 3) when a habit is stated
   alongside `season_start` after profile completion. Confirm still-reproducing, still-open, or
   fixed by something later in the stack — don't let them go stale unconfirmed.
   - **#808 — prompt strengthened, live-tested, still flaky (2026-09-03, PR #824).** Root cause:
     the pre-redesign closing-turn prompt had a dedicated "this is the field most likely to get
     missed" warning for `quest_create`. C1 removed the closing-turn path entirely, and the
     surviving FSP ordinary-turn text never carried that warning over — `season_start` and
     `quest_create` sat as two clauses in one flat sentence with no mention of the pairing risk.
     Fixed in both places that actually reach a live turn: `coachPromptText.ts`'s FSP
     ordinary-turn block, and `B_engine.md`'s Step 4. The latter reaches the hosted app too,
     since its First Session section is horcrux-injected per-turn, not part of the static
     `SOUL.chat.md` prefix. Live-tested (5 fresh runs each via
     `npm run eval:coach-chat -- --only 30-fsp-quest --fresh`). Also fixed
     `eval-coach-chat.ts`'s `PROMPT_SOURCES` in the same PR. J2 moved
     `coachPromptText.ts`/`coachReplySchema.ts`/`geminiClient.ts` into `_lib/gemini/`, and the
     eval harness's cache-fingerprint list still pointed at the pre-J2 paths. It had been silently
     unrunnable on the stack tip since J2 landed. **`gemini-flash-latest`: 0/5 pass** —
     same failure every run, `season_start`/`sports_update` fire, `quest_create` never does, and
     both the reply text and `coach_note` explicitly claim the habits are saved anyway.
     **`gemini-pro-latest` (the real production model, per `geminiModel.ts`'s pin): 4/5
     pass** — an improvement over the ~1-in-3 baseline this issue was filed against. Still not
     reliable, and n=5 is a small sample. The prompt fix alone is not sufficient, at least on
     flash. Live evidence points at a structural cause beyond wording.
     `.github/agents/bob-the-builder.md`'s own Learning says Gemini's `responseSchema` fills
     properties roughly in declaration order. `quest_create` is declared **last** in both
     `FSP_ACTIONS` and `RETURNING_ACTIONS` (`coachReplySchema.ts`) — same position regardless of
     model, which would explain why prompt wording alone couldn't move flash's rate at all.
     **Not yet tried:** reorder `quest_create` earlier in both action-field lists (e.g. beside
     `season_start` in the data-fact half, not trailing every other field), then re-test both
     models. Left for a follow-up on #808, not blocking this pass.
   - **#808 — returning-athlete path found and fixed the same day, still not resolved
     (2026-09-04, PR #824).** A full line-by-line audit of the SOUL layers and
     `coachPromptText.ts` (prompted by wanting to be sure this PR was actually complete before
     merging) found the first commit only strengthened the First Session branch. B3 already made
     `season_start`/`quest_create` available to a returning athlete on any turn. The returning
     branch (`coachPromptText.ts`'s non-FSP block, and `B_engine.md`'s `s5b1` "Current Season"
     rule) had zero pairing warning — the exact same bug shape, unfixed. Added the matching
     warning to both. `s5b1` has no `keyTargets` override, so it lands in `SOUL.chat.md`'s static
     prefix directly — confirmed via `compose-soul.mjs`, no horcrux dependency this time. New eval
     transcript `35-returning-season-and-habit-same-turn.json` (a returning athlete starting a new
     season and naming a new daily habit in the same message; the harness runs with `soul: ""`, so
     this only exercises `coachPromptText.ts`, not the SOUL addition). 5 fresh runs each:
     **`gemini-flash-latest`: 0/5. `gemini-pro-latest`: 0/5.** Worse than the FSP path's 4/5 on
     pro, and the prompt fix moved neither model at all here — `season_start` fires every time,
     `quest_create` never does, reply text and `coach_note` both claim the habit is saved anyway.
     Confirmed genuine on a full run log, not a transcript-setup artifact. The audit's own
     field-order check found `season_start`/`quest_create` sit at positions 8-9 of 9 in
     `FSP_ACTIONS` (last, right before `reply`), and at 9-10 of 15 in `RETURNING_ACTIONS`.
     That's nominally less exposed there, yet the live result is worse, not better. Wording alone
     does not fix either path.
   - **#808 — field order reordered and re-tested, hypothesis rejected (2026-09-04, PR #824).**
     Moved `season_start`/`quest_create` from the tail of `FSP_ACTIONS`/`RETURNING_ACTIONS` to
     right after `coach_note` (both arrays), on the theory that Gemini's declaration-order fill
     tendency was the structural cause the prompt fix couldn't reach. Updated the two schema
     tests in `first-session-injection.test.ts` that asserted the old order. Re-ran all 4
     combinations, 5 fresh runs each: **FSP flash 0/5** (unchanged), **FSP pro 4/5** (unchanged),
     **returning flash 0/5** (unchanged), **returning pro 1/5** (up from 0/5, still mostly
     failing). Reordering moved almost nothing — pro-latest's FSP rate is identical before and
     after, and flash didn't move at all on either branch. The field-order theory is not the
     (or not the whole) explanation; something else is driving the drop. Kept the reorder in
     since it's a plausible minor contributor and has no measured downside (all existing tests
     still pass), but it does not fix #808 on its own. A schema-level `required` marker isn't an
     option — Gemini structured output doesn't enforce conditional requireds across sibling
     fields. **Not yet tried:** a two-pass approach (detect the compound case, ask Gemini to
     confirm the habit was captured), or a stricter self-check instruction referencing the
     specific fired field. #808 stays open, unresolved by this PR.
   - **#807 — untouched by this pass.** Same G1 batch, different failure shape (`plan_edit`
     agreed in prose, no field set at all, not a pairing-drop) — needs its own root-cause dig, not
     assumed to share #808's fix.
5. **The HLD's own "Done when" section, run for real**, on one fresh scratch athlete repo. FSP
   goal, habits, and injuries all land in the same conversation regardless of when profile fields
   complete. A returning athlete's ordinary "I'm 76kg now" persists without closing. `quests.json`
   / `profile.json` show no skeleton-init placeholder data after carve.
6. **`bash platform/scripts/check.sh --quiet`**, clean, on the actual final integrated tip — not
   per-PR (already done), the merged whole.

## What this deliberately does not do

Re-review already-reviewed PRs' code. This is a live-behavior pass, not a second code review —
Tech Lead review already happened per PR, per `AGENTS.md`.

## Tests

Not applicable in the usual sense — this milestone *is* the test pass. Its own artifacts (eval
run logs under `tests/<date>/eval/`, scratch-repo commit links) are the evidence.

## Done when

Every item above has a real run attached — a log file, a commit link, or an issue number — not a
checkbox with nothing behind it. Any remaining known failure is filed as its own issue and
explicitly accepted here, never silently dropped. Only then does this redesign merge to `main` —
and per `AGENTS.md`'s plan-delete-on-last-PR rule, this K1 PR is the one that deletes
`docs/plans/chat-commit-redesign.md` and every `ccr-*-lld.md` file, folding anything durable into
the relevant `docs/eng-docs/*` page first. H1 no longer does this — K1 runs after it.
