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

The harness ships a small set of transcripts (greeting, ordinary, close happy-path, false-
positive close signal, coach-note-only-close) - enough to exercise the main branches, short of
the original 15-25 target from the first eval plan. More are cheap to add once real usage data
shows which scenarios are actually worth extra coverage.

## 4. CI wiring for the eval harness

`npm run eval:coach-chat` needs a live `GEMINI_API_KEY` and hits the real API per run - it stays
manual for now, not a GitHub Actions gate. Worth reconsidering once cost/rate-limit headroom is
less of a concern.

## 5. Pre-existing gaps in coach-chat-flow.md's own "Deferred" section

No streaming responses, dead `EmptyChatPane` code, day-number/season-reset semantics
(issue #179). Untouched by any recent pass.

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

## 7. Gemini reliability gap — promising lead, not yet confirmed durable

The full-featured closing-turn ask (checklist gate, `file_updates`, retry-on-mismatch safety net,
per PR #287) was found unreliable via extensive live testing: Gemini could claim in `reasoning`
that it saved specific content while leaving the actual structured fields empty, and once
produced a degenerate repetition loop inside `title` that broke JSON validity outright. See
`docs/eng-docs/coach-chat-design-history.md`'s 2026-08-14/15 entry for the full account.

A follow-on branch (`coach-chat-reliability-debug`) stripped the closing-turn ask down in stages -
removing the checklist/`file_updates`/retry machinery, then `title`, then `reasoning` itself
(theory: `reasoning` was acting as a release valve, letting the model narrate its intent without
transcribing it into the real field). With the ask down to just `coach_note` + `session_closed`
(+ required `reply`), saves became reliable across every scenario tested: 6/6 manual live tests
(concrete facts, soft/reflective content with no hard facts - previously the least reliable case -
bare "wrap" with nothing said, multi-fact conversations, answered/unanswered clarifying
questions) and 4/5 on the eval harness (the one failure was a transient Gemini 503, not a code
issue).

**Not yet decided:** whether this generalizes beyond the tested scenarios, and if so, how (or
whether) to build back up from this minimal baseline - the original file_updates/checklist
mechanism existed for real reasons (state.md injury flags, challenge_v2.json quest tracking,
sleep_log.json) that a coach_note-only design doesn't cover at all. More testing needed before
committing to this direction for real.

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

## 9. Close-trace / honesty-guard cross-reference (P2, deferred from #287's re-review)

Applies to the full-featured (pre-strip-down) design: the zero-file_updates-and-no-coach_note
warning and `hasUnsavedContentMismatch`'s retry/honesty guard were two independently-computed
diagnostics with no shared correlation - they check overlapping but not identical conditions, so
they could disagree with nothing in the logs saying they're describing the same event. Not a
data-loss risk, just an observability gap. Only relevant if the full-featured retry/honesty-guard
mechanism comes back in some form - moot if the stripped-down design (item 7) is kept instead.
