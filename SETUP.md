# Setup Guide

This walks you through everything needed to get your own Coach Phelps running, from a completely blank start. No prior GitHub, API, or deployment experience assumed - every step spells out exactly what to click and what to type.

By the end you'll have:
- Your own copy of this repo on GitHub
- A working connection to your Strava account
- A live dashboard on Vercel that shows your training data
- An automated daily sync so new activities show up without manual work

Budget about 30-45 minutes for the whole thing, most of it waiting on you to click through account sign-ups.

**⚠️ You need Strava Premium (Summit).** Most of this repo depends on syncing your activity data from Strava, and that requires a paid Strava Premium subscription - a free Strava account is not enough. Confirm your subscription before starting section 3 below, since almost everything downstream (sync, the dashboard, the coach's context on your training) depends on it working.

**⚠️ You need a Claude Pro (or Max/Team/Enterprise) subscription to talk to your coach.** Coach Phelps runs as a Claude Code session (or a Claude.ai conversation) - actually talking to it, not just setting up the repo, requires an active paid Claude plan. Claude's free tier doesn't include enough usage for a real coaching conversation. See [claude.ai/upgrade](https://claude.ai/upgrade) if you don't already have one.

---

## 1. Create your GitHub repo

If you don't already have a GitHub account, create one at [github.com/signup](https://github.com/signup) - it's free.

1. Go to this template's repo page on GitHub.
2. Click the green **"Use this template"** button near the top, then **"Create a new repository"**.
3. Give it a name (e.g. `my-coach-phelps`), leave it **Public** or set it **Private** - either works, but note that Vercel's free tier deploys from both.
4. Click **Create repository**. This gives you your own independent copy - changes you make won't affect the original template, and updates to the template won't touch your repo.
5. Clone it to your machine:

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

Replace `YOUR_USERNAME` and `YOUR_REPO` with your actual GitHub username and the repo name you chose.

---

## 2. Create a GitHub Personal Access Token (PAT)

This repo uses a GitHub Actions workflow to sync your Strava data automatically. That workflow needs a token with permission to push commits back into your repo (the default token GitHub Actions gets doesn't have enough access for this).

1. Go to **github.com → click your profile picture (top right) → Settings**.
2. In the left sidebar, scroll all the way down to **Developer settings**.
3. Click **Personal access tokens → Fine-grained tokens**.
4. Click **Generate new token**.
5. Fill in:
   - **Token name:** something like `coach-phelps-sync`
   - **Expiration:** whatever you're comfortable with (90 days, 1 year, or no expiration - you can regenerate later if it expires)
   - **Repository access:** select **Only select repositories**, then choose the repo you just created
6. Under **Permissions → Repository permissions**, find and set:
   - **Contents:** Read and write
   - **Workflows:** Read and write
   (Leave everything else at its default "No access".)
7. Click **Generate token** at the bottom.
8. **Copy the token immediately** - it starts with `github_pat_...` and GitHub will never show it to you again after you leave this page. Paste it somewhere temporary (a notes app) until you use it in the next step.

### Add the token to your repo's secrets

1. Go to your repo on GitHub → **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. **Name:** `PAT_TOKEN`
4. **Value:** paste the token you copied.
5. Click **Add secret**.

---

## 3. Connect Strava

**⚠️ Requires Strava Premium (Summit).** A free Strava account is not enough to pull activity data through this repo's sync - you need an active Strava Premium subscription. If you don't have one, sign up (or start a trial) at [strava.com/premium](https://www.strava.com/premium) before continuing.

### Create a Strava API application

1. Log into [strava.com](https://www.strava.com) with your Premium account.
2. Go to [strava.com/settings/api](https://www.strava.com/settings/api).
3. Fill in the app creation form:
   - **Application Name:** anything, e.g. "My Coach Phelps"
   - **Category:** pick anything relevant, e.g. "Training"
   - **Website:** you can put your GitHub repo URL, or anything - it's not validated strictly
   - **Authorization Callback Domain:** `localhost`
4. Click **Create**.
5. You'll now see your **Client ID** and **Client Secret** on this page. Keep this page open, you'll need both values in a moment.

### Install Python dependencies

You need Python 3 installed. Check with `python3 --version` in your terminal - if that fails, install Python from [python.org](https://python.org) first.

```bash
pip3 install requests
```

### Set up local credentials

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor and fill in the two values from the Strava API page:

```
STRAVA_CLIENT_ID=your_client_id_here
STRAVA_CLIENT_SECRET=your_client_secret_here
STRAVA_REFRESH_TOKEN=
```

Leave `STRAVA_REFRESH_TOKEN` blank - the next step fills in your tokens automatically, in a separate `strava/strava_tokens.json` file rather than here. This `.env` file is git-ignored, so it stays on your machine only and never gets committed.

### Authorize your app

```bash
python3 strava/oauth_reauth.py
```

This opens a browser window asking you to log into Strava and authorize the app. Approve it. The script then saves your tokens automatically to `strava/strava_tokens.json` (also git-ignored - stays local) and fills in the refresh/access tokens.

### Test the connection

```bash
python3 strava/fetch_strava.py --last 3
```

You should see your last 3 Strava activities printed. If this fails, double check your `.env` values match exactly what's shown on the Strava API settings page.

### Add Strava credentials as repo secrets too

The automated daily sync (set up in step 5) runs in GitHub's cloud, not on your machine, so it needs its own copy of these credentials as repo secrets.

1. Go to your repo → **Settings → Secrets and variables → Actions**.
2. Add three more repository secrets (same screen as `PAT_TOKEN` above):
   - `STRAVA_CLIENT_ID` — same value as in your `.env`
   - `STRAVA_CLIENT_SECRET` — same value as in your `.env`
   - `STRAVA_REFRESH_TOKEN` — the refresh token that `oauth_reauth.py` saved to `strava/strava_tokens.json` (open that file locally to copy it)

### Customize your HR zones

Open `strava/README.md` and find the **HR Zone Reference** section. Fill in your max heart rate and zone boundaries - a simple estimate is max HR ≈ 220 minus your age, with Zone 2 upper bound at roughly 70% of max HR. This is used by the coach and dashboard to interpret your training load correctly.

---

## 4. Pull in your training history

Sync your recent activity history so the coach has context before your first conversation:

```bash
python3 strava/fetch_strava.py --sync --since YYYY-MM-DD
```

Replace `YYYY-MM-DD` with a date about 2-3 months back (e.g. `2026-04-18`). Activities save to `training/activities/history/` (git-ignored, stays local).

**No Strava, or don't want to sync history yet?** Skip this - the coach will just ask about your recent training during intake instead.

---

## 5. Deploy your dashboard to Vercel

Your repo includes a web dashboard (in `ui/`) that shows your training data, quest progress, and analytics. It deploys via [Vercel](https://vercel.com), a free hosting platform for this kind of app.

### Create a Vercel account

1. Go to [vercel.com/signup](https://vercel.com/signup).
2. Choose **Continue with GitHub** and authorize Vercel to access your GitHub account (you can restrict it to just this one repo during the authorization flow if you prefer).

### Import your repo

1. From the Vercel dashboard, click **Add New → Project**.
2. Find your repo in the list (search for its name if needed) and click **Import**.
3. On the configuration screen:
   - **Framework Preset:** Vite (should auto-detect)
   - **Root Directory:** click **Edit** and set it to `ui`
   - Leave **Build Command** and **Output Directory** as their defaults - `vercel.json` inside `ui/` already sets these correctly (`npm install && npm run build`, output to `dist`).

### Add environment variables

Still on the import/configuration screen (or afterward under **Project Settings → Environment Variables**), add:

| Name | Value |
|---|---|
| `GITHUB_REPO` | `your-github-username/your-repo-name` (e.g. `janedoe/my-coach-phelps`) |
| `GITHUB_WORKFLOW` | `sync.yml` |
| `GITHUB_PAT` | the same Personal Access Token you created in step 2 |

These power the "Sync" button in the dashboard, which triggers the GitHub Actions sync workflow remotely.

4. Click **Deploy**. Vercel builds and deploys the site - takes about a minute.

### Confirm it works

Open the URL Vercel gives you (something like `your-project.vercel.app`). The dashboard should load. Widgets and charts will be empty until you've synced Strava data - that's expected on a fresh setup. Click the **Sync** button in the dashboard, or manually trigger the workflow from **GitHub → your repo → Actions → Sync → Run workflow**, to pull in your data.

---

## 6. Start your first coaching session

**Claude Code (recommended):**
```bash
claude
```
Run this from inside your cloned repo folder. Requires a Claude Pro (or Max/Team/Enterprise) subscription - see the note at the top of this guide.

**Claude.ai:**
Upload `SOUL.md` and `training/coach/state.md` as attachments to a new conversation.

**On your phone:** see section 9 below to set up chatting with your coach from the Claude mobile app.

Coach Phelps detects the blank `training/coach/state.md` and automatically runs an intake conversation - no special prompting needed. During this first session the coach will:
- Review your Strava history silently before saying hello (if you synced it)
- Ask several intake questions conversationally (goals, timeline, coaching style preference, timezone, etc.)
- Confirm your profile back to you
- Write `training/coach/state.md` and `training/ledger/challenge_v2.json`
- Commit both files

---

## 7. Generate your quest log

After your first session:

```bash
python3 scripts/generate_quest_log.py
```

This produces `training/activities/quest_log.md`, your live progress dashboard. The coach reads this at the start of every future session so it always knows your current streaks and progress.

---

## 8. Set up automated daily sync (optional but recommended)

The `.github/workflows/sync.yml` workflow can run automatically instead of you triggering it manually every time. Since it's currently set to manual trigger (`workflow_dispatch`) only, if you want it on a schedule:

1. Open `.github/workflows/sync.yml`.
2. Under the `on:` section, add a `schedule:` trigger, e.g.:
   ```yaml
   on:
     workflow_dispatch:
     schedule:
       - cron: '0 6 * * *'   # runs daily at 6am UTC
   ```
3. Commit and push this change.

The workflow already has all the secrets it needs from steps 2 and 3 above (`PAT_TOKEN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`).

---

## 9. Chat with your coach from your phone (optional)

Claude's mobile app can run Claude Code sessions connected directly to a GitHub repo, so you can talk to Coach Phelps from your phone without opening a laptop. Requires the Claude Pro (or Max/Team/Enterprise) subscription mentioned at the top of this guide.

1. Install the **Claude** app ([iOS](https://apps.apple.com/app/claude/id6473753684) / [Android](https://play.google.com/store/apps/details?id=com.anthropic.claude)) and log in with the same account as your Claude Pro subscription.
2. In the app, open **Settings → Connectors** (sometimes shown as **Connected apps** or under the **Claude Code** section, depending on your app version) and choose **GitHub**.
3. Authorize the Claude GitHub App, then grant it access to your Coach Phelps repo specifically (or all repos, if you prefer) - GitHub will prompt you through this as an OAuth/App installation flow.
4. Back in the Claude app, start a new chat and switch it to **Claude Code** mode, then select your Coach Phelps repo from the connected repo list. This opens a session with the same repo context (`SOUL.md`, `training/`, etc.) as running `claude` locally.
5. Talk to your coach exactly like you would from the CLI - "hi coach", check in about training, close out your session, etc.

**If a phone session can't push commits directly** (mobile/remote sessions sometimes run in a more sandboxed environment than your local CLI), use the `apply-coach-patch.yml` workflow as a fallback:
1. At the end of the session, ask the coach for the `===FILE===`-delimited patch payload instead of asking it to push.
2. On GitHub, go to your repo → **Actions → Apply Coach Patch → Run workflow**.
3. Paste the payload into the `payload` input, adjust the commit message if you want, and click **Run workflow**. This commits and pushes the change on your behalf using the `PAT_TOKEN` secret from step 2.

---

## Troubleshooting

- **`oauth_reauth.py` doesn't open a browser / hangs:** Make sure port used by the local callback isn't blocked by a firewall. Try running it again.
- **Dashboard shows a blank page or build error on Vercel:** Double check **Root Directory** is set to `ui` in the Vercel project settings, and that all three environment variables are spelled exactly as shown above (case-sensitive).
- **Sync workflow fails in GitHub Actions:** Go to **Actions** tab, click the failed run, and check the logs. Almost always this means one of the four repo secrets (`PAT_TOKEN`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`) is missing or has an incorrect value.
- **Strava tokens expire:** Refresh tokens are long-lived and the sync scripts auto-refresh access tokens as needed. If something breaks, re-run `python3 strava/oauth_reauth.py` locally and update the `STRAVA_REFRESH_TOKEN` secret with the new value.

---

## Reference: all environment variables and secrets

| Name | Where it lives | Used for |
|---|---|---|
| `STRAVA_CLIENT_ID` | local `.env` + repo secret | Strava API authentication |
| `STRAVA_CLIENT_SECRET` | local `.env` + repo secret | Strava API authentication |
| `STRAVA_REFRESH_TOKEN` | `strava/strava_tokens.json` (auto-filled) + repo secret | Refreshing Strava access without re-authorizing |
| `PAT_TOKEN` | repo secret | Lets GitHub Actions push commits back to your repo |
| `GITHUB_REPO` | Vercel environment variable | Tells the dashboard which repo to trigger syncs on |
| `GITHUB_WORKFLOW` | Vercel environment variable | Which workflow file to trigger (`sync.yml`) |
| `GITHUB_PAT` | Vercel environment variable | Same value as `PAT_TOKEN`, used by the dashboard's Sync button |
