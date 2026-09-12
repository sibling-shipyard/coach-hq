# Coach model provider bench

> Status: Current · Owner: Tech Lead · Verified: 2026-09-06

How direct Gemini, Gemini through OpenRouter, and DeepSeek behave on the **real**
`coach-message` prompt. Measured 2026-09-05 against a live athlete repo, not a fixture.

Read this before quoting a provider number at anyone. Four of the five things below were
measured wrong the first time, in ways that flattered the result.

## Method

`loadProactiveContext` and `buildProactivePrompt` take their file reads as dependencies. Pointing
those at a live athlete repo runs the production projections over real files. Every reply is then
held to production's own `validateGeneratedBody`, so a pass means production would have accepted
it.

Two payload shapes: one activity, and a four-activity catch-up sync.

| | one activity | four activities |
|---|---|---|
| Prompt tokens | 12,295 | 14,444 |
| Shared prefix (soul, instructions, few-shots) | 6,876 | 6,876 |

The earlier contract-probe figure of 6,924 tokens came from a hand-built athlete. Real files are
roughly double that. Any cost estimate derived from the smaller number is low.

## Results

| Arm | Model | Passed | Median | Cost per call |
|---|---|---|---|---|
| OpenRouter | `google/gemini-3.8-flash` via Vertex | 6/6 | 1.9s | $0.0094–$0.0110 |
| Direct Gemini | `gemini-flash-latest` | 1/6 | 19.5s | not billed on this path |
| DeepSeek | `deepseek-v4-flash`, pinned | see below | 2.4–2.7s | $0.0003–$0.0009 |

Direct Gemini's five failures were `503 — high demand`. That is the capacity class #668 cited
when it pinned production to pro. The key used was free tier, which may see worse capacity than a
paid one, so this is suggestive rather than conclusive.

The one direct call that succeeded burned 781 thinking tokens and took 19.5s. OpenRouter returns
0 thinking tokens on the same prompt under `reasoning: {effort: "low"}`.

## Caching — the result that changes plans

Vertex discounts an **exact repeat of the whole prompt**, not a shared prefix. Five calls in
order:

| Call | What changed | Prompt tokens | Cached |
|---|---|---|---|
| 1 | first time seen | 12,226 | 0 |
| 2 | identical repeat | 12,226 | 8,169 |
| 3 | same 6,876-token prefix, new athlete block | 14,374 | **0** |
| 4 | identical repeat of call 1 | 12,226 | 8,169 |
| 5 | identical repeat of call 3 | 14,374 | 12,259 |

Call 3 is the finding. Production sends a different athlete block every time, so it never earns a
discount. A harness that re-sends one prompt will report caching that production never sees.

Several DeepSeek hosts behave the opposite way. Venice, Parasail, NextBit and DeepInfra all
returned 74–99% cache hits **with a varying tail**, which is the vLLM/SGLang prefix-caching
pattern. This is real prefix caching without building a cache ourselves.

## Explicit cache marker (#890)

Same varying-tail method, extended with one question: does OpenRouter's explicit
`cache_control: {type: "ephemeral"}` breakpoint change Vertex's answer, and how does that compare
to DeepSeek's automatic caching? Six real HealthKit activities, one per call, same call sequence
sent to all four arms so DeepSeek carries the same method as Gemini.

