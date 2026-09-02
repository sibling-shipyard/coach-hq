# 0038 — Coaching style restored, this time wired into SOUL's voice rules

- **Status:** Accepted · 2026-09-02 · Tech Lead
- **Area:** cross-cutting (coach-chat backend, SOUL)
- **Context:** `coaching_style` (`accountability` / `encouragement` / `analysis`) shipped once,
  with an iOS onboarding screen, a `memory.json` field, and an FSP intake question. It was then
  removed in `862e419` (#513/#515): "Style is not a stored enum. First Session does not ask or
  gate on it." No ADR was written for the removal. The field was real, but nothing ever read it.
  `coaching_style` was stored and never touched SOUL's voice rules, so it made no visible
  difference to a conversation. That is the actual reason it didn't earn its keep, not that
  athletes didn't want it.
- **Decision:** Restore `coaching_style` as a `memory.json` field and FSP intake question (E1 of
  the coach-chat commit redesign). It's a conversational question this time, not an iOS screen.
  Also add the part that was missing the first time: `platform/soul/A_identity.md` §3 now has a
  short section on how each style inflects delivery. Accountability is direct with less
  cushioning; encouragement leads with progress before the hard truth; analysis leads with the
  pattern or the reasoning before the verdict. Same *what* Coach says, different *how*.
- **Why:** Tying the field directly to a voice rule Coach actually reads every turn is the one
  change that makes this worth restoring a second time.
- **Rejected:** Bring back the iOS onboarding screen too → the athlete's explicit direction this
  round was conversational-only, no native screen · Store the field without a SOUL section again →
  exactly the failure mode this ADR exists to not repeat.
- **Enforces:** A restored field needs a wired consumer in the same PR, not a promise to wire it up
  later. If `coaching_style` is ever dropped again, this ADR should be superseded with the actual
  reason, not deleted silently a third time.
