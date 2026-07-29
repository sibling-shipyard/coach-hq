# Engineering docs

HQ operator and architecture docs. Athletes never see these.

## What goes where

| Location | Audience | Examples |
|---|---|---|
| **`docs/eng-docs/`** | Tech Lead, workers, iOS Builder | scaling, M1, iOS specs, HOW_IT_WORKS, auth |
| **`docs/ref-docs/`** | Coach carve source only (5 files) | timer contract, voice profile, current-week |
| **`propagated/docs/`** | Athlete repo (read-only copy) | carved from ref-docs + pipeline-tools |
| **`engine/`** | Carved runtime mirror | scripts, lib, core, claude |

**Rule:** if it ships in `propagated/docs/` on carve, source lives in `docs/ref-docs/` (and `platform/skills/pipeline-tools.md`).

## Index

See [`../CURRENT.md`](../CURRENT.md).
