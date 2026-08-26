# Warm Instrument Interaction Reference

Sky supplied these artifacts in `interactions.zip` on 19 July 2026. They are committed here as the immutable source reference for the Warm Instrument interaction rebuild. `Widget Gallery.dc.html` and `Sport Analytics.dc.html` were supplied as a follow-up on 22 July 2026, extending the same reference set.

| File | Purpose | Bytes | SHA-256 |
|---|---|---:|---|
| `Widget Design Philosophy.md` | Primary product and platform contract: meaning, feeling, interaction budget, reuse rules, palette, and typography. | 9,361 | `c9e3c7040784c62b5132d3f7a39ae1c9d4031e1b5d188a568ae83d52f8be3b83` |
| `Widget Interactions.dc.html` | Exact station-by-station prototype mechanics, visual anatomy, event thresholds, payload examples, and transitions. | 67,161 | `ba252b935c3317dfd06e10710bb3fe883dd8e8505d6ac68dc5e5a86637d74f27` |
| `Widget Gallery.dc.html` | The full S/M/L size catalog for every widget, with per-widget tap-target/interaction notes (unlike the read-only `Widget Interactions.dc.html` playground, cards here document real deep-link and toggle behavior). Also the source for the **XL anchor** rule: exactly one hero widget per lens (Engine on Home; Win Rate on badminton; Weekly Volume on running; Skill Tracks on calisthenics) earns an XL size. | 203,410 | `09e3f09c58625ce71ec54e38a07083226825681e1f26461af31856e96cb7863e` |
| `Sport Analytics.dc.html` | Introduces the **spine + lens model** for sport-specific analytics pages: a shared spine (load vs band, session ledger, heatmap — same atoms as Home) with a sport-specific lens on top (e.g. badminton's Win Rate/Head-to-Head/Session Shape). Also documents the **scope toggle** interaction (8W/ALL, RANKED/ALL) that reframes a widget in place without navigating. | 76,503 | `3a7767da958c42293dd4549096ac525dd352aa73cb345d86c7edcd2fd60ddcc8` |

All four supplied files are copied verbatim from the extracted archives. Do not edit them when implementing the product. Record interpretations and production-specific mappings in [`../reference-interactions-analysis.md`](../reference-interactions-analysis.md) instead.

For the current React web dashboard, the philosophy’s **Web app (HQ)** row governs behavior. Consequently, hover scrubs and tooltips, Weekly Plan chip dragging, heatmap month paging, and the sport-lens scope toggle are in scope. Long-press jiggle, session-row swipe-to-edit, and WidgetKit glance behavior are preserved here for cross-platform design continuity but are not web interactions — see `.github/agents/ios-builder.md` for how they map onto the iOS app and future iOS home-screen widgets.
