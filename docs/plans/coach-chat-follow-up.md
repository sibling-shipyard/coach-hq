# Coach chat — follow-up (not yet done)

Consolidated from `FOLLOW-UP.md` (root), `coach-chat-closing-followup.md`, and
`ASYNC-CLOSE-PLAN.md` - those three are removed, this is the one place to look for open
coach-chat work. Only items not yet done are here; anything already shipped is history now (see
`docs/eng-docs/coach-chat-design-history.md`).

Items with an open design/product decision are tracked as issues instead of here, all verified
2026-08-25 as still open (not superseded by later work): compaction (#572, p2), judge-model
persona scoring (#573, p2), async-close redesign (#574, p3), `coach_log.json`
phase_close/week_close folding (#575, p1), coach-chat write support for `main_quest`
floor/weight fields + `progressions.json` `_meta` (#576, p1), `plan_edit` guardrails/free-form
support (#577, p1). Automated test coverage for the context-render chain moved to
`docs/plans/coach-chat-redesign-testing.md`. Nothing else from the prior version of this doc
survives - the day-badge regression it flagged is fixed (`coachChatModel.ts`'s
`challengeDayNumber()` reads `profile.coach_since` directly; the `splitLedgerChallenge.ts`/
`useRepoData` legacy-shape detour it went through is deleted) and the ruled-out-models reference
list is stale history, not actionable.

Items below have no open decision blocking them - they're ready for a worker to pick up directly.

## 1. More golden transcripts

The harness ships 20 transcripts today (greeting, ordinary, close happy-path, false-positive
close signal, coach-note-only-close, plus one per action field: quest_event, injury_event,
profile_update, template_edit x2, session_plan, week_plan, session_reconcile, plan_edit x2,
activity_sync, multi-action-turn, multi-write-close, hallucinated-template,
contradictory-instruction) - within the original 15-25 target. Add more where real usage data
(once it exists) shows a scenario is actually worth extra coverage - don't invent scenarios
speculatively.

## 2. CI wiring for the eval harness

`npm run eval:coach-chat` needs a live `GEMINI_API_KEY` and hits the real API per run - wire it
into a GitHub Actions gate (`.github/workflows/`). Check `kdb/decisions/` (`ADR 0024` - paid
checks run at named gates, not on every PR) for how this repo handles a paid/rate-limited check
before deciding the trigger (a named gate, not every PR).

## 3. Fitness Snapshot cosmetics

`fitnessSnapshotSection()` (`ui/api/coach-chat/_lib/coachContext.ts`) has no design blocker, just
polish:
- "sessions" is hardcoded plural regardless of count (`1 sessions`).
- Sports render in whatever order `Object.entries(insights.sports)` returns (JSON key order),
  not a meaningful order.
- `formatRate()` already handles most rounding reasonably - verify it holds for edge values
  (0, very small fractions) before calling this done.
- No cap on how many sports/lines can render - unbounded growth if an athlete has many sports
  logged.

## 4. `gen/athlete_insights.json` schema-version/freshness check

Every other file `loadCoachContext()` fetches validates a schema version and staleness before
trusting it. `athlete_insights.json` skips that check - same pattern already exists elsewhere in
`coachContext.ts` to copy, not a new design.

## 5. Template regeneration + migration for workout-backend-wiring schema additions

Existing athletes' workout templates were never backfilled with the schema fields
`workout-backend-wiring` added. Needs a migration script - same category as the migration scripts
already in the repo (`engine/scripts/migrate_activity_naming.py`,
`ui/scripts/migrate-coach-memory-part1/2/3.mjs`) - follow that pattern.
