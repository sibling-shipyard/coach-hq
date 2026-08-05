# Follow-up — coach-chat redesign (Aug 2026)

What's deferred from the coach-chat prompt-architecture/SOUL-split/skeleton-trim redesign
(PRs #263, #264, #266, issue #265, and ADR 0021), so it's readable on its own without
reconstructing the plan from git history.

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

## 6. Enable Cloud Billing on the Gemini project (pending on the athlete)

Every code-side fix in this redesign (caching order, history cap, few-shot examples, SOUL
bundling) is shipped, but the actual free-tier rate-limit block is still live until Cloud Billing
is turned on. This needs the athlete's own Google Cloud console + Vercel dashboard access —
nothing left here is committable from a PR. See `docs/eng-docs/llm-provider-current.md`'s Next
Steps.

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
