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
   - **#808 — prompt strengthened, not yet live-verified (2026-09-03).** Root cause: the
     pre-redesign closing-turn prompt had a dedicated "this is the field most likely to get
     missed" warning for `quest_create`. C1 removed the closing-turn path entirely, and the
     surviving FSP ordinary-turn text never carried that warning over — `season_start` and
     `quest_create` sat as two clauses in one flat sentence with no mention of the pairing risk.
     Fixed in both places that actually reach a live turn. `coachPromptText.ts`'s FSP
     ordinary-turn block is testable via `30-fsp-quest-create-after-profile-complete.json`'s
     existing eval harness, which runs with `soul: ""`. `B_engine.md`'s Step 4 reaches the
     hosted app too — its First Session section is horcrux-injected per-turn, not part of the
     static `SOUL.chat.md` prefix. Confirmed via `compose-soul.mjs` diffing
     `platform/horcruxes/first-session.md`, not just the two SOUL builds. Local gate green,
     `validate-soul` clean. **What this doesn't prove:** whether the prompt change actually moves
     the ~1-in-3 live failure rate — that needs a real Gemini run, deliberately left for K1's own
     live pass rather than run here.
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
