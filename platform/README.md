# Platform — HQ IP (not carved verbatim)

```
platform/soul/          ← source layers (edit these)
platform/SOUL.chat.md   ← composed output for coach-chat (bundled by ui/scripts/build-soul.mjs)
platform/SOUL.claude.md ← composed output for BYO Claude Code
```

One source, two targets (ADR 0022); the bare `platform/SOUL.md` name is retired. Never hand-edit
either composed file.

## compose-soul.mjs

```bash
node platform/scripts/compose-soul.mjs
node platform/scripts/compose-soul.mjs --check
```

Writes/checks both targets. Edit `platform/soul/*.md`, never hand-edit a composed build.

## validate-soul.mjs

```bash
node platform/scripts/validate-soul.mjs                  # lint both builds against reality
node platform/scripts/validate-soul.mjs --update-baseline
```

Checks that the paths, templates, writable sets, and section cross-references SOUL names actually
exist (issue #366). Known failures live in `platform/validate-soul-baseline.json`, each tagged with
a cause; only *new* findings fail. Non-blocking in CI until the baseline reaches zero.

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
