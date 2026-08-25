# User 3+ Onboarding Gate — cleared August 2026

> Status: Historical · Owner: Tech Lead · Verified: 2026-08-25 · Locked requirement: 2026-07-26 · Cleared: 2026-08-25 · ADR: [0030](../../kdb/decisions/0030-signup-is-ios-only.md)
>
> **This gate is closed.** Nats and Prateek both signed up on their own, with no operator
> involvement. Kept as the record of what the gate demanded and how it was actually met — the
> answer differs from the plan below, which is the point. For how signup works today, read
> [`github-auth.md`](github-auth.md) and ADR 0030. Nothing below describes the current system.

## What the gate demanded

M1 onboarding was operator-run: we provisioned repos, copied secrets, validated migrations. Fine
for Akash and Skanda. User 3 would have no operator. The requirement was that a net-new GitHub
account could get to a working dashboard and a coaching session with zero manual steps from us.

**Do-not-invite rule (now lifted):** friends were not to be invited until that was true.

## How it was actually met

Not the way this doc predicted. The plan below assumed we would give the GitHub App
`Administration` permission and create each athlete's repo server-side from a web sign-up page.
That is not possible — App tokens cannot create repos on a personal account (404/403 on
`/repos/{template}/generate` and `/user/repos`). Separately, a new athlete's first sync pulls a
year of Apple Health history, which only the phone can read.

So signup became iOS-only, and the athlete creates their own repo through GitHub's own
create-from-template page. `SetupView.swift` walks them through it and checks both conditions
(repo exists, App installed) against the GitHub API directly. See ADR 0030 for why this is a
decision and not a workaround.

| Gate item | Demanded | What shipped |
|---|---|---|
| No athlete-facing PAT | Required | Done (#189) — Sync and Apply Coach Patch run under `GITHUB_TOKEN` |
| Repo exists without an operator | Auto-create on sign-up | Athlete creates it from the template, guided in-app (`SetupView.swift`) |
| Sync works on day one | Required | Done — iOS commits history directly, Sync regenerates derived files |
| Dashboard loads | Required | Done — repo resolves via the `.coach-engine-version` marker |
| Athlete-facing docs | `SETUP.md` describes shared-site sign-up | Superseded — signup is in the app, not a doc |

## Exit test — passed

Two net-new athletes (Nats, Prateek) completed sign-up, repo creation, App install, first sync,
and a first coaching session without operator involvement, August 2026.

## What this gate never covered

Strava OAuth self-serve, plugin packs, coach-chat unification, and the persona rename — all
tracked separately and unaffected by the gate closing.
