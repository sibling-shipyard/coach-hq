# Coach skeleton reference (`docs/ref-docs/`)

Docs Coach reads on-demand via SOUL — never at boot. HQ-only material (iOS setup, auth,
enrichment, HOW_IT_WORKS) lives in `docs/eng-docs/`.

**Not every file below is actually carried into an athlete repo.** `carve-skeleton.mjs`'s
`PROPAGATED_DOCS` array is the real source of truth — checked directly, not assumed, 2026-09-14.

| File | Carved to `propagated/docs/`? |
|---|---|
| `current-week-contract.md` | Yes |
| `timer-state-machine.md` | Yes |
| `pipeline-tools.md` (`platform/skills/`, not this directory) | Yes |
| `badminton-plugin.md` | Not yet — tracked, `docs/eng-docs/soul-path-to-v6.md` phase 2 names this the urgent one to restore |
| `season-close.md` | Not yet — same tracked restoration as above |
| `phelps-voice-profile.md` | No — intentionally not carved, see `soul-path-to-v6.md` |
| `soul-calibration.md` | No — intentionally not carved, see `soul-path-to-v6.md` |
| `milestone-schema.md` | No — describes a superseded schema, see its own `Status` header |
