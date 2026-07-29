# Platform — HQ IP (not carved verbatim)

```
platform/soul/   ← source layers (edit these)
platform/SOUL.md ← composed output (never hand-edit; carved → athlete propagated/SOUL.md)
```

Athlete repos receive carved copy at `propagated/SOUL.md` + `propagated/docs/`.

## compose-soul.mjs

```bash
node platform/scripts/compose-soul.mjs
node platform/scripts/compose-soul.mjs --check
```

Edit `platform/soul/*.md`, never hand-edit `platform/SOUL.md`.

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

Runbook: [`docs/eng-docs/provision-runbook.md`](../docs/eng-docs/provision-runbook.md)

## Also here (R4)

| Path | Role |
|---|---|
| [`docs/eng-docs/`](../docs/eng-docs/) | HQ operator docs (iOS, auth, enrichment, HOW_IT_WORKS) |
| [`docs/ref-docs/`](../docs/ref-docs/) | Skeleton carve source only (5 files → `propagated/docs/`) |
| `plugins/` | HQ extensions (badminton analytics + `generate_analytics_snapshot.py`) |
| `skeleton-templates/` | Workout templates — 2 samples carved to athlete repos |
| `skills/` | pipeline-tools.md (carved to propagated) |
| `scripts/parse_match_description.py` | HQ operator tool (iOS ports logic to Swift) |
| `tests/` | HQ pytest (parse_match_description parity) |
