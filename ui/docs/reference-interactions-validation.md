# Reference Interaction Validation

Validated against the committed [Widget Design Philosophy](./reference-interactions/Widget%20Design%20Philosophy.md), the [interaction prototype](./reference-interactions/Widget%20Interactions.dc.html), and the frozen [production acceptance contract](./reference-interactions-acceptance.md). Tests exercised the protected production Home at `/` for isolation and overflow, and the live-data review surface at `/home-v2` for the full interaction contract.

## Final contract results

| Surface                  | Verified behavior                                                                                                                                                                                       | Intentionally absent                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Engine                   | Fine-pointer hover continuously scrubs the existing six-week trace, snaps to the nearest real week, and overlays a guide plus `{WEEK} · {LOAD}` paper chip. The card lifts 4 px with no geometry shift. | Point buttons, click state, tap pin, focus inspection, outside dismissal. |
| Commitments              | All four cubes remain static; Badminton displays fixed `ALL`.                                                                                                                                           | Scope toggle, `⇄`, count inspection, card click.                          |
| Weekly Plan              | Existing chips move or swap through native drag/drop. Space or Enter picks up and drops; arrow keys select a destination; Escape cancels. Slots and card bounds remain fixed.                           | Persistence, `COACH DRAFT` accept/edit, fabricated projection values.     |
| Training Activity        | The four-month window pages one month at a time with correctly disabled ends. Dated non-empty cells use a fine-pointer-only outlined hover read.                                                        | Cell click, tap pin, deep link.                                           |
| Calories                 | Fine-pointer hover follows the existing meter and uses the real cumulative daily series for actual-versus-expected pace.                                                                                | Card click, tap state, expanded metric panel.                             |
| Quests and Coach Read    | Static, source-backed glances.                                                                                                                                                                          | Hover, click, tap, inline logging, thread surface.                        |
| VO₂ max                  | Available observations use the same nearest-point scrub model. The current unavailable state is entirely inert.                                                                                         | Empty-state card control or fabricated trend.                             |
| Recent Sessions          | Rows remain static web receipts; `All activity` is the only control.                                                                                                                                    | Row inspection, navigation, swipe, edit, delete.                          |
| Build Phase              | Fine-pointer hover adds a quiet row wash and compact source-backed evidence badge.                                                                                                                      | Row click, tap pin, synthetic milestone math.                             |
| Touch and reduced motion | Hover enrichments remain absent on touch; optional lift/transition motion is removed under reduced motion.                                                                                              | Desktop hover leakage or attention loops.                                 |

The deterministic headed-desktop and mobile-emulated suite completes **28 checks with zero failures**. It additionally verifies tooltip containment, fixed card and mark geometry, drag and keyboard swaps, hover clearing, click non-persistence, touch suppression, responsive visibility, route isolation, generated-data equality, and zero horizontal overflow at **390, 720, 1024, and 1440 px**.

## Route and data integrity

| Contract                | Result                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected Home `/`      | **Pass.** One production dashboard root is present and `.wi-shell` count is **0**.                                                                                              |
| Review route `/home-v2` | **Pass.** The isolated Warm Instrument shell is present only on V2.                                                                                                             |
| Current-week load       | **Pass.** Generated `activities.json` contains two current-week activities with full Zone 1–5 observations. Independent recomputation gives **388.2478**, displayed as **388**. |
| Formula disclosure      | **Pass.** The page reads `LOAD = Σ(MIN × ZONE 1–5) · BAND = 8-WK RHYTHM ±20%`.                                                                                                  |
| Missing HR zones        | **Pass.** Load is unavailable (`null`/em dash) rather than estimated from average heart rate; partial historical weeks do not enter the rhythm baseline.                        |

## Visual fidelity

The accepted no-interaction image is [`reference-rest-final-headless.png`](./validation-assets/reference-rest-final-headless.png). It was captured in a separate non-hovering Chromium session at **1440 × 861**; headed screenshots are reserved for active hover evidence because their compositor cursor enters the Engine trace. The rest frame contains no guide, chip, badge, or pinned state.

| Comparison metric                            |         Result |
| -------------------------------------------- | -------------: |
| Exact pixel identity                         | **99.854336%** |
| Identity above an 8-level color threshold    | **99.985482%** |
| Mean absolute channel difference             |   **0.011628** |
| Card, chart, gauge, value, and grid movement |       **0 px** |

The amplified difference map is effectively black. Remaining localized pixels correspond to the intentional removal of `⇄`, the animated sync glyph, scrollbar position, and subpixel browser rasterization—not moved content.

## Evidence

| Evidence                                        | File                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Protected production Home                       | [`protected-home-restored.png`](./validation-assets/protected-home-restored.png)                           |
| Clean V2 desktop resting state                  | [`reference-rest-final-headless.png`](./validation-assets/reference-rest-final-headless.png)               |
| V2 Engine continuous scrub                      | [`home-v2-engine-scrub.png`](./validation-assets/home-v2-engine-scrub.png)                                 |
| V2 Weekly Plan keyboard swap                    | [`home-v2-plan-keyboard-swap.png`](./validation-assets/home-v2-plan-keyboard-swap.png)                     |
| V2 four-month heatmap paging                    | [`home-v2-heatmap-paged.png`](./validation-assets/home-v2-heatmap-paged.png)                               |
| V2 Calories pace scrub                          | [`home-v2-calories-scrub.png`](./validation-assets/home-v2-calories-scrub.png)                             |
| V2 Build milestone hover                        | [`home-v2-build-hover.png`](./validation-assets/home-v2-build-hover.png)                                   |
| V2 390 px touch rest state                      | [`home-v2-touch-rest.png`](./validation-assets/home-v2-touch-rest.png)                                     |
| Full route, data, behavior, and geometry report | [`reference-interactions-report.json`](./validation-assets/reference-interactions-report.json)             |
| Resting-state pixel report                      | [`reference-rest-comparison.json`](./validation-assets/reference-rest-comparison.json)                     |
| Amplified difference map                        | [`reference-rest-comparison-difference.png`](./validation-assets/reference-rest-comparison-difference.png) |

## Build status

`vite build` succeeds. The Warm Instrument source reports **zero TypeScript diagnostics**. The repository-wide TypeScript command still exits non-zero because of existing diagnostics outside this feature; none match `home-warm`, `WarmInstrument`, `HomeV2`, or the protected `Home` route.
