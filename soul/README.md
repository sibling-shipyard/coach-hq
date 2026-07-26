# `soul/` — SOUL A/B/C split fidelity harness

**Phase P1 — tooling only. No behaviour change, no data moved, SOUL not yet split.**
This directory freezes the target-layout path contract and the dispositioned line ledger
that later phases author A/B/C against. See `soul-abc-split-plan.md` (§6.1, §6.3–6.5, §7-P1)
and ADR `kdb/decisions/0006`.

**Source of truth:** `SOUL.md` v5.7 lives in the **`coach-phelps`** repo, which stays a frozen
working copy. `SOUL.v5.7.frozen.md` here is a byte-identical reference of that file. This HQ repo
(the future `coach-hq`) is where the split and its tooling are built.

## Artifacts

| File | What it is | Lifecycle |
|---|---|---|
| `SOUL.v5.7.frozen.md` | Byte-frozen reference copy of `SOUL.md` v5.7 (447 lines) | one-time (re-cut only if v5.7 is re-versioned) |
| `paths.contract.json` | Every instance path: `{pointer, instance_path, group, writer, legacy_path}`, covering the §6.4 target layout. B carries symbolic pointers; boot step 0 resolves them through this file. | standing |
| `disposition.yaml` | Every frozen line/clause dispositioned exactly once (`A`/`B`/`C`/`SPLIT`/`REWRITTEN`/`DROPPED`) with a stable rule-ID → anchor | standing |
| `anchors.registry.txt` | P1 **stub** anchor inventory; P3/P4 replace it with a live scan of `A.identity.md` / `B.engine.md` / `C.schema` | stub → live |
| `ci/` | The three checks + shared loader | standing |

## CI checks (`ci/`)

- **`gate2_coverage.py`** — union of ledger line-ranges == whole frozen file, none double-claimed (load-bearing).
- **`path_lint.py`** — every §6.4 target path is in the contract; no legacy `training/**` (or other legacy root) leaks into a target.
- **`anchor_resolution.py`** — every rule-ID resolves to a well-formed, uniquely-owned anchor (P1: against the stub registry).

Run locally:

```bash
python3 soul/ci/run_all.py
```

Wired into CI by `.github/workflows/soul-fidelity.yml` (runs on any `soul/**` change).

## Editing the ledger

After adding/editing/removing a disposition entry, regenerate the stub registry so the
anchor gate stays two-way consistent:

```bash
python3 soul/ci/anchor_resolution.py --write-registry
```

## Merge test (what turns CI red)

- Leave a frozen line unassigned → Gate 2 red.
- Let two entries claim the same line → Gate 2 red.
- Drop a §6.4 target path from the contract → path-lint red.
- Point a rule at an undeclared anchor → anchor-resolution red.
