# E1 — Restore coaching style, with real SOUL wiring — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-09-01

Execution detail for E1 in [`chat-commit-redesign.md`](chat-commit-redesign.md). Independent of
every other milestone in this redesign — can land anytime.

## Context

`coaching_style` (exactly three enums: `accountability` / `encouragement` / `analysis`) existed
before, with a dedicated iOS onboarding screen (`OnboardingRevealFlow.swift`'s
`CoachingStyleStepView`), a `memory.json` field, and an FSP intake question. It was deliberately
removed by Akash (commit `862e419`, "core: drop coaching_style from athlete memory #513/#515"):
"Style is not a stored enum. First Session does not ask or gate on it." No ADR was written for the
removal. Akash has since confirmed it's needed back, with the explicit addition that it must
actually change how Coach talks day to day — the original version was stored but never wired into
SOUL's voice rules, which is presumably part of why it didn't earn its keep the first time.

## Fix

**Not an iOS screen this time** — a First Session Protocol conversational question instead, per the
athlete's direction. Original FSP question (from the removed `B_engine.md` text) can be reused
verbatim or close to it: *"What works when things get hard: someone holding you accountable,
someone cheering you on, or someone walking through the why?"*

- `ui/api/coach-chat/_lib/coachMemoryFiles.ts`: reinstate `COACHING_STYLES = ["accountability",
  "encouragement", "analysis"]` and the `coaching_style` field on `MemoryJson`.
- `platform/soul/B_engine.md`: reinstate the FSP intake question (Step 2, alongside the other
  intake questions) and a `coaching_style_update` (or equivalent) structured action, enum-
  constrained to the three values (same `responseSchema` `enum` pattern D1 uses for other fields —
  reuse it here rather than inventing a second pattern).
- `platform/scripts/carve-skeleton.mjs`: add the field to `MEMORY_TEMPLATE`, empty/unset until FSP
  sets it — consistent with this whole redesign's "no placeholder data" principle (B1). Do not seed
  a default style.

**The part that's actually new — SOUL voice wiring.** This is what makes it worth restoring.
`platform/soul/A_identity.md` §3 (Coach's voice rules) and `B_engine.md`'s coaching-philosophy
sections currently have zero per-athlete adaptation — one fixed voice for everyone. Add a short,
concrete section (keep it tight — this is Coach's actual voice, not a settings dump) describing how
each of the three styles inflects delivery without changing *what* Coach says, only *how*:
- `accountability` — direct, names the gap plainly, less cushioning.
- `encouragement` — leads with progress and momentum before the hard truth.
- `analysis` — leads with the pattern/data/reasoning before the verdict.

This section needs to compose into both `SOUL.chat.md` and `SOUL.claude.md` (ADR 0022) — write it as
a normal `platform/soul/A_identity.md` or `B_engine.md` section, not runtime-targeted, unless there's
a reason one runtime shouldn't see it (none identified so far).

## New ADR required

Write `kdb/decisions/00XX-coaching-style-restored.md` referencing the removal commit (`862e419`,
#513/#515) and explaining why it's back: the original gap wasn't "athletes don't want this," it was
"the stored value was never used." This time it's tied directly into SOUL's voice rules, which is
the part that was actually missing. Prevents this from being a third round of add/remove without a
documented reason either way.

## Tests

- `coachIntents.test.ts`: a `coaching_style_update`-style applier test (or whatever the reinstated
  write path is named), enum-constrained, matching the pattern of `applySportsUpdate`.
- New eval fixture: FSP conversation stating a coaching-style preference, asserting it lands in
  `memory.json`.
- SOUL compose check (`node platform/scripts/compose-soul.mjs --check`) stays green with the new
  section in place.
- Manual/live check (not automatable): two scratch conversations with different stated styles,
  confirming Coach's replies actually read differently — this is the part that matters most and the
  part a unit test can't verify.

## Done when

A fresh FSP conversation asks the coaching-style question, the athlete's answer lands in
`memory.json`, and a subsequent daily conversation's tone visibly reflects it — verified by reading
actual replies, not just confirming the field wrote.
