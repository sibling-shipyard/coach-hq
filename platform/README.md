# Platform — HQ IP (not carved verbatim)

Soul layers, compose/carve/provision operator tools. Athlete repos get **composed output** only (`propagated/SOUL.md`).

## compose-soul.mjs

```bash
node platform/scripts/compose-soul.mjs
node platform/scripts/compose-soul.mjs --check
```

Edit `platform/soul/*.md`, never hand-edit `propagated/SOUL.md`.

## carve-skeleton.mjs

```bash
node platform/scripts/carve-skeleton.mjs --dry-run
node platform/scripts/carve-skeleton.mjs --push
```

## provision-user.sh

```bash
platform/scripts/provision-user.sh --greenfield --repo OWNER/coach-name --dry-run
platform/scripts/provision-user.sh --migrate --repo OWNER/coach-name --legacy OWNER/coach-phelps
```

Runbook: [`docs/engineering/provision-runbook.md`](../docs/engineering/provision-runbook.md)

## Also here (R4)

| Path | Role |
|---|---|
| `plugins/` | HQ extensions (badminton analytics + `generate_analytics_snapshot.py`) |
| `docs/` | Coach reference — carved subset → `propagated/docs/` |
| `skeleton-templates/` | Workout templates — 2 samples carved to athlete repos |
| `skills/` | pipeline-tools.md (carved to propagated) |
| `scripts/parse_match_description.py` | HQ operator tool (iOS ports logic to Swift) |
| `tests/` | HQ pytest (parse_match_description parity) |
