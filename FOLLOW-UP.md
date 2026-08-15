# Follow-up — coach-chat (Aug 2026)

The single consolidated list of coach-chat follow-up work not yet done, so it's readable on its
own without reconstructing plans from git history. Items 1-10 are deferred from the prompt-
architecture/SOUL-split/skeleton-trim redesign (PRs #263, #264, #266, issue #265, ADR 0021);
items 11+ are from the closing-turn reliability work (PR #287 and after).

## 1. Live-repo terminal-mode deletion (tracked)

**Issue:** https://github.com/sibling-shipyard/coach-phelps-hq/issues/265

`coach-skanda` and `coach-akash` still carry `propagated/SOUL.md`, `propagated/docs/`,
`.claude/`, root `CLAUDE.md`, and `engine/claude/` — the terminal/BYO-Claude-Code coaching path,
retired from the `coach-skeleton` carve template (ADR 0021) but deliberately **not** deleted
from the two live repos yet, since coach-chat (web/iOS) is still stabilizing and terminal mode
is the fallback until it's confirmed as the athletes' only real coaching path. Action the linked
issue once that's true.

## 2. Conversation compaction / summarization

`MAX_HISTORY_MESSAGES = 40` (`ui/api/coach-chat.ts`) is a hard window, not real compaction. Once
real conversation-length usage data exists, consider Anthropic's recommended pattern instead:
summarize what's trimmed rather than dropping it outright, so a long conversation doesn't lose
context it actually needed. This needs either an extra LLM call or persistent-summary
bookkeeping — a real design decision, not a config tweak, which is why it wasn't done in this
pass.

## 3. Judge-model persona/voice scoring in the eval harness

`ui/scripts/eval-coach-chat.ts` only checks the *objective* rubric (schema validity, no
fabricated saves, write-allowlist, session_closed correctness). Voice/persona match to SOUL.md
isn't automated — that needs a second model call per transcript (a judge model scoring the
reply), which is a real added cost per eval run. Worth doing once the athlete wants to weigh in
on which judge model(s) to use and whether the added cost is worth it.

## 4. More golden transcripts

The harness ships 7 transcripts (one per scenario type: greeting, ordinary, close happy-path,
close missing-info, quest completion, injury flag, false-positive close signal) — enough to
exercise every code branch in `askGemini`/`resolveFileUpdate`, short of the original 15-25 target
from the first eval plan. More are cheap to add once real usage data shows which scenarios are
actually worth extra coverage.

## 5. CI wiring for the eval harness

`npm run eval:coach-chat` needs a live `GEMINI_API_KEY` and hits the real API per run — it stays
manual for now, not a GitHub Actions gate. Worth reconsidering once cost/rate-limit headroom is
less of a concern (i.e., once billing is on, see #6).

## 6. ~~Enable Cloud Billing on the Gemini project~~ — done, 2026-08-06

Billing is live (Paid 1, $250 tier cap, Tier 1 confirmed on the AI Studio Rate Limit dashboard:
1,000 RPM / 2,000,000 TPM / 10,000 RPD on 3.6 Flash). Every code-side fix in this redesign
(caching order, history cap, few-shot examples, SOUL bundling) was already shipped ahead of this,
so nothing's left blocking real testing. See `docs/eng-docs/llm-provider-current.md`'s Next Steps
for the full numbers.

## 7. `roadmap.md` / `archive/*` files

Confirmed untouched by the web/iOS coach-chat path. Now that terminal mode is fully retired from
new carves (ADR 0021), these may be fully dead too — but their origin/writer wasn't traced the
way the terminal-mode files were, so don't fold them into a delete pass unverified. Grep for
where they're written before assuming they're safe to remove.

## 8. `docs/ref-docs/` (5 files) purpose changed

These used to feed `propagated/docs/` at carve time (per the old ADR 0011 copy map) — that
propagation is retired (ADR 0021), so `docs/ref-docs/` currently has no consumer in the carve
path. Not deleted in this pass since it wasn't explicitly in scope and might still be referenced
elsewhere (not fully audited) — worth a grep + decision before removing.

## 9. Full SOUL A/B/C re-layering

The three-layer split (`platform/soul/A_identity.md`/`B_engine.md`/`C_athlete.md`) is unchanged —
this redesign fixed *where* SOUL is read from (HQ bundle vs. athlete repo fetch), not how it's
internally organized. Layer B in particular mixes persona-adjacent and pure-mechanics content; a
deeper re-layer is possible later but wasn't needed to fix the actual waste (re-fetching a
constant over the network every turn).

## 10. Pre-existing gaps, unrelated to this redesign

Flagged in `docs/eng-docs/coach-chat-flow.md`'s own "Deferred" section already: no streaming
responses, dead `EmptyChatPane` code, day-number/season-reset semantics (issue #179). Untouched
by this pass.

---

## From `ASYNC-CLOSE-PLAN.md` (folded in here, file removed)

## 11. Background-finish redesign for closing turns ("async close")

Originally investigated as a fix for closes timing out outright in production — root-caused (PR
#283) to Gemini's `generateContent` having no retry on a 45-64k-token prompt. That acute problem
is already solved (confirmed Vercel Fluid Compute is enabled, raising the real ceiling to 300s,
comfortably above the worst-case retry chain) — **this is not fixing anything currently broken.**

Still worth doing eventually, for reasons unrelated to hitting a duration ceiling: a background
"got it, wrapping up..." ack would feel much better than the current spinner (multiple seconds to
over a minute in a bad case); it removes dependence on a specific Vercel plan's duration ceiling
entirely rather than just raising it; and it decouples the request lifecycle from Gemini's actual
latency variance, which isn't fully in our control. Full three-state-response/polling design
(`closed: "pending"`, `waitUntil`, client poll loops on both platforms) is in git history
(`ASYNC-CLOSE-PLAN.md` as of PR #287) — pick this up whenever it's worth the engineering time
relative to other priorities.

---

## From coach-chat reliability testing, 2026-08-14/15 (PR #287)

## 12. Gemini reliability gap — still open, no known code fix

Confirmed via extensive live testing against a real athlete repo, on the actual production model
(not just an exploratory pin): Gemini can claim in `reasoning` that it's saving specific content
while leaving `file_updates`/`coach_note` both empty, even after PR #287's retry-on-mismatch
safety net fires. Separately, it was observed producing a degenerate repetition loop inside the
`title` field (tens of thousands of characters of the same few words repeated), burning its whole
output-token budget before reaching the fields that matter, once badly enough to break JSON
validity outright. Not something more prompt/schema tweaking alone has fixed so far — see
`docs/eng-docs/coach-chat-design-history.md`'s 2026-08-14/15 entry for the full account.

Model options ruled out while chasing this (all confirmed directly against the API, not assumed):
- `gemini-2.5-flash` / `gemini-2.5-pro` — both 404 "no longer available to new users," despite
  showing real quota in AI Studio's Rate Limit dashboard (that page shows tier limits, not actual
  access eligibility).
- `gemini-pro-latest` — accessible, but consistently exceeded the app's 45s
  `GEMINI_GENERATE_TIMEOUT_MS` on a real closing-turn-sized prompt. Would need a larger timeout to
  even test properly, its own tradeoff (slower closes for everyone, closer to Vercel's ceiling).
- `gemini-3.7-flash` (pinned) — same repetition-loop instability as `gemini-flash-latest`, so
  pinning away from the moving "-latest" alias didn't isolate or fix anything.

A follow-on branch (`coach-chat-reliability-debug`) is testing whether stripping the closing-turn
ask down to the smallest possible thing (just `coach_note`, nothing else) is more reliable than
the current full-featured ask — no conclusions yet; this file will be updated once there's a
result worth recording.

## 13. Close-trace / honesty-guard cross-reference (P2, deferred from #287's re-review)

The zero-file_updates-and-no-coach_note warning and `hasUnsavedContentMismatch`'s retry/honesty
guard are two independently-computed diagnostics with no shared correlation - they check
overlapping but not identical conditions (one post-drop/post-resolve, one on the raw model
output), so they can disagree with nothing in the logs saying they're describing the same event.
Not a data-loss risk, just an observability gap worth closing properly (e.g. thread a shared flag
through both) rather than patching quickly under time pressure.
