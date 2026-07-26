# Provision Runbook — M1b Operator Checklist

> Status: **Active** · Owner: Tech Lead · Authority: [`m1-plan.md`](m1-plan.md) M1b

## Context

Operator provisions private athlete repos from `sibling-shipyard/coach-skeleton`. Two modes: greenfield fork or full migration from legacy `coach-phelps` with path rewrite. Athlete installs the GitHub App and validates the shared dashboard.

**Prereq:** Skeleton fresh — `node scripts/carve-skeleton.mjs --push` on HQ `main`.

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
3. **Secrets ready** (cannot read from legacy via API):
   - `PAT_TOKEN` — fine-grained PAT, Contents + Workflows write on target repo.
   - Strava athletes: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.

---

## Commands

### Dry-run (always first)

```bash
scripts/provision-user.sh --migrate \
  --repo akash-suresh/coach-akash \
  --legacy akash-suresh/coach-phelps \
  --dry-run

scripts/provision-user.sh --migrate \
  --repo skanda-2003/coach-skanda \
  --legacy skanda-2003/coach-phelps \
  --dry-run
```

### Greenfield (new athlete)

```bash
PAT_TOKEN=ghp_... scripts/provision-user.sh \
  --greenfield --repo OWNER/coach-name
```

### Migrate (Akash / Skanda)

```bash
PAT_TOKEN=ghp_... \
STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_REFRESH_TOKEN=... \
scripts/provision-user.sh --migrate \
  --repo skanda-2003/coach-skanda \
  --legacy skanda-2003/coach-phelps
```

Inspect locally without push:

```bash
scripts/provision-user.sh --migrate \
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
| `data/aggregate.json` | `gen/aggregate.json` |
| `training/sync_status.json` | `gen/sync_status.json` |

Full map: [`skeleton-layout.md`](skeleton-layout.md) § Path migration.

Engine, workflows, and `propagated/` come from skeleton — not overwritten.

---

## Post-provision (manual)

1. **GitHub App** — athlete opens https://github.com/apps/coach-phelps/installations/new and selects the new repo.
2. **iOS rebuild** (Akash) — app must target new GitHub paths (`hist/`, `gen/widget_snapshots.json`).
3. **Validation** — [`m1-plan.md`](m1-plan.md) §7 checklist.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Template create fails | Script falls back to clone skeleton + push; or mark `coach-skeleton` as org template |
| No access to athlete legacy repo | Athlete adds operator as collaborator read-only, or runs script on their machine |
| `validate-data.yml` fails | Check migrated JSON paths; run pipeline locally in cloned repo |
| Dashboard can't find repo | App not installed on new repo, or missing `user_data/ledger/challenge_v2.json` |