Splitting the prompt at the `<athlete_context>` boundary and marking the prefix (5,553 tokens by
Gemini's own count) with `cache_control` produced an immediate, stable discount:

| Call | No marker | Marker | Venice | Parasail |
|---|---|---|---|---|
| 1 | 0% | 48% | 0% | 0% |
| 2 | 0% | 48% | 62% | 0% |
| 3 | 0% | 48% | 62% | 62% |
| 4 | 0% | 48% | 62% | 62% |
| 5 | 0% | 47% | 60% | 60% |
| 6 | 35% | 48% | 62% | 62% |

Cost per call: no marker $0.0087–$0.0090, dropping to $0.0061 only on call 6. Marker: $0.0050–
$0.0053, every call. Venice and Parasail: $0.0009–$0.0018, cheapest once warm.

**The marker earned a discount the unmarked calls never reliably got.** Six identical-prefix,
varying-tail calls with no marker stayed at 0% cached until the sixth. A fresh unmarked call sent
minutes later, after other traffic, read 0% again — that state does not persist. The marked
requests hit ~48% from the very first call and held it.

One open question this run cannot answer: the marked and unmarked requests may key Vertex's cache
differently. A `content` array is a different wire shape than a plain string, even carrying the
same text. That would explain why the unmarked warm-up on call 6 never carried into the marked
arm's first call. Confirming that needs two more runs, each in its own fresh cache window, and is
out of scope here.

DeepSeek needed one prior call to warm, then held 60–62% with no marker at all. That is lower than
the 74–99% the wider provider sweep below found, on a different (proactive, not conversational)
prompt shape.

**Recommendation:** if Gemini stays the model, ship the marker. It is the only path that earns any
discount on the athlete_context turn, since production never repeats a prompt exactly. If DeepSeek
is the target anyway on cost, no marker work is needed there.

Probe script: `ui/scripts/prefix-cache-probe.ts` — throwaway, not wired into any npm script or CI.

## DeepSeek — credible, with one real problem

42 calls across seven ZDR-reachable, structured-output-capable providers.

| Provider | Passed | Median | Cache hits |
|---|---|---|---|
| Venice | 6/6 | 2.4s | 99.1% |
| Parasail | 6/6 | 2.7s | 74.5% |
| NextBit | 5/6 | 2.7s | 74.5% |
| DeepInfra | 3/6 | 2.4s | 74.5% |
| Mancer 2 | 3/6 | 2.5s | 0% |
| DigitalOcean | 2/6 | 20.2s | 0% |
| Phala | 0/6 | — | dead (522/525) |

Recommended allow-list, ordered: `["Venice", "Parasail", "NextBit", "DeepInfra"]`. An ordered
list, never a single pin — a lone provider has no fallback, and two runs died on its upstream 429.

**Schema compliance was 34/34.** The problem is voice: **9 of those 34 replies failed
`validateGeneratedBody`** — five em dashes, four sentence-length violations. That is a 26.5%
reject rate, spread across hosts, so it is the model rather than any provider. Gemini through
OpenRouter failed 0 of 16 on the same prompt. Shipping DeepSeek needs a retry-on-reject loop, or
a decision that those voice rules are too strict for it.

## What the ZDR policy costs

The account policy refuses 5 of the model's 15 endpoints outright, with an explicit
`ZDR violation (account settings)`. That refusal is the audit evidence the readiness gate wants.

It is not free. Baidu is the single strongest endpoint on the whole list — cheapest, fastest p50
at 735ms, 100% uptime — and it is blocked. Alibaba is next best and also blocked. Group averages
hide this, because the reachable set never has to compete with either.

## Gotchas worth not rediscovering

- **Pin the provider before benchmarking.** Unpinned, OpenRouter spread one DeepSeek model across
  15 hosts and the same prompt read anywhere from 2s to 59s. That measures routing, not the model.
- **Vary the prompt tail when measuring cache.** An identical repeat reports a discount production
  never receives.
- **`supports_implicit_caching` does not predict caching.** It reads `false` on four providers
  that demonstrably cache. Trust the `cached_tokens` field on the wire.
- **Cost comes from `usage: {include: true}`** in the request body. The `/api/v1/generation`
  endpoint returns 404 under this account's `data_collection: "deny"`.
- **A free-tier `GEMINI_API_KEY` is quota 0 on `gemini-pro-latest`**, which resolves to
  `gemini-3.1-pro`. A free key cannot exercise the pin in `ui/api/_lib/geminiModel.ts` at all.
- **An unmarked prefix can still earn a partial discount**, but only after several back-to-back
  identical-prefix calls, and the state does not survive other traffic in between (#890). No
  single unmarked call can be relied on to hit.
- **The stable prefix measured 5,553 tokens by Gemini's own count on 2026-09-06** (#890), against
  this doc's earlier 6,876-token estimate from 2026-09-05. Trust `cached_tokens`/`cache_write_tokens`
  on the wire over any token count computed ahead of a live call.

## Still missing

Production runs `gemini-pro-latest` and no working key for it existed when this was measured. The
direct-Gemini arm here ran flash. Re-run it once the key has credit.
