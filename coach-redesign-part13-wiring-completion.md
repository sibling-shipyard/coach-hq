# Part 13 — finish wiring the redesign in (supersedes Part 5's stub)

Stacked on Part 12. Branch off Part 12's tip once it exists.

## Context

`coach-redesign-part5-wiring-plan.md` was written as a stub before the redesign existed — "this
becomes the real plan once Parts 1-4 are implemented." They are now (#435-446, plus Parts 12).
This plan replaces that stub with what's actually still true, checked against the current file
state, not assumed from the old doc.

**Two categories are explicitly excluded from this PR, per your standing instruction** ("forget
about migration and coach skeleton population, I'll do it later") — confirmed still real and still
broken, but not touched here:

- `platform/scripts/carve-skeleton.mjs` — still scaffolds only `state.md`/`coach_notes.md`/
  `challenge_v2.json` for a fresh athlete repo (lines 464-480); no template for any of the new
  files exists at all. The single biggest concrete gap found in this whole review — but it's
  skeleton population, yours.
- `platform/scripts/provision-user.sh` — its legacy-repo migration overlay (lines 142-147,
  278-315, 399) still copies whole old-shape directories verbatim, producing the old layout in a
  "migrated" repo. Also yours, same instruction.

## Part A — fix real, live, user-facing staleness (not documentation-only)

1. **`ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift`'s `readCoachDayAnchorDate()`
   (lines 211-219)** reads `user_data/ledger/challenge_v2.json` and decodes it into
   `ChallengeV2Summary` for the day-count header label — it's **actively called** from
   `CoachChatView.swift`. Once an athlete repo migrates to the split ledger, this reads a file that
   no longer exists — a live break, not a docs issue. Fix: read `profile.json.coach_since`
   directly instead (that's already the correct source of truth per ADR 0018 and the v5.11 fix
   that made `coach_since` stamping actually work). Also fix `UserFacingError.swift:66`'s
   `raw.contains("challenge_v2")` string match (silently stops matching once migrated, breaking
   whatever error classification depends on it), and update the now-stale comments at
   `CoachSetupState.swift:48`, `OnboardingHints.swift:36`, `CoachChatView.swift:39,43,488,662`,
   `CoachChatPreviewData.swift:8` while in this area.

   **This is iOS Builder's territory per `AGENTS.md`'s routing table.** Flag explicitly in the PR
   description that this slice needs iOS Builder's review even though a Tech Lead-directed agent
   is making the mechanical fix — don't let it merge as if it were reviewed by the right role.

2. **`README.md` (repo root)** — quickstart (lines 17, 27, 30: uploading/reading `state.md`,
   listing `state.md`/`challenge_v2.json`/`coach_notes.md` as the coach-owned files) and the file
   reference table (lines 39-41) are entirely old-schema. Rewrite to describe the real onboarding
   flow and the real coach-owned files (`profile.json`, `memory.json`, `injuries.json`,
   `coach_log.json`, `seasons.json`, `quests.json`, `progress.json`, `progressions.json`) —
   matching the accuracy bar `docs/eng-docs/coach-chat-flow.md` already hit when #446 rewrote it.

3. **`docs/ref-docs/current-week-contract.md`, `season-close.md`, `milestone-schema.md`** — all
   three confirmed still cite the old files (`current-week-contract.md:13,17,19,170`;
   `season-close.md:13`; `milestone-schema.md:7`). Update each to the current schema — these are
   reference docs other code and SOUL point to, so their accuracy isn't just cosmetic.

## Part B — async closing (design decision needed — flag, don't decide unilaterally)

Carried over from the original stub, still real, still not built: the athlete's HTTP request
blocks on the full closing pipeline (the Gemini call, every write, the GitHub commit) — worse when
an action field triggers a second Gemini call (`template_edit`'s content generation,
`generateInitialTemplates`). Proposed shape: keep the reply synchronous (one Gemini call, same as
today), detach the actual write/commit/retry work to run via Vercel's `waitUntil` after the
response returns. The pipeline's existing atomic-commit + upsert-by-id discipline (consistent
throughout Parts 1-3 onward) is a good sign this is safely retryable, not a rewrite.

**Two open questions — get an explicit answer before building, this is not yours to decide alone:**
- `waitUntil`'s actual time cap vs. worst-case turn latency (a `template_edit` chain that triggers
  a second Gemini call) — confirm the cap is genuinely sufficient before committing to this shape.
- What happens when a background write still fails after every retry — silent forever (the athlete
  never learns a session didn't save), or does it need to surface next time they open the app (a
  banner, a re-sync prompt)? Real product decision, not an implementation detail to improvise.

Given both are open, this may be worth its own follow-up plan/PR once answered, rather than
bundling into this one — flag as a split candidate, don't let it block Part A.

**`BACKLOG.md` maintenance:** add a new entry for async closing — the two open questions, the
proposed `waitUntil` shape, why it's not built yet. This is exactly the "found while rebuilding
coach-chat, don't let it get silently forgotten" category the doc exists for.

## Part C — explicitly out of scope, noted not silently dropped

- `plan_edit` can't touch `week.guardrails[]`; free-form template/session edits beyond structured
  skip-by-number. Both real, both unrelated feature gaps (workout-editing capability, not
  wiring/efficiency) — leave filed, don't build here.
- Regenerating templates for existing athletes, migration script for workout-backend-wiring's
  schema additions, `carve-skeleton.mjs` regeneration — all migration/backfill territory, yours.

## Verification

- `cd ui && npx tsc --noEmit`, `npm run test` clean.
- Doc-only changes (Part A items 2-3) need no runtime verification beyond confirming the new text
  is accurate against the actual current schemas — same discipline as every SOUL/doc rewrite in
  this stack, don't just trust the old doc's shape.
- iOS change (Part A item 1) needs an Xcode build clean at minimum; ideally a real
  device/simulator smoke test of the day-count label against both a migrated and unmigrated repo.
  Flag for iOS Builder review regardless of who implements it.

## PR

Branch off Part 12's tip. Title something like `core: fix live staleness against the new ledger
schema, log async closing`. Body: the iOS fix (with the explicit iOS-Builder-review flag), the doc
rewrites, the async-closing design questions surfaced for a decision, and confirmation of what's
explicitly excluded and why. Leave open for review.
