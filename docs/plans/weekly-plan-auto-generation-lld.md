# Weekly plan auto-generation (LLD)

> Status: Plan · Owner: Tech Lead · Created: 2026-09-16 · See HLD: `weekly-plan-auto-generation.md`

## PR stack

| PR | outcome | final base | files | result |
|---|---|---|---|---|
| 1 | weekday histogram in `athlete_insights.json` | main | `engine/scripts/generate-athlete-insights.mjs`, new `kdb/decisions/00XX-athlete-insights-weekday-pattern.md` | schema has real pattern data, verified against a real repo |
| 2 | shared trigger/pending-flag plumbing, chat-turn wired | PR1 | new `engine/lib/weeklyPlanAuto.mts`, `ui/api/coach-chat/_lib/buildTurnWrites.ts` | chat-turn trigger sets/reads the pending flag, no LLM call yet |
| 3 | the LLM call + validated commit + retry/give-up | PR2 | `ui/api/coach-chat/_lib/coachWeekPlanAuto.ts` (new), `ui/api/_lib/sentry.ts` | a stale placeholder week actually gets filled, chat-turn path only |
| 4 | app-open trigger | PR3 | `ui/api/coach-chat-context.ts` | app-open alone can produce a real plan, no chat needed |
| 5 | Coach awareness of a fresh auto-plan | PR4 | `ui/api/coach-chat/_lib/decide/coachContext.ts` | Coach mentions the plan once, goes quiet after an athlete edit |

Each PR branches off the prior one's branch (stacked-PR convention, `AGENTS.md`). PRs 1-2 and 3-4
have disjoint-enough files to review independently even though they stack. PR5 is the last
coach-hq PR - see "Final step" below for the one thing that happens after it merges.

## PR 1 - weekday histogram, real bugs fixed first

**Three real bugs found auditing `engine/scripts/generate-athlete-insights.mjs`, checked against
Akash's and Skanda's real repos, fixed in this PR before any new field is added** (a new field
built on top of a buggy loader just inherits the bug):

