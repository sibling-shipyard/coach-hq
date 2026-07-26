# Current Docs — Active Reference Index

> **Purpose:** Single entry point for live, authoritative docs in `docs/`. Version-suffixed design specs (`soul-v4-design.md`, `soul-v5-design.md`) are historical unless marked active below.
>
> **Naming convention (M4):** all `docs/` filenames use **kebab-case**. Snake_case and SCREAMING_SNAKE names were normalized 2026-07-25.

---

## Governance & restructure

| Doc | Role |
|-----|------|
| [`restructure-ledger.md`](restructure-ledger.md) | Migration ledger — every path move, archive, rename (M0–M5) |
| [`repo-restructure-plan.md`](repo-restructure-plan.md) | Tech Lead restructure plan and milestone exit tests |
| [`hq-port-plan.md`](hq-port-plan.md) | HQ port milestones (P1–P3) — adopt clean structure from `coach-phelps` |
| [`m1-plan.md`](m1-plan.md) | **Active** M1 execution plan — thin skeleton, provision, Akash + Skanda clones |

---

## HQ-specific (root + docs)

| Doc | Role |
|-----|------|
| [`../AGENTS.md`](../AGENTS.md) | Multi-agent routing, repo guide, universal rules |
| [`../HOW_IT_WORKS.md`](../HOW_IT_WORKS.md) | Athlete-facing concepts and daily workflow |
| [`scaling-plan.md`](scaling-plan.md) | **Authoritative** multi-tenant scaling architecture (M0–M4) |
| [`../scaling_plan.md`](../scaling_plan.md) | Parking lot — friend-#3 open items only; superseded by `scaling-plan.md` for architecture |
| [`website-unification-history.md`](website-unification-history.md) | How the shared site came together (Skanda + Akash) |

---

## Coach boot & contracts (read on demand unless noted)

| Doc | When to read |
|-----|--------------|
| [`soul-split-plan.md`](soul-split-plan.md) | Layered soul architecture (A/B/C split, compose pipeline, milestones) |
| [`../soul/`](../soul/) | Source layers: `A_identity.md`, `B_engine.md`, `C_athlete.md` — edit these, not `SOUL.md` |
| [`../scripts/compose-soul.mjs`](../scripts/compose-soul.mjs) | Regenerates `SOUL.md` from soul layers; CI drift-check via `validate-soul.yml` |
| [`current-week-contract.md`](current-week-contract.md) | Before creating/changing `training/ledger/current_week.json` |
| [`milestone-schema.md`](milestone-schema.md) | When testing/updating `training/ledger/challenge_v2.json` milestones |
| [`timer-state-machine.md`](timer-state-machine.md) | When setting timer fields on workout templates/sessions (§7) |
| [`athlete-protein-reference.md`](athlete-protein-reference.md) | When the athlete describes meals |
| [`badminton-roster.md`](badminton-roster.md) | Tactical context for partners/opponents |
| [`visualization-audio-guide.md`](visualization-audio-guide.md) | When generating guided visualization scripts |
| [`phelps-voice-profile.md`](phelps-voice-profile.md) | Voice cadence for viz audio (with visualization-audio-guide) |
| [`phelps-research-notes.md`](phelps-research-notes.md) | Deep Phelps anecdote detail |
| [`soul-calibration.md`](soul-calibration.md) | Voice quality anchors when output feels off |

---

## iOS app

| Doc | Role |
|-----|------|
| [`ios-app-spec.md`](ios-app-spec.md) | Technical spec (HealthKit-only architecture) |
| [`ios-app-design.md`](ios-app-design.md) | Full app roadmap |
| [`ios-xcode-setup.md`](ios-xcode-setup.md) | Build instructions |

---

## Pipeline & enrichment

| Doc | Role |
|-----|------|
| [`activity-enrichment-guide.md`](activity-enrichment-guide.md) | Manual activity enrichment workflow |
| [`coach-phelps-template-plan.md`](coach-phelps-template-plan.md) | Generic fork template design (pre-v3 schema — refresh before fork) |
| [`audio-viz-rebuild-spec.md`](audio-viz-rebuild-spec.md) | Viz tape rebuild spec |

---

## Historical / versioned (not boot)

| Doc | Notes |
|-----|-------|
| [`soul-v4-design.md`](soul-v4-design.md) | v4 SOUL rewrite design — shipped |
| [`soul-v5-design.md`](soul-v5-design.md) | v5 SOUL design — shipped (superseded by layered `soul/` + compose) |

---

## UI deep-links audit (M4)

**Result:** `ui/` contains **zero** hardcoded links to repo-root `docs/` paths. Doc renames are safe for the dashboard build. External bookmarks to old snake_case names will 404 — use this index.
