# 0024 — Paid checks run at named gates, not on every PR

- **Status:** Accepted · 2026-08-16 · Tech Lead
- **Area:** cross-cutting
- **Context:** `npm run eval:coach-chat` (`ui/scripts/eval-coach-chat.ts`) calls the live Gemini API
  once per transcript, with no way to narrow the run: it reads every JSON in
  `ui/api/coach-chat/_tests/coach-chat-eval/transcripts/` — five today, so five paid calls — and
  the only environment it reads is `GEMINI_API_KEY`, no argv. Gemini has been returning 503/504
  heavily and non-deterministically, hitting different transcripts each run, so a red run usually
  means retry — double the cost, and no information about the change. It was run 4+ times in one
  session across four stacked SOUL PRs, mostly on PRs where it could not have caught anything. The
  decisive part: the eval checks *structure* — valid schema, no fabricated save language, correct
  fields. Its own header says judging voice would cost a second model call per transcript and so
  "stays a manual/human read for now." The whole risk of the SOUL v5.8 trim was voice. We paid for
  a check that explicitly does not cover the thing being risked.
- **Decision:** A check that costs money per run happens at a **named gate**, and the PR states the
  gate. For `eval:coach-chat` the gates are: once at the **end of a stacked series**, not per PR
  inside it; and any PR touching **prompt construction, the response schema, the model, or the
  eval harness/fixtures** — where it can actually fail. A PR that skips a paid check says so in
  its test plan, with the reason: never silently dropped, never implied to have passed. If the
  gate run at the end of a series fails, bisect back across the series.
- **Why:** Cost is only half of it. A check run reflexively on diffs it cannot fail on teaches
  people to skim past it, and a flaky upstream compounds that — most reds are infrastructure, so
  the signal decays into noise. Running it only where it can catch something keeps a red meaningful.
- **Rejected:** Run it on every PR for safety → pays per PR for a check that cannot fail on most
  of them, and normalises ignoring red. Drop it entirely → it does catch real structural
  regressions at the gates where it applies. Mock the API → then it no longer tests the one thing
  it exists to test, live model behaviour. Move it to CI only → same money, less control, and it
  fires on every push.

<!-- The filter this exists to enforce: before running a paid check, name what it could catch in
     *this* diff. If the answer is nothing, this is not the gate. -->
