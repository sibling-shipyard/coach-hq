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
