# Product page v4 → 5/5 checklist

Tracks the 14-point audit + golden-widget sprint. Check boxes as items ship.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## Sprint A — Real widgets (golden dataset)

- [x] **A1** Highlights slides 1, 2, 4, 5 → real WI cards (`BuildPhaseCard`, `WeeklyPlanCard`, `QuestCard`, `TrainingActivityCard`) via `GOLDEN_HOME`
- [x] **A2** Add `amIImproving` to Layer 1 golden (`widget_snapshots.json` + `WarmHomeSnapshots` type) and wire slide 3 → `AmIImprovingCard`
- [x] **A3** Carousel shell: constrain `wi-*` cards in slide frame; runtime pitch; prev/next + keyboard + aria-live
- [x] **A4** Features §01: replace hand-rolled session rows with `RecentSessionsCard` (`GOLDEN_HOME.sessions`)

---

## Audit P0 — Interaction depth

- [x] **1** Real widgets in highlights, not CSS facsimiles *(A1–A2)*
- [x] **2** Engine hero: per-week Newsreader verdicts on scrub + draw-on-enter line + discrete hover zones
- [x] **3** Coach section (`#coach`): redesign or relocate; crossfade on quote pick *(moved after highlights)*
- [x] **4** Adapt demo: crossfade plan card on scenario A/B toggle

---

## Audit P1 — Polish & ship-ready

- [x] **5** Typography/spacing mock fidelity (hero 74px, lede 21px, padding rhythm)
- [x] **6** Engine discrete scrub zones *(merged into #2)*
- [x] **7** Carousel UX: prev/next arrows, keyboard ←/→, `aria-live` on slide change *(A3)*
- [x] **8** Mobile nav: restore section links (hamburger menu + LOG IN / waitlist always visible)
- [x] **9** Waitlist CTA: `POST /api/waitlist` → `platform/waitlist.json` (Vercel + GitHub PAT)

---

## Audit P2 — Narrative & craft

- [ ] **10** Restore journey beat (before/after) or equivalent emotional arc
- [x] **11** Follow-along: scroll-in hook (pause until visible, entrance pulse)
- [x] **12** Consistency grid stagger *(TrainingActivityCard compact + staggerCells)*
- [x] **13** Section rhythm: light/dark alternation *(coach moved after highlights — intentional)*
- [x] **14** Dead CSS cleanup (~400 lines removed)

---

## Follow-ups from Sprint A review

- [x] **F1** iOS golden sync: `npm run dev`/`build` copies `widget_snapshots.json` → `ios/CoachHQ/CoachHQ/Resources/golden_widget_snapshots.json` via `build-data.mjs`
- [ ] **F2** Manual QA: WeeklyPlan drag vs carousel swipe on touch
- [x] **F3** Slide 5 copy uses `GOLDEN_HOME.trainingActivity.activeDays`

---

## Mapping: 14 audit points → items above

| Audit # | Item | Status |
|---------|------|--------|
| P0-1 | 1, A1–A2 | ✅ |
| P0-2 | 2, 6 | ✅ |
| P0-3 | 3 | ✅ |
| P0-4 | 4 | ✅ |
| P1-5 | 5 | ✅ |
| P1-6 | 2, 6 | ✅ |
| P1-7 | 7, A3 | ✅ |
| P1-8 | 8 | ✅ |
| P1-9 | 9 | ✅ |
| P2-10 | 10 | — |
| P2-11 | 11 | ✅ |
| P2-12 | 12, A1 | ✅ |
| P2-13 | 13 | ✅ |
| P2-14 | 14 | ✅ |

**Remaining for 5/5:** #10 journey beat, F2 manual QA
