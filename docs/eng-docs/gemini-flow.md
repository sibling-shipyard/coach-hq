# Gemini integration — how it works

## Context

Everything Gemini-specific was scattered across `coach-chat-flow.md`'s prompt section,
`llm-provider-current.md`'s cost/rate-limit numbers, and code comments. This is the one
reference for the Gemini call itself — model, prompt shape, caching, retries, response schema —
the same way `coach-chat-flow.md` is the one reference for the request lifecycle around it.

## Model and endpoint

`gemini-flash-latest` (Google's maintained alias — dated model ids keep getting sunset early;
see `coach-chat.ts:46-51`), called via raw `fetch` to `generateContent`, no SDK
(`GEMINI_API_KEY` env var). One call per turn, no streaming (issue #270).

## Prompt shape: static prefix + dynamic block

```mermaid
flowchart LR
    subgraph static["Static (cached, one entry for every athlete)"]
        persona["persona\nSOUL.md, ~13K tok"]
        instr["fixed instructions\n+ reasoning-field cue"]
        examples["3 few-shot examples"]
    end
    subgraph dynamic["Dynamic (fresh every call)"]
        state["state.md + quest_log.md\n(+ closing files on close turns)"]
        mode["mode-specific instructions\ngreeting / ordinary / closing"]
        format["file-edit-format\n+ commit-message instructions"]
        ts["todayContextLine()\nchanges every minute"]
    end
    static -->|cachedContent name| call["generateContent"]
    dynamic -->|prepended to contents| call
    history["conversation history\n(last 40 msgs)"] --> call
```

`coach-chat.ts`'s `askGemini()` builds these as two separate strings (`staticSystemText()` and
`dynamicText`), not one array, because of a hard API constraint below.

## Caching: implicit (fallback) vs explicit (primary path)

**Implicit caching** (Gemini's automatic, on-by-default behavior for 2.5+ models) discounts any
byte-identical prefix it happens to have recently served, best-effort. This project relies on it
only as a fallback — see below — but the reason it works at all is prompt *ordering*: everything
stable comes before anything that varies per call, so a byte-identical prefix exists in the
first place. Minimum cacheable size is 2,048 tokens (Gemini 2.5 Flash); SOUL.md alone clears
that ~6x over.

**Explicit caching** (`ui/api/_lib/soulCache.ts`) is the primary path: the static prefix is
uploaded once via `POST /v1beta/cachedContents`, returning a `cachedContents/...` name. Every
subsequent call passes `cachedContent: <name>` instead of resending the text at all — cached
reads are billed at 10% of standard input rate, *guaranteed*, not best-effort. The cache is not
per-athlete: since the static prefix is byte-identical for everyone, one cache entry serves
every athlete's calls.

**Hard constraint that shapes the whole design:** Gemini rejects a `generateContent` request
that sets both `cachedContent` and `systemInstruction` — they're mutually exclusive. Once a
cache is active, the dynamic block has nowhere else to go, so it's prepended into `contents` as
a synthetic exchange instead:

```mermaid
sequenceDiagram
    participant Server
    participant Gemini
    Note over Server: cache hit (or freshly created)
    Server->>Gemini: cachedContent: "cachedContents/xyz"<br/>contents: [dynamic-as-user-turn,<br/>"Understood."-as-model-turn,<br/>...history, latest message]
    Note over Server: cache miss AND creation failed (fallback)
    Server->>Gemini: systemInstruction: static + dynamic<br/>contents: [...history, latest message]
```

The fallback path (no `systemInstruction`/`cachedContent` split) is exactly the prompt shape
this project shipped before explicit caching existed — a broken or unconfigured cache degrades
to that, it never blocks a reply.

**Request-time staleness, distinct from cache-creation failure:** `getCachedSoulName()` can
return a name that's since gone stale or been evicted server-side between its own read and the
actual `generateContent` call — a different failure mode than *creating* a cache failing (which
falls back to `null`/no-cache before the call even happens). If the actual call comes back `400`
with a cache name set, `askGemini()` invalidates the stored record and retries once as a plain
no-cache call, so this never surfaces to the athlete as a failed reply — it costs one extra
round-trip, silently.

### Cache lifecycle (`soulCache.ts`)

- Cache name + expiry + a content hash of the static text live in **Vercel Edge Config**
  (rebranded "Global Config" in the dashboard, Aug 2026 — same product). Read via
  `@vercel/edge-config`'s `createClient(process.env.GLOBAL_CONFIG)` — `GLOBAL_CONFIG` because
  that's the default env-var name Vercel's "Connect Project" flow gives the store, not
  `EDGE_CONFIG` (the SDK's own hardcoded default, which would need a manual rename in that flow
  to line up). `EDGE_CONFIG_ID` + `VERCEL_API_TOKEN` are for writes, since Edge Config has no
  write API of its own — only the Vercel REST API does.
- TTL is 2 hours, long enough to amortize a normal chat session, short enough not to go far
  stale after a SOUL redeploy (the content hash catches a change immediately regardless; TTL
  just bounds how long a stale-but-unhashed edge case could theoretically live).
- Fails open at every step: no `GLOBAL_CONFIG` configured, a failed create call, a failed write —
  any of these just means this request (and until the next successful create) falls back to the
  no-cache shape above. Coaching never blocks on cache plumbing.
- **Setup required** (operator action, not code): create a Vercel Edge Config store, connect it
  to the project, and set `EDGE_CONFIG_ID`/`VERCEL_API_TOKEN` in Vercel's env vars (prod +
  preview) for writes to persist across cold starts. See `docs/eng-docs/env-vars.md`.
