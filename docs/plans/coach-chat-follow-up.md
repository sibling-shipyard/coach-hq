# Coach chat — follow-up (not yet done)

Consolidated from `FOLLOW-UP.md` (root), `coach-chat-closing-followup.md`, and
`ASYNC-CLOSE-PLAN.md` — those three are removed, this is the one place to look for open
coach-chat work. Only items not yet done are here; anything already shipped is history now (see
`docs/eng-docs/coach-chat-design-history.md`), and anything not coach-chat-specific was dropped
(tracked on the org board instead, not duplicated here).

## 1. Conversation compaction / summarization

`MAX_HISTORY_MESSAGES = 40` (`ui/api/coach-chat.ts`) is a hard window, not real compaction. Once
real conversation-length usage data exists, consider Anthropic's recommended pattern instead:
summarize what's trimmed rather than dropping it outright, so a long conversation doesn't lose
context it actually needed. This needs either an extra LLM call or persistent-summary
bookkeeping — a real design decision, not a config tweak.

## 2. Judge-model persona/voice scoring in the eval harness

`ui/scripts/eval-coach-chat.ts` only checks the *objective* rubric (schema validity, no
fabricated saves, session_closed correctness). Voice/persona match to SOUL.md isn't automated -
that needs a second model call per transcript (a judge model scoring the reply), a real added
cost per eval run. Worth doing once the athlete wants to weigh in on which judge model(s) to use
and whether the added cost is worth it.

## 3. More golden transcripts

The harness now ships 15 transcripts (greeting, ordinary, close happy-path, false-positive close
signal, coach-note-only-close, plus one per action field added since: quest_event, injury_event,
profile_update, template_edit x2, session_plan, week_plan, session_reconcile, plan_edit x2) - at
the low end of the original 15-25 target. More are cheap to add once real usage data shows which
scenarios are actually worth extra coverage.

## 4. CI wiring for the eval harness

`npm run eval:coach-chat` needs a live `GEMINI_API_KEY` and hits the real API per run - it stays
manual for now, not a GitHub Actions gate. Worth reconsidering once cost/rate-limit headroom is
less of a concern.

## 5. Pre-existing gaps in coach-chat-daily.md's own "Deferred" section

No streaming responses, dead `EmptyChatPane` code. Day-number/season-reset semantics (issue #179)
is no longer accurately described as "untouched" - it was fixed by ADR 0018, then regressed by
the ledger split for migrated repos on a different code path; see
`docs/plans/coach-chat-open-items.md`'s day-count-badge entry for the current, verified state.

## 6. Background-finish redesign for closing turns ("async close")

Originally investigated as a fix for closes timing out outright in production - root-caused (PR
#283) to Gemini's `generateContent` having no retry on a 45-64k-token prompt. That acute problem
is already solved (confirmed Vercel Fluid Compute is enabled, raising the real ceiling to 300s,
comfortably above the worst-case retry chain) - **this is not fixing anything currently broken.**

Still worth doing eventually, for reasons unrelated to hitting a duration ceiling: a background
"got it, wrapping up..." ack would feel much better than the current spinner (multiple seconds to
over a minute in a bad case); it removes dependence on a specific Vercel plan's duration ceiling
entirely rather than just raising it; and it decouples the request lifecycle from Gemini's actual
latency variance, which isn't fully in our control. Full three-state-response/polling design
(`closed: "pending"`, `waitUntil`, client poll loops on both platforms) was drafted in
`ASYNC-CLOSE-PLAN.md` as of PR #287 - see git history for the full spec if this gets picked up.
Pick this up whenever it's worth the engineering time relative to other priorities.

The redesign stack independently re-raised this same idea for a different reason (write/commit
latency after Parts 1-3's split-file writes, not just Gemini call latency) - see
`docs/plans/coach-chat-open-items.md`'s "Async closing" entry for the two open product questions
that need answering before either version gets built. One design, two motivations - don't build
twice.

## 8. Model options ruled out while chasing the reliability gap (reference)

Confirmed directly against the API, not assumed - worth knowing before re-trying any of these:
- `gemini-2.5-flash` / `gemini-2.5-pro` - both 404 "no longer available to new users," despite
  showing real quota in AI Studio's Rate Limit dashboard (that page shows tier limits, not actual
  access eligibility).
- `gemini-pro-latest` - accessible, but consistently exceeded the app's 45s
  `GEMINI_GENERATE_TIMEOUT_MS` on a real closing-turn-sized prompt. Would need a larger timeout to
  even test properly, its own tradeoff (slower closes for everyone, closer to Vercel's ceiling).
- `gemini-3.7-flash` (pinned) - same repetition-loop instability as `gemini-flash-latest`, so
  pinning away from the moving "-latest" alias didn't isolate or fix anything on its own.
