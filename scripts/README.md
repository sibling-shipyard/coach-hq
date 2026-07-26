# Scripts — HQ operator notes

## engine/ (skeleton source)

Carveable brain lives under `engine/` — see `engine/README.md`. User forks get a **flat** copy (`soul/`, `scripts/`, `strava/` at repo root).

## compose-soul.mjs

```bash
node engine/scripts/compose-soul.mjs
node engine/scripts/compose-soul.mjs --check
```

## carve-skeleton.mjs

Copies `engine/` → flat tree → `sibling-shipyard/coach-skeleton`.

```bash
node scripts/carve-skeleton.mjs --dry-run
node scripts/carve-skeleton.mjs --push   # requires org write access
```

## Sync model (user repos)

| Ingestion | Who writes `history/` | Actions workflow |
|---|---|---|
| **iOS** | `ios/` app commits `hk_*.json` directly | Regenerates quest/aggregate only (no `STRAVA_*` secrets) |
| **Strava** | `engine/strava/fetch_strava.py` in CI | Pull + rename + regenerate |

No per-repo flag — pipeline skips Strava when `STRAVA_*` secrets are absent.

User-repo workflow template: `engine/.github/workflows/sync.user.yml` (carved as `.github/workflows/sync.yml`).
