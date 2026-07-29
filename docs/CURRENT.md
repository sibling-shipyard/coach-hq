# Current Docs — Active Reference Index

> Two bands: **eng-docs** (HQ operators) and **ref-docs** (coach on-demand + carve source).

---

## Engineering (`docs/eng-docs/`)

| Doc | Role |
|-----|------|
| [`eng-docs/hq-restructure-plan.md`](eng-docs/hq-restructure-plan.md) | **Active** — HQ four-band restructure (R0–R5) |
| [`eng-docs/scaling-plan.md`](eng-docs/scaling-plan.md) | **Authoritative** multi-tenant architecture |
| [`eng-docs/m1-plan.md`](eng-docs/m1-plan.md) | M1 skeleton carve + provision |
| [`eng-docs/skeleton-layout.md`](eng-docs/skeleton-layout.md) | Locked athlete repo tree |
| [`eng-docs/provision-runbook.md`](eng-docs/provision-runbook.md) | Operator provision checklist |
| [`eng-docs/user-3-onboarding-gate.md`](eng-docs/user-3-onboarding-gate.md) | **Must-do** before friend #3 |
| [`eng-docs/challenge-v2-schema.md`](eng-docs/challenge-v2-schema.md) | Locked quest ledger schema (v4) |
| [`eng-docs/soul-split-plan.md`](eng-docs/soul-split-plan.md) | Layered soul architecture |
| [`eng-docs/soul-split-boundary.md`](eng-docs/soul-split-boundary.md) | S1 boundary map (design gate) |
| [`eng-docs/soul-parity-checklist.md`](eng-docs/soul-parity-checklist.md) | Soul layer parity checks |
| [`eng-docs/soul-C-schema.md`](eng-docs/soul-C-schema.md) | Athlete schema layer (Soul C) |
| [`eng-docs/hq-port-plan.md`](eng-docs/hq-port-plan.md) | HQ port from clean repo — **done** |
| [`eng-docs/coach-phelps-template-plan.md`](eng-docs/coach-phelps-template-plan.md) | Cloneable template repo plan |
| [`eng-docs/TODO.md`](eng-docs/TODO.md) | HQ backlog |

---

## Coach reference (`docs/ref-docs/` — on demand)

Read when SOUL or a worker points you there. Carved subset → `propagated/docs/`.

| Doc | Role |
|-----|------|
| [`ref-docs/HOW_IT_WORKS.md`](ref-docs/HOW_IT_WORKS.md) | Athlete daily workflow |
| [`ref-docs/current-week-contract.md`](ref-docs/current-week-contract.md) | Current week JSON schema |
| [`ref-docs/timer-state-machine.md`](ref-docs/timer-state-machine.md) | WorkoutTimer state machine |
| [`ref-docs/phelps-voice-profile.md`](ref-docs/phelps-voice-profile.md) | Coach voice calibration |
| [`ref-docs/soul-calibration.md`](ref-docs/soul-calibration.md) | Soul tuning reference |
| [`ref-docs/visualization-audio-guide.md`](ref-docs/visualization-audio-guide.md) | Viz/audio integration |
| [`ref-docs/audio-viz-rebuild-spec.md`](ref-docs/audio-viz-rebuild-spec.md) | Audio viz rebuild spec |
| [`ref-docs/activity-enrichment-guide.md`](ref-docs/activity-enrichment-guide.md) | Strava enrichment |
| [`ref-docs/milestone-schema.md`](ref-docs/milestone-schema.md) | Milestone ledger schema |
| [`ref-docs/ios-app-spec.md`](ref-docs/ios-app-spec.md) | iOS app functional spec |
| [`ref-docs/ios-app-design.md`](ref-docs/ios-app-design.md) | iOS app design doc |
| [`ref-docs/ios-sync.md`](ref-docs/ios-sync.md) | HealthKit sync contract |
| [`ref-docs/ios-xcode-setup.md`](ref-docs/ios-xcode-setup.md) | Xcode setup guide |
| [`ref-docs/github-auth.md`](ref-docs/github-auth.md) | GitHub auth for athletes |
| [`ref-docs/athlete-protein-reference.md`](ref-docs/athlete-protein-reference.md) | Protein reference data |
| [`ref-docs/badminton-roster.md`](ref-docs/badminton-roster.md) | Badminton roster (Sky) |
| [`ref-docs/phelps-research-notes.md`](ref-docs/phelps-research-notes.md) | Research notes |

---

## Repo entry + historical

| Doc | Role |
|-----|------|
| [`../AGENTS.md`](../AGENTS.md) | Multi-agent routing |
| [`eng-docs/soul-v4-design.md`](eng-docs/soul-v4-design.md) | v4 SOUL — shipped (historical) |
| [`eng-docs/soul-v5-design.md`](eng-docs/soul-v5-design.md) | v5 SOUL — shipped (historical) |
| [`eng-docs/website-unification-history.md`](eng-docs/website-unification-history.md) | Site unification history |
| [`eng-docs/SOUL_HISTORY.md`](eng-docs/SOUL_HISTORY.md) | SOUL version changelog |

---

**UI audit:** `ui/` has zero hardcoded links to repo-root `docs/` paths.