1. **Sport-name collisions.** `sportKey()` only splits camelCase and lowercases - it has no
   synonym table. Skanda's real data has both `"Swim"` (7 sessions) and `"Swimming"` (3 sessions)
   as separate keys, and both `"Hike"` (18) and `"Hiking"` (2) - one real sport's stats silently
   split across two buckets. Fix: a small canonicalization map (`swimming` -> `swim`, `hiking` ->
   `hike`, checked against both real repos' actual `sport_type` values) applied before `sportKey`
   groups sessions.
2. **Timezone-naive "today".** `today = now.toISOString().slice(0, 10)` takes UTC's calendar day,
   but every session's own `date` comes from `start_date_local` - the athlete's local day. For an
   athlete ahead of UTC, a very recent session can compute a negative `age` and get silently
   dropped by the `age < 0` filter, and every day-boundary (`sessions_per_week_recent_4w`, the new
   16-week window below) shifts by a day near midnight. Fix: derive `today` from `profile.timezone`
   the way `coachDay.ts`'s `todayDateString` already does elsewhere - this script just never
   adopted it.
3. **`elapsed_time` vs `moving_time` inconsistency.** The existing `duration_buckets` buckets on
   `elapsed_time` (wall-clock, includes pauses between games/sets). The new per-weekday duration
   field below is more useful as active time. Fix: switch both the existing buckets and the new
   field to `moving_time` consistently, rather than leaving them silently different.

**Schema addition**, additive only beyond the bug fixes:
```json
"sports": {
  "badminton": {
    ...existing fields unchanged (now on moving_time, bug 3)...,
    "weekday_pattern_16w": {
      "monday": { "count": 11, "avg_duration_min": 152, "avg_start_hour": 16.5 },
      "tuesday": { "count": 2, "avg_duration_min": 90, "avg_start_hour": 7.0 }
    },
    "typical_days_16w": ["monday", "thursday"],
    "paired_disciplines_16w": { "weight_training": 0.28 }
  }
},
"active_day_rate_16w": { "monday": 0.38, "tuesday": 0.62 }
```
- `weekday_pattern_16w`: per local weekday, over the last 16 weeks - `count`, `avg_duration_min`
  (`moving_time`, bug 3), `avg_start_hour` (local hour, fractional). Confirmed on real data this
  varies meaningfully within a sport by weekday - Akash's Monday/Thursday badminton is a 150min
  evening match, his other weekdays are an 85min morning practice. It also needs the athlete's
  own timezone (bug 2) to bucket correctly at all.
- `typical_days_16w`: unchanged - days covering >= 60% of the 16-week total, capped at 3.
- `paired_disciplines_16w`: fraction of this discipline's active days where >=1 other discipline
  also has a session that same local day. Confirmed real on both repos (Akash 28%, mostly
  badminton + weight training same day; Skanda 11%) - tells the prompt a second same-day session
  is plausible, not overload.
- `active_day_rate_16w`: sport-agnostic, top-level (not per-sport) - fraction of the last 16 weeks
  where any sport has a session, per weekday. Confirmed real on Skanda (Monday 37.5% active vs
  Sunday 81%) even though it's invisible on Akash's near-daily data alone.
- Bump `schema_version` in the file's own header; no consumer reads that field defensively today
  (confirmed: only `generate-athlete-insights.mjs` writes it), so no migration needed.

**New ADR** (`kdb/decisions/`, next free number): the first ADR to govern
`athlete_insights.json`'s schema at all. Narrow scope, records the 16-week choice and why -
patterns drift, confirmed against real data where a longer window would have hidden the split.

**Tests:** one unit test per bug fix - a fixture with `Swim`/`Swimming` merges to one bucket, an
activity timestamped just after local midnight but before UTC midnight is not dropped, duration
bucketing matches `moving_time` not `elapsed_time`. Plus a fixture spanning >16 weeks asserting
the histogram/typical-days/pairing/active-day-rate math is right. Fixtures are trimmed copies of
Akash's and Skanda's real distributions, both repos, not just one, so the tests catch real-shaped
bugs, not synthetic ones.

## PR 2 - shared trigger + pending flag (chat-turn only)

**New `engine/lib/weeklyPlanAuto.mts`**, pure functions mirroring `currentWeekRollover.mts`:
```ts
export function needsAutoPlan(currentWeek: CurrentWeek | undefined): boolean
// true only when currentWeek.status === "placeholder" (rollover already wrote one)
// and weekly_plan_pending is not already set.

export function buildPendingMarker(now: Date): { weekly_plan_pending: true; pending_since: string }
```

**`current_week.json` additions:** `weekly_plan_pending?: boolean`, `pending_since?: string`,
`weekly_plan_attempts?: number`, `origin?: "auto" | "athlete"` (origin lands in PR3, declared here
so the schema change is one PR, not two).

**Wire into `buildTurnWrites.ts`'s `rolloverWrite` block:** immediately after the existing placeholder
commit, if `needsAutoPlan` is true, fold `buildPendingMarker`'s fields into the *same*
`optionalWrites` array that write already uses - one commit, placeholder + pending flag together.
No LLM call in this PR; that's PR3. This PR only proves the flag round-trips correctly and blocks a
second chat-turn trigger from double-firing.

**Tests:** unit tests for `needsAutoPlan` (placeholder-with-no-flag -> true, flag-already-set ->
false, real athlete-written week -> false). Integration test on the existing coach-chat test
harness confirming two turns in the same stale week only ever produce one pending-flag write.

## PR 3 - the LLM call, validated commit, retry/give-up

**New `ui/api/coach-chat/_lib/coachWeekPlanAuto.ts`:**
```ts
export function buildWeeklyPlanAutoPrompt(soul: string, context: WeeklyPlanAutoContext): string
export async function generateWeeklyPlanAuto(turn: TurnWrites): Promise<void>
```
Called via `waitUntil(generateWeeklyPlanAuto(turn))` from the same `rolloverWrite` block PR2 wired,
right after that commit lands - mirrors `sentry.ts`'s existing `waitUntil` usage for telemetry
flush, not FSP's blocking `await`.

**No separate prompt-file module.** Checked whether this needs its own `coachPromptText.ts`-style
file - it doesn't. `coach-message`'s proactive call is the only other non-conversational,
single-shot prompt in the codebase, and its `buildProactivePrompt` is a ~20-line function
colocated in `coachMessage.ts` itself, not a separate file. `buildWeeklyPlanAutoPrompt` follows
the same shape, colocated in this PR's one new file - a dedicated prompt-file module is only
worth it for `coachPromptText.ts` because that prompt is large and branches per `TurnMode`; this
one doesn't.

**Prompt inputs:** `memory.json`, `profile.json` (sports played), `athlete_insights.json`'s
weekday/pairing/active-day data, current active templates, **and the active season's `main_quest`
plus `quests[]`** - the athlete's explicit ask. Without this the plan only reflects what the
athlete usually does, not what they're currently training toward - a goal like "build a 5K base"
should bias which sessions get planned, not just which weekday. Reuse
`activeTemplatesContext`/`activeWeekSessionsContext` and `renderQuestContext` from
`coachPromptText.ts`/`coachContext.ts`, consumed by `requestCoachReply.ts`/`turnRequest.ts` - the same helpers the real chat-driven kickoff prompt
already builds `questContext` from, so the auto prompt sees identical goal/quest state.
Caching: see "Prompt caching (PR3)" below - `buildWeeklyPlanAutoPrompt` returns a stable prefix and a
per-athlete tail from day one.

**LLM call:** `selectLlmAdapter()`, generic seam, no coach-chat-specific adapter logic. On failure,
`captureLlmFailure(err, { model, upstreamStatus, turnMode: "weekly_plan_auto", athleteMessage: "" })`
- the third real `turnMode` value alongside `proactive_message` and (nominally) `template_adjust`.

**Retry/give-up**, same shape as `FIRST_SESSION_BENCHMARK_MAX_ATTEMPTS`:
- `weekly_plan_attempts` increments on each failure, written in its own small commit. The LLM call
  already failed, so there's no plan content to bundle it with.
- At 3, give up: leave the placeholder, clear `weekly_plan_pending`, `captureServerMessage` with
  `outcome: "gave_up"` tag - matches FSP's exhaustion pattern exactly.
- On success: validate the LLM's output through `assertCurrentWeekCommitReady`, commit via
  `applyFullWeekKickoff` (unchanged - this is the same function a real chat-driven kickoff calls),
  set `origin: "auto"`, clear `weekly_plan_pending`/`weekly_plan_attempts`, all one atomic commit.

**Doc nit folded into this PR** (touching `sentry.ts`'s `TurnMode` doc comment anyway): fix its
stale claim that `template_adjust` is a live `generateContent` call site - it was removed, per
`coachWorkoutFiles.ts`'s own header comment. Also fix its claim that `activity_sync` is ever
constructed as a `TurnMode` - it isn't; `activitySyncTurn.ts` calls `generateProactiveBody`, not
`askLlm`.

**Tests:** mocked-adapter unit test for the success path (asserts the commit matches
`applyFullWeekKickoff`'s normal shape) and the give-up path (3 failures -> placeholder intact,
`gave_up` captured). Manual live test on a scratch/test athlete repo per the standing rule
(`feedback_verify-coach-chat-on-scratch-branch`) before calling this PR done - real LLM call, real
commit, read back and confirm the plan reflects that repo's actual weekday pattern.

## Prompt caching (PR3)

Gate: `docs/plans/openrouter-caching.md` (chat) must have shipped and shown cached tokens in Sentry.
The prompt shape below costs nothing to build in, so PR3 builds it either way.

**Shape.** `buildWeeklyPlanAutoPrompt` returns `{ prefix, tail }`, not one string.
- `prefix` (identical for every athlete): soul, fixed planning instructions, the output contract,
  few-shot examples. Nothing dated, nothing athlete-specific.
- `tail` (per athlete, per week): week dates, `memory.json`, `profile.json`, the insights
  histogram, active templates, `renderQuestContext` output.
- The call passes `cachePrefix: prefix` and puts `tail` in the user turn, exactly as
  `docs/plans/openrouter-caching-coach-message.md` does for coach-message. The OpenRouter adapter
  (chat PR) turns that into a marked block, so this PR needs no adapter change.

**What I verified, and what I did not.**
- Verified: the call is single-shot through `selectLlmAdapter()`, once per athlete per stale week,
  plus up to 3 failed attempts (this doc, PR3). ROADMAP lists 4 live athletes, holding at 5.
- Verified: a retry is fired by the next trigger (app open or chat turn), not by a timer, so
  attempts are not seconds apart.
- Not verified: whether one athlete's call warms the cache for another's. The prefix is shared,
  the tail is not, which is the varying-tail shape the bench measured. Volume is about one call
  per athlete per week, so the saving is small either way. I would not add code beyond the shape
  above to chase it.
- Not verified: `geminiAdapter.ts:169` and `:179` make any `cachePrefix` trigger the explicit soul
  cache and a retry on the direct-Gemini path. PR3 already owns its retry, so check that the two
  do not stack before merge.

**Tests.**
1. Unit: the same `prefix` string is produced for two different athlete contexts. This is the test
   that stops athlete data leaking into the cached part.
2. Unit: mocked adapter receives `cachePrefix` equal to `prefix`, tail in the user turn.
3. Live, two scratch athletes: run one, then the other straight after, then one again after a gap.
   Read `gen_ai.usage.input_tokens.cached` and `llm.cache_marker` on the `weekly_plan_auto` spans.
   Report zeros as zeros.
4. Sentry: these spans are `turnMode: "weekly_plan_auto"`. Add how to read their cache hit rate to
   the `sentry-runbook.md` Coverage boundary when PR3 lands.

## PR 4 - app-open trigger

**`ui/api/coach-chat-context.ts`:** after `loadCoachContext` resolves, call the same
`needsAutoPlan`/pending-flag/`waitUntil(generateWeeklyPlanAuto(...))` sequence PR2/PR3 built,
reusing them rather than duplicating - this endpoint already has `auth`/`repo_full_name` in scope.
The GET response itself is unaffected (still returns `context` immediately; the plan generation
runs after, via `waitUntil`, same as it does from a chat turn).

No client change on web or iOS - both already call this endpoint once per session
(`prefetchCoachContext.ts`, `MainTabView.swift`'s `.task`).

**Tests:** endpoint test asserting a stale placeholder week triggers the pending-flag commit on a
GET call with no prior chat activity; a second concurrent GET (simulating both platforms warming up
at once, or a retry) does not double-commit.

## PR 5 - Coach awareness

**`ui/api/coach-chat/_lib/decide/coachContext.ts`:** small new context step, same shape as the
today's-notes step. When `current_week.json.origin === "auto"` and this is the first ordinary turn
to read it in that state, add a `week_plan_just_generated: true` marker to turn context so the
system prompt can surface it once. A real `week_update` edit already sets `origin` back to
`"athlete"` in the same commit, so this is naturally one-shot - no separate "seen" flag needed.

**Tests:** context-builder unit test - `origin: "auto"` produces the marker, `origin: "athlete"`
does not, and an edit turn flips it correctly for the next turn.

## Final step - carve skeleton, propagate to athlete repos (not a coach-hq PR)

This is an operator action, not a coach-hq pull request - nothing in this repo needs reviewing
for it, so it isn't numbered into the PR stack above. It's still part of finishing this plan, run
once, right after PR5 merges.

**Why last, not per-PR:** checked `.coach-engine-version` on `coach-skeleton` and all 5 real
athlete repos while planning this stack. All 6 are already pinned to the same stale SHA, 6 real
`engine/`-affecting commits behind `main` (the ADR 0049 rollover-module extraction among them).
Carving after every PR in this stack would mean 5 separate carves for one logical change. Carving
once after PR5 merges gets the whole stack - histogram, trigger, LLM call, both entry points,
Coach awareness - into `coach-skeleton` and the 5 athlete repos in one pass, on one SHA.

**Step A - carve and push `coach-skeleton`:**
```
node platform/scripts/carve-skeleton.mjs --push
```
Confirm via `--dry-run` first, diffed against a fresh clone of `coach-skeleton` - the same check
used to find the current backlog. The only changes should be this stack's, with no unrelated
drift sneaking in alongside it.

**Step B - propagate to the 5 real athlete repos.** No automated propagation path exists today
(`docs/eng-docs/skeleton-layout.md`: "manual carve refresh until M2/M3 server-side engine") - each
athlete repo needs the same `engine/`-affecting file diff applied and its own
`.coach-engine-version` bumped to the new HQ SHA. Confirm with the athlete before touching any of
the 5 real repos - this reaches outside `coach-hq` into other people's repos, cleanly separate
from a normal PR review.

## Verification (whole stack)

- Every PR: `bash platform/scripts/check.sh --quiet` before first push.
- PR1: unit test against the trimmed real-data fixture.
- PR2-3: chat-turn path proven live on a scratch repo before PR3 merges.
- PR4: app-open path proven live (hit the endpoint directly with curl against a scratch repo,
  confirm the commit lands without any chat interaction).
- PR5: one live conversation on a scratch repo confirming Coach mentions the plan once, then an
  edit turn confirming it goes quiet.
- Final step: `--dry-run` diff against a fresh `coach-skeleton` clone shows only this stack's
  changes; `.coach-engine-version` on `coach-skeleton` and all 5 real athlete repos matches the
  new HQ SHA after propagation.
- `docs/plans/weekly-plan-auto-generation.md` and this file get deleted in PR5, the actual last
  coach-hq PR, per the "plan delete-on-last-PR" rule. Their durable bits fold into the new ADR
  (PR1) and, if the athlete wants ongoing documentation, a short section added to
  `coach-chat-daily.md`. The carve/propagate step happens right after PR5 merges - it has no PR
  of its own to gate the deletion on.
