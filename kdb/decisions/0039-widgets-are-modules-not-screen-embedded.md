# 0039 — Widgets are modules, not screen-embedded views

- **Status:** Accepted · 2026-09-08 · iOS Builder
- **Area:** ios
- **Context:** Every iOS widget lived as a `private struct` inside whichever screen drew it
  first. `SportChip`'s own comment said "never redesign this per surface"; both call sites
  redrew it inline within days, and the atom went dead with the rule still sitting there unread.
- **Decision:** Every widget view is its own file under `ios/CoachHQ/CoachHQ/Views/Widgets/`,
  never a `private struct` embedded in a screen file.
- **Why:** A widget nested inside a screen file is invisible to reuse search. W1 found four whole
  screens dead for exactly that reason — nothing forced a second surface to look there first.
- **Rejected:** Keep widgets embedded, rely on code review to catch re-implementation → already
  failed once per `SportChip`/`CoachReadWidget`, and a full-repo audit was what actually found it.
- **Enforces:** No new widget view is defined `private` inside a screen file.
- **How to apply:** New widget → new file in `Views/Widgets/`, named `<Thing>Card` (in-app) —
  `…Widget` stays reserved for a WidgetKit `Widget` conformer. Once #928's W6 lands
  `WidgetCatalogKey`, a module here is what a catalog key resolves to; until then this ADR is
  the file-location rule on its own.
