# Engineering docs

HQ operator and architecture docs. Athletes never see these.

## What goes where

| Location | Audience | Examples |
|---|---|---|
| **`docs/engineering/`** | Tech Lead, workers | scaling, M1, restructure, provision, schemas |
| **`platform/docs/`** | Coach on-demand + carve | timer contract, voice profile, ios spec |
| **`propagated/docs/`** | Athlete repo (read-only copy) | subset carved by `carve-skeleton.mjs` |
| **`engine/`** (R4 ✓) | Carved runtime mirror only | scripts, lib, core, claude |

**Rule:** if it ships in `propagated/docs/` on carve, source lives in `platform/docs/`.

## Index

See [`../CURRENT.md`](../CURRENT.md) — engineering section.
