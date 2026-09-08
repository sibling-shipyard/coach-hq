# 0043 — Shared web widget module

- **Status:** Accepted · 2026-09-08 · Tech Lead
- **Area:** ui
- **Context:** Ten Warm Instrument cards already render on Home and `/gallery`, but their files live under `home-warm/`. Chat would have to depend on a page-specific directory to reuse a portable card or the snapshot contract.
- **Decision:** Keep portable React cards, their snapshot types, and their presentation helpers in `ui/client/src/components/widgets/`. Keep Home-only composition and navigation in `home-warm/`. Compatibility barrels preserve current imports while new cross-surface code uses the shared module.
- **Why:** File ownership should match the cards' proven surface independence. One canonical module lets Home, `/gallery`, and an allowlisted Chat renderer share presentation code without making Chat depend on Home.
- **Rejected:** Leave portable cards in `home-warm/` → every new surface inherits a false page dependency. Copy cards into Chat → rendering and accessibility behavior drift. Move Home-only `CoachMessageCard` → its link back to Chat makes it a Home teaser, not a portable fact card.
- **Enforces:** A portable web widget is defined in `components/widgets/`; `home-warm/` contains Home composition and compatibility exports, not a second renderer.
- **How to apply:** Add a reusable card and its presentation-only helpers to `components/widgets/`. Keep data adapters and page navigation with their owning surface. Import the canonical module from new cross-surface code.
