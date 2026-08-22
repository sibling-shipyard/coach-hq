# Provision Runbook — M1b Operator Checklist

> Status: Current · Owner: Tech Lead · Verified: 2026-08-22 · Authority: [`m1-plan.md`](m1-plan.md) M1b

## Context

Operator provisions private athlete repos from `sibling-shipyard/coach-skeleton`. Two modes: greenfield fork or full migration from legacy `coach-phelps` with path rewrite. Athlete installs the GitHub App and validates the shared dashboard.

**Prereq:** Skeleton fresh — `node platform/scripts/carve-skeleton.mjs --push` on HQ `main`.

---

## Athletes (M1c / M1d)

| Athlete | Mode | Target | Legacy | Ingestion |
|---|---|---|---|---|
| Akash | `--migrate` | `akash-suresh/coach-akash` | `akash-suresh/coach-phelps` | iOS |
| Skanda | `--migrate` | `skanda-2003/coach-skanda` | `skanda-2003/coach-phelps` | Strava |

Legacy repos stay as backup — do not archive in M1.

---

## Before you run

1. **gh auth** as operator (or athlete account owner for private repo create).
2. **Skeleton live** — ~50 files at https://github.com/sibling-shipyard/coach-skeleton.
3. **No repo secrets needed** — Sync and Apply Coach Patch run under the built-in
   `GITHUB_TOKEN` (`contents: write`). Just ensure the target repo's
   Settings → Actions → General → Workflow permissions = Read and write.

---

## Commands

### Dry-run (always first)

```bash
platform/scripts/provision-user.sh --migrate \
  --repo akash-suresh/coach-akash \
  --legacy akash-suresh/coach-phelps \
  --dry-run

platform/scripts/provision-user.sh --migrate \
  --repo skanda-2003/coach-skanda \
  --legacy skanda-2003/coach-phelps \
  --dry-run
```

### Greenfield (new athlete)

```bash
platform/scripts/provision-user.sh \
  --greenfield --repo OWNER/coach-name
```

### Migrate (Akash / Skanda)

**Important:** `--greenfield` or template-only create leaves skeleton **placeholder** ledger/gen. Athletes need `--migrate`.

```bash
platform/scripts/provision-user.sh --migrate \
  --repo skanda-2003/coach-skanda \
  --legacy skanda-2003/coach-phelps
```

After overlay, the script **regenerates `gen/`** (`regenerate_derived.py` + `build-dashboard-snapshot.mjs`) and **verifies** ledger is not still the skeleton template.

Inspect locally without push:

```bash
platform/scripts/provision-user.sh --migrate \
  --repo OWNER/coach-name --legacy OWNER/coach-phelps \
  --skip-push
```

---

## Path rewrite (migrate)

| Legacy | New |
|---|---|
| `training/coach/*` | `user_data/coach/*` |
| `training/ledger/*` | `user_data/ledger/*` |
| `training/activities/history/` | `user_data/activities/hist/` |
| `sessions/` | `user_data/activities/workout_plans/sessions/` |
| `templates/` | `user_data/activities/workout_plans/templates/` |
| `data/dashboard_snapshot.json` | `gen/dashboard_snapshot.json` |
| `training/sync_status.json` | `gen/sync_status.json` |

Full map: [`skeleton-layout.md`](skeleton-layout.md) § Path migration.

Engine, workflows, and `propagated/` come from skeleton — not overwritten.

---

## Post-provision (manual)

1. **GitHub App** — athlete opens https://github.com/apps/coach-phelps/installations/new and selects the new repo.
2. **iOS rebuild** (Akash) — app must target new GitHub paths (`hist/`, `gen/widget_snapshots.json`).
3. **Validation** — [`m1-plan.md`](m1-plan.md) §7 checklist.

### Patch an already-migrated repo (engine tool sync)

When HQ adds or updates carved engine tools after migrate (e.g. `validate-current-week`), athlete repos do **not** auto-update. Operator syncs from HQ **without** re-running full migrate:

```bash
# From coach-phelps-hq checkout (main after merge)
AKASH_ROOT="${AKASH_ROOT:-$HOME/src/coach-akash}"   # local clone of akash-suresh/coach-akash
HQ_ROOT="$(pwd)"

cp "$HQ_ROOT/engine/lib/current-week.mts"              "$AKASH_ROOT/engine/lib/"
cp "$HQ_ROOT/engine/scripts/validate-current-week.mts" "$AKASH_ROOT/engine/scripts/"
cp "$HQ_ROOT/engine/scripts/validate-current-week"     "$AKASH_ROOT/engine/scripts/"
chmod +x "$AKASH_ROOT/engine/scripts/validate-current-week"

cd "$AKASH_ROOT"
./engine/scripts/validate-current-week user_data/ledger/current_week.json
git add engine/lib/current-week.mts engine/scripts/validate-current-week.mts engine/scripts/validate-current-week
git commit -m "core: add validate-current-week wrapper (engine carve sync)"
git push origin main
```

Re-run `regenerate_gen()` only if HQ changed quest/aggregate scripts — not needed for validator-only sync.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Skeleton ledger (`My 60-Day Challenge`, empty aggregate) | Migrate never ran — re-run with `--migrate`, not `--greenfield` / `--dry-run` only |
| Template create fails | Script falls back to clone skeleton + push; or mark `coach-skeleton` as org template |
| No access to athlete legacy repo | Athlete adds operator as collaborator read-only, or runs script on their machine |
| `validate-data.yml` fails | Check migrated JSON paths; run pipeline locally in cloned repo |
| Dashboard can't find repo | App not installed on new repo, or missing the `.coach-engine-version` marker at the repo root |
