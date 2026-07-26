# Scripts — HQ operator notes

## engine/ (full brain — HQ)

Protocols, soul layers, plugins, templates, strava, scripts. See `engine/README.md`.

Only a **subset** is carved into `coach-skeleton` (sync + aggregate scripts, strava, core, lib).

## compose-soul.mjs

```bash
node engine/scripts/compose-soul.mjs
node engine/scripts/compose-soul.mjs --check
```

## carve-skeleton.mjs

Builds thin skeleton: **data bands + SOUL.md copy + minimal scripts** (no agents, no soul layers).

```bash
node scripts/carve-skeleton.mjs --dry-run
node scripts/carve-skeleton.mjs --push
```

## Sync model (user repos)

| Ingestion | Who writes `history/` | Actions workflow |
|---|---|---|
| **iOS** | `ios/` app (HQ) commits `hk_*.json` | Regenerate only (no `STRAVA_*` secrets) |
| **Strava** | `strava/fetch_strava.py` in CI | Pull + regenerate when secrets set |

Per-repo mode = which secrets are provisioned. No `SYNC_SOURCE` flag.