- Cache validity checks the model alongside the content hash, not folded into it — a
  `GEMINI_MODEL` bump with SOUL text unchanged still invalidates, since a `cachedContents/...`
  name is only valid for the model it was created against (the request-time retry above would
  also catch this, but checking up front avoids paying that round-trip when it's knowable
  earlier).
- Every reply logs `[coach-chat] Gemini usage: prompt=<n> cached=<n>` (`finishGeminiResponse`) —
  the standing way to confirm caching is actually being hit on real traffic, not just configured.
  See "Done when" below.
- Known, accepted race (not fixed): `getCachedSoulName`'s read-then-write isn't atomic, so
  concurrent cold starts that all miss the cache at once can each create and write their own
  entry, last write winning. Harmless — every created cache is independently valid, Gemini just
  ends up with a few short-lived orphaned entries that age out via their own TTL.

## Reasoning field

`responseSchema` declares `reasoning` before `reply` (Gemini fills fields in declaration order).
OpenAI's structured-outputs guide reports a large accuracy gain on schema-shaped tasks from a
reasoning field ahead of the final answer, even for non-reasoning-first models like Flash. The
model briefly checks itself — is this genuinely a close, is every proposed file edit backed by
real content it was actually shown — before committing to `reply`.

On a closing turn specifically, `finishGeminiResponse` logs the model's own `reasoning` text
(`console.log("[coach-chat] closing-turn reasoning:", ...)`) before stripping it — added
2026-08-06 after real closes were found landing with zero `file_updates` and no way to tell why.
This is the only place `reasoning` is ever available: it's deleted from the object immediately
after (not just omitted from responses — genuinely `delete`d, so `eval-coach-chat.ts`'s leak
check (`"reasoning" in reply`) holds on `askGemini`'s actual return contract, not just on
`coach-chat.ts`'s own `Response.json(...)` call sites, which all pick explicit fields and never
spread the whole object anyway). It never reaches the athlete either way.

## Response schema

```json
{
  "reasoning": "string, stripped before return",
  "reply": "string, required",
  "session_closed": "boolean",
  "commit_message": "string",
  "title": "string, only on session_closed:true",
  "file_updates": [
    { "path": "string", "edits": [{ "old_string": "string", "new_string": "string" }], "merge_patch": "string", "content": "string" }
  ]
}
```

`file_updates` picks exactly one of `edits` (markdown, exact-match string replacement) /
`merge_patch` (JSON, RFC 7396) / `content` (session files, whole-new-file) per entry — see
`ui/api/_lib/fileEdits.ts` and `coach-chat-flow.md`'s Write strategy (A7) section.

## Retries, timeouts, rate limits

- `fetchWithTimeout` wraps the Gemini call with a 25s abort (`UPSTREAM_TIMEOUT_MS`,
  `coachChatFiles.ts`), sized to leave headroom under Vercel's function timeout.
- A 429 is surfaced as a typed error the client shows as "rate-limited, try again shortly" — see
  `coachChatModel.ts`'s `CoachChatRateLimitedError` / iOS's `UserFacingError.swift`. No
  server-side retry on the Gemini call itself (a 429 mid-generation isn't safely retryable the
  way a GitHub read is — the athlete just sees the message and tries again).
- Current account tier, verified rate limits, and cost projections live in
  `docs/eng-docs/llm-provider-current.md` — this doc covers mechanics, that one covers the
  numbers for this account specifically.

## Done when

- `npm run eval:coach-chat` passes against a live key after any prompt-construction change.
- A live call's `usageMetadata.cachedContentTokenCount` is nonzero on the second request in a
  session, confirming explicit caching is actually hitting (not just configured) — check the
  standing `[coach-chat] Gemini usage: prompt=... cached=...` log line rather than a one-off
  script; verified live 2026-08-06, same `cached` value reused across two real messages in one
  session while `prompt` grew with history.

## Deferred

- P2: token-level streaming — issue #270, blocked on deciding how `reply` streams separately
  from the structured metadata fields.
- P3: cache invalidation is TTL + content-hash only, no active push on SOUL redeploy — acceptable
  given deploy frequency vs. the 2h TTL, revisit if that ratio changes.
- P3: `getCachedSoulName`'s read-then-write race under concurrent cold starts, documented above -
  not fixed, harmless in practice.
- Close-turn prompt reliability (does `session_closed: true` actually come with real
  `file_updates`) is a genuine compliance gap, not something this file's caching/retry mechanics
  can fix — see `coach-chat-flow.md`'s close-session detection section for the logging and prompt
  reinforcement added 2026-08-06.
