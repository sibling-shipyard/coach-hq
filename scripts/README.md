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

Builds full BYO skeleton: **propagated/ + engine/ + gen/ + user_data/** (no agents, soul layers, ui/, ios/).

```bash
node scripts/carve-skeleton.mjs --dry-run
node scripts/carve-skeleton.mjs --push
```

## provision-user.sh

Operator tool: fork `coach-skeleton` → private athlete repo. Greenfield or legacy migration with path rewrite.

```bash
scripts/provision-user.sh --greenfield --repo OWNER/coach-name --dry-run
scripts/provision-user.sh --migrate --repo OWNER/coach-name --legacy OWNER/coach-phelps
```

Runbook: [`docs/provision-runbook.md`](../docs/provision-runbook.md)

## Sync model (user repos)

| Ingestion | Who writes `history/` | Actions workflow |
|---|---|---|
| **iOS** | `ios/` app (HQ) commits `hk_*.json` | Regenerate only (no `STRAVA_*` secrets) |
| **Strava** | `strava/fetch_strava.py` in CI | Pull + regenerate when secrets set |

Per-repo mode = which secrets are provisioned. No `SYNC_SOURCE` flag.
