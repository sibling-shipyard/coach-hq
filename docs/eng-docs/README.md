# Engineering docs (`docs/eng-docs/`)

HQ operator and architecture docs. Athletes never see these.

## What goes where

| Location | Audience | Examples |
|---|---|---|
| **`docs/eng-docs/`** | Tech Lead, workers | scaling, M1, restructure, provision, schemas |
| **`docs/ref-docs/`** | Coach on-demand + carve | timer contract, voice profile, ios spec |
| **`propagated/docs/`** | Athlete repo (read-only copy) | subset carved by `carve-skeleton.mjs` |
| **`engine/`** (R4 ✓) | Carved runtime mirror only | scripts, lib, core, claude |

**Rule:** if it ships in `propagated/docs/` on carve, source lives in `docs/ref-docs/`.

## Index

See [`../CURRENT.md`](../CURRENT.md) — engineering section.
