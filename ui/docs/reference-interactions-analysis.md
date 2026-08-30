# Supplied Warm Instrument interaction reference

**Sources:** [`Widget Design Philosophy.md`](reference-interactions/Widget%20Design%20Philosophy.md) and [`Widget Interactions.dc.html`](reference-interactions/Widget%20Interactions.dc.html), supplied by Sky on 19 July 2026. The philosophy is authoritative for product meaning and platform scope; the prototype is authoritative for mechanics, timing, and tooltip anatomy. See the [reference manifest](reference-interactions/README.md) for provenance and integrity hashes.

## Global contract

The supplied v1 contract is **web hover enrichment, not click/tap inspection**. Cards are read-only glances. Hover-only scrubs/tooltips appear on web; iOS keeps the same resting visual state without those enrichments. Do not add deep-link or pin targets in this release.

The deliberate interaction exceptions are: Weekly Plan chip dragging between days; Recent Session swipe-left to Edit on iOS only (web rows remain static); Training Activity month paging arrows; iOS long-press jiggle/size swap. Motion is physical and brief: 3–4 px card lift, 150–250 ms ease, no attention loops. Reduced motion must remove optional movement.

## Confirmed core station behavior

| Station                | Supplied behavior                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine hero            | Hover continuously across the complete six-week trend region. A vertical hairline follows the pointer and a compact light tooltip shows the nearest week and load. Leave clears it. Box plot, badge, sport split, number, and card are read-only. |
| Engine card            | Whole card lifts 4 px with a stronger shadow on hover. The trend itself uses the same continuous scrub interaction; no click/tap.                                                                                                                 |
| Sport commitment cubes | Entirely static in v1. Record scope remains fixed to ALL; no click, tap, tooltip, or annotation. Alarm state remains a visual state only.                                                                                                         |

## Visual interaction anatomy

Engine tooltip: paper background `#fbf8f1`, terracotta text `#7f3728`, Space Mono bold, compact 3–4 px vertical and 7–8 px horizontal padding, 5 px radius, nowrap, subtle dark shadow. The scrub guide is a 1 px paper-color line from trend top to above its axis labels. The tooltip and line have `pointer-events: none`.

The current fixed-canvas click/tap/pin provider, per-mark semantic buttons, outside dismissal, and Escape semantics conflict with this supplied v1 model and must be removed or bypassed wherever the reference says hover-only/static.

## Complete station map

| Widget/station         | Web HQ behavior to implement                                                                                                                                                                                    | Explicitly not implemented on web                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Engine                 | Card lifts 4 px on hover. Trend is one continuous scrub surface: pointer x snaps to nearest real week, showing a vertical guide and `WK · LOAD` tooltip. Leave clears it.                                       | No point buttons, focus buttons, tap pin, outside dismissal, or graph click. Box plot, badge, mix, and number remain inert. |
| Commitment cubes       | Static glance only.                                                                                                                                                                                             | No tooltip, count button, tap, pin, or Badminton scope toggle. Scope is fixed to `ALL`.                                     |
| Weekly Plan            | Native web drag on a sport chip; empty target accepts, occupied target swaps. Projection recomputes immediately from the reordered plan and changes copy/color when outside the band.                           | `COACH DRAFT` accept/edit is explicitly proposed only, not built.                                                           |
| Recent Sessions        | Static ledger rows on web. `All activity` remains the route link.                                                                                                                                               | Swipe-left Edit is iOS-only. No web row annotation, navigation, or edit sheet. Delete never appears on Home.                |
| Training Activity      | Hover a cell for `MONTH DAY · SPORT +LOAD`; hovered cell receives a 2 px ink outline. Header arrows page the available month window, clear any tooltip, and visibly disable at the ends. Cells never deep-link. | No click/tap pin.                                                                                                           |
| Calories               | Hover the existing pace bar to show the on-pace sentence in a compact ink tooltip; leave clears it.                                                                                                             | Card and bar do not click or pin.                                                                                           |
| Main & Side Quests     | Static and driven only by logged data.                                                                                                                                                                          | No hover detail, tap, pin, or inline logging.                                                                               |
| VO₂ max                | When live trend data exists, continuously scrub the 12-month graph to nearest month with guide and `MONTH · VALUE` tooltip. Existing unavailable state remains inert.                                           | Badge/card do not click.                                                                                                    |
| Coach’s Read           | Static.                                                                                                                                                                                                         | No hover, tap, pin, or thread surface on Home.                                                                              |
| Build Phase            | Hover each existing milestone row; row gets a quiet terracotta wash and a compact right-aligned tooltip containing its real projection assumptions/last-test evidence. Leave clears it.                         | No click/tap/pin.                                                                                                           |
| iOS-only demo stations | Long-press (~550 ms) enters jiggle/size swap. Recent row drag clamps to `0…−86px` and settles open past `−43px`, revealing a 72 px Edit action with a 14 px visual gap.                                         | These are not web HQ interactions and therefore do not belong in the current React web dashboard.                           |

## Exact prototype mechanics

The Engine six-week scrub computes `fraction = clamp((pointerX - rect.left) / rect.width, 0, 1)`, then selects `round(fraction × (pointCount - 1))`. Its guide sits at the selected point’s exact normalized x, not the raw pointer x. VO₂ uses the identical nearest-index model.

Weekly Plan drop swaps source and target entries. The prototype loads are BDM 210, CAL 90, RIDE 40 only as demo fixtures; production must recompute from real plan/session load evidence and the live Engine band rather than copying those values. Empty targets work because swapping with `null` moves the source chip and leaves the source empty.

Heatmap tooltip x is centered on the hovered cell. The supplied prototype positions it above the row; production must preserve this anatomy while clamping within the card when edge cells are used. Month arrows are 22 × 22 px, warm-border buttons with a subtle terracotta hover wash and muted text when disabled.

Calories tooltip text follows the factual pattern: `{elapsedPercent}% OF {MONTH} GONE · YOU’RE AT {progressPercent}%`.

Build milestone tooltips use each row’s real `math`/projection-evidence string. The prototype station examples are display fixtures and must not replace live activity/challenge evidence.

Trend-line curve smoothing must use monotone cubic (Fritsch-Carlson) interpolation, not naive Catmull-Rom. Plain Catmull-Rom-to-Bezier overshoots/rings on sparse or jagged real data (e.g. a win% swinging 16%→95% between two adjacent games) and produces visibly wrong loops past the actual data range. Monotone cubic constrains each segment's tangent so the curve never exceeds the two values it's connecting — same soft-curve feel, no artifacts. Reference implementation: `smoothPath()` in `ui/client/src/components/sport-analytics/chartUtils.ts`.

## Implementation consequence

The existing `FixedCanvasInspectionProvider` plus `FixedCanvasAnnotation` pin/button model is not the supplied interaction system. Replace it with purpose-built, hover-only scrub/tooltip behavior in the specific widgets above. Keep tooltips `pointer-events: none`, do not create layout footprint, and preserve the exact resting DOM geometry. Retain keyboard accessibility only for genuine controls (month arrows, plan chips/drop targets, and `All activity`); do not misrepresent passive chart marks as buttons.
