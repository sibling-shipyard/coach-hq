# I1 — Staged progress indicator — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for I1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Stacked on D1
(consumes its `droppedActions`/reply-preserving error fields for accurate failure messaging).
No new infrastructure — the real-time streaming version of this is deliberately deferred, filed as
issue #767 (P3), not built here.

## Problem

Today, both web and iOS show one static "waiting" state for the entire time a turn is processing —
a bouncing-dots `ThinkingBubble` on web (`CoachChatWidgets.tsx:254-264`), a plain `ProgressView` +
"Coach is replying…" on iOS (`CoachChatView.swift:346,359-368`). No stage awareness at all,
regardless of how long the turn takes.

## Fix — cycling labels, matching the real (but not live-streamed) three-stage shape

Every turn already goes through the same three real stages, in order, no matter what: ask Gemini,
process the reply into structured writes, commit to the repo — this is exactly the shape this
codebase's own layered test architecture already tests separately (`layer1-gemini`, `layer2-fields`,
`layer3-commit`, per `docs/eng-docs/coach-chat-testing.md`). Show three labels that cycle in that
order while waiting for the response — not synced to real backend state (that's #767's job), just
giving the athlete a sense of progress instead of one frozen state, the same spirit as Claude Code's
own evolving status text. Suggested copy, refine freely: "Coach is thinking…" → "Parsing Coach's
thoughts…" → "Updating your log…". Nice animations on the transition between labels — a fade or
slide, not an abrupt swap — on both platforms.

**Timing**: cycle on a fixed schedule tuned to typical latency (check real timing once D3's Sentry
spans are live and give real numbers — don't guess blind), not tied to any real backend signal.

## Fix — the failure side must be real, not simulated

Unlike the happy-path labels, an error state should say what actually failed, accurately — this
doesn't need streaming, just the stage-tagged error response D1 already adds (`turn.reply.reply`
preserved on a commit failure, `droppedActions` on a validation rejection). Show a specific message
per real failure type: "Coach's reply couldn't save — try again?" (commit failure, reply still
shown) vs. a message reflecting a dropped action, vs. a generic Gemini-call failure. Not one generic
"something went wrong" for every case.

## Explicitly deferred

True live stage-by-stage progress (a real streaming response reflecting actual backend state,
not a simulated cycle) — filed as issue #767, P3, not part of this PR. Don't build streaming
infrastructure here.

## Tests

- Web component test: cycling label sequence renders in order, with the transition animation firing,
  over a simulated long-running request.
- iOS equivalent (XCTest / UI test): same sequence, same animation behavior.
- Web + iOS: each of the three real failure shapes (commit failure with preserved reply, dropped
  action, Gemini-call failure) renders its own specific message, not a shared generic one — this is
  new client-side test coverage; the backend logic producing these signals is already covered by
  D1's own tests, not duplicated here.

## Done when

Sending a message shows the cycling labels with a real transition animation on both platforms, and
each of the three failure types (from D1) shows an accurate, distinct message instead of one generic
error.
