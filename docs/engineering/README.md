# Engineering docs

HQ operator and architecture docs. Athletes never see these.

## What goes where

| Location | Audience | Examples |
|---|---|---|
| **`docs/engineering/`** | Tech Lead, workers | scaling, M1, restructure, provision, schemas |
| **`engine/docs/`** | Coach on-demand + carve | timer contract, voice profile, ios spec |
| **`propagated/docs/`** | Athlete repo (read-only copy) | subset carved by `carve-skeleton.mjs` |
| **`platform/`** (R3) | HQ IP authoring | soul layers, contracts source — not yet split |

**Rule:** if it ships in `propagated/docs/` on carve, source lives in `engine/docs/` until R3 moves platform IP.

## Index

See [`../CURRENT.md`](../CURRENT.md) — engineering section.
