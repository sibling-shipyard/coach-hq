# Scripts — operator notes

## compose-soul.mjs

Regenerates `SOUL.md` from `soul/` layers. CI validates with `--check`.

```bash
node scripts/compose-soul.mjs
node scripts/compose-soul.mjs --check
```

## build-aggregate.mjs

User-repo aggregate builder (skeleton sync). Writes `data/aggregate.json` from `training/` paths.

```bash
node scripts/build-aggregate.mjs --aggregate
```

HQ continues to use `ui/scripts/build-data.mjs` for the shared UI bundle.

## carve-skeleton.mjs

Builds the `coach-skeleton` tree from HQ at the current commit (or `--sha`).

```bash
# Local dry-run (writes ./skeleton-out by default)
node scripts/carve-skeleton.mjs --dry-run

# Custom output directory
node scripts/carve-skeleton.mjs --dry-run --out-dir /tmp/coach-skeleton-test

# Push to org repo (requires gh auth + org write access)
node scripts/carve-skeleton.mjs --push
```

### Push blockers

If `gh repo create sibling-shipyard/coach-skeleton` or `git push` fails:

1. Authenticate: `gh auth login` with an account that has **write** access to the `sibling-shipyard` org.
2. Create the repo manually: **New repository** → `coach-skeleton` under `sibling-shipyard`, private, empty (no README).
3. Re-run: `node scripts/carve-skeleton.mjs --push`
4. Verify CI: `validate-soul.yml` and `validate-data.yml` green on `main`.

Pin record written to skeleton: `.coach-engine-version` as `hq_sha=<full-sha>`.

## User-repo sync template

`scripts/templates/sync.yml` is copied into skeleton as `.github/workflows/sync.yml`. It runs `run_sync_pipeline.py` (honours `SYNC_SOURCE` repo variable) then `build-aggregate.mjs --aggregate`. No `ui/` npm step.

Set repository variable **`SYNC_SOURCE`** to `ios` (HealthKit push path) or `strava` (default).
