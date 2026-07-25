# Setup Guide — Hosted Coach Phelps

This is the **hosted / 3-repo** onboarding path (M1). You get a private `coach-<user>`
instance repo; the dashboard is shared at the Coach Phelps site (deployed from
`sibling-shipyard/coach-phelps-hq`).

Budget about **30–45 minutes** in one sitting with an operator (or after they hand you a
fresh repo).

**Requirements**

- **Claude Pro** (or Max/Team) for BYO Claude Code coaching sessions
- **Strava Premium** *or* the Coach Phelps iOS app (HealthKit sync) for activity data
- A **GitHub account** (the instance repo lives under your user)

---

## 1. Get your instance repo

An operator provisions from the canonical skeleton:

```bash
git clone git@github.com:sibling-shipyard/coach-engine.git
cd coach-engine
./scripts/provision-user.sh --user YOUR_GITHUB_HANDLE --owner YOUR_GITHUB_USER
```

That creates `coach-<user>` with empty Layer C headings, validators, and the sync pipeline.
If you are migrating from an old monolith repo, they add `--migrate-from /path/to/old-repo`.

You should receive:

- Repo URL: `https://github.com/YOU/coach-<user>`
- Confirmation that `validate-repo.py` passed on the migrated data

---

## 2. Connect the shared dashboard

1. Open the **Coach Phelps** web app (Vercel deployment from `coach-phelps-hq`).
2. **Sign in with GitHub** and install the **Coach Phelps GitHub App** on your instance repo
   only (select just `coach-<user>`).
3. On first login the app resolves your repo via `training/challenge_v2.json` (marker file).

If you see “no repo found”, confirm the App is installed on the correct repo and that you
**own** it (not merely a collaborator).

---

## 3. Wire activity sync

### Option A — Strava (default)

1. Create a Strava API app at [strava.com/settings/api](https://www.strava.com/settings/api).
2. On your instance repo: **Settings → Secrets and variables → Actions**, add:
   - `PAT_TOKEN` — fine-grained PAT with Contents + Actions read/write on this repo
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`
3. Run the **Sync** workflow once (Actions tab → Sync → Run workflow).
4. Confirm `data/aggregate.json` appears on `main` with `"schema_version": 1`.

Local one-time history backfill (optional, ~1 year):

```bash
git clone git@github.com:YOU/coach-<user>.git && cd coach-<user>
pip3 install requests
python3 strava/oauth_reauth.py   # first-time only
python3 strava/fetch_strava.py --sync --since 2025-07-01
git add training/history && git commit -m "data: history backfill" && git push
```

### Option B — iOS / HealthKit

Use the Coach Phelps iOS app to push activities into `training/history/`. Strava secrets are
not required; set `sync_source` to `ios` in `training/sync_state.json` if provided.

---

## 4. Start coaching (BYO Claude)

```bash
git clone git@github.com:YOU/coach-<user>.git
cd coach-<user>
claude   # Claude Code — reads SOUL.md at boot
```

First session: Coach detects an empty Athlete Profile and runs **First Session Protocol**
(Layer C in `soul/C_athlete.md`).

Session data commits **directly to `main`** on your instance (`training/state.md`,
`training/challenge_v2.json`, `sessions/**`, etc.). CI validates contracts on push.

---

## 5. Day-to-day

| Action | Where |
|---|---|
| View dashboard | Shared site (loads your `data/aggregate.json`) |
| Coach session | Claude Code in your instance repo |
| Sync new activities | Dashboard Sync button, or Actions workflow, or iOS app |
| Quest progress | Auto-generated `training/quest_log.md` after sync |

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard empty after login | `data/aggregate.json` on `main`? App installed on your repo? |
| Sync workflow red | Strava secrets / `PAT_TOKEN`; workflow logs in Actions |
| Validator failed on commit | Run `python3 scripts/validate-repo.py --repo .` locally |
| Stale week plan | `training/current_week.json` — run `npm run validate-week` |

---

## Legacy self-host docs

The previous “clone monolith + deploy your own Vercel UI” flow is archived. See git history
before M1 or `docs/scaling-plan.md` for context.
