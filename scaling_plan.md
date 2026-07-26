# Scaling Coach Phelps Beyond Two People — Parking Lot

> **Superseded for architecture:** the authoritative multi-tenant scaling plan is
> [`docs/scaling-plan.md`](docs/scaling-plan.md) (M0–M4 milestones, topology, SOUL split,
> server coach, validators). **This file** tracks open items that only matter once there's a
> friend #3 — operational detail and issue links not duplicated there.
>
> Website unification itself (Skanda + Akash, real shared site) is done — see
> [`docs/website-unification-history.md`](docs/website-unification-history.md).

---

## What's still open

**Automated onboarding for user 3+ — hard gate before inviting friends.** Skeleton + sign-up App
install exist; friends still hit manual `PAT_TOKEN` and operator provisioning. Full requirement:
[`docs/user-3-onboarding-gate.md`](docs/user-3-onboarding-gate.md). M4 self-serve (repo create +
secrets via App Administration + Secrets perms) or interim PAT-free `sync.yml` + auto repo on
sign-up.

**No public repo for a brand-new friend to fork — partially resolved.** Org template
`sibling-shipyard/coach-skeleton` is live (~50 files). Remaining gap is **auto-provision on website
sign-up**, not manual fork. See [issue #32](https://github.com/sibling-shipyard/coach-phelps-hq/issues/32).

**Open questions from the login-flow hardening, not yet decided or built:**

- **Multi-repo owners get re-prompted to pick every ~8h, not just on logout.** Sessions are
  stateless (encrypted cookie, no server-side storage) and expire after 8h
  (`SESSION_MAX_AGE_SEC` in `ui/api/_lib/session.ts`) regardless of whether the user actually
  logs out. Anyone who owns two valid coach-phelps repos re-derives from scratch each time a
  session starts, so the picker reappears every ~8h even if nothing changed. Possible fix: a
  longer-lived, separate "last picked repo" cookie that pre-selects (or skips) the picker,
  without weakening the 8h session-security window itself. Not built — flagged only.

- **Should collaborator access ever grant dashboard viewing, as an explicit feature?** Right
  now, being a GitHub collaborator on someone else's coach-phelps repo grants nothing — the
  App has to be installed on *your own* account, and even installation repo lists are filtered
  to repos you own. This was a deliberate fix for a real cross-account data leak (see
  `docs/website-unification-history.md`), not an oversight. The question of whether to
  *intentionally* support "share my dashboard with someone else" as a real feature is open.
  Recommendation if it's ever built: it should be an **explicit opt-in the repo owner grants**,
  not inherited from repo collaboration. (Also flagged in `docs/scaling-plan.md` §8.)

**Sync-source pluggability, informally already true, not yet documented as an explicit choice.**
Strava Premium and Akash's iOS/HealthKit app are both real, working sync sources today, and
downstream pipeline/UI code doesn't care which one produced `training/activities/history/*.json`. What's
still missing: a documented "choose your sync source" step in `SETUP.md` for a new user, and the
question of whether Akash's iOS app stays iOS-only or Android/other-platform sync becomes a
future ask. Not urgent — only matters once past friend #2-3.

---

## Naming & org — partial progress

**"Coach Phelps" persona rename — required before any public launch.** Legal exposure (right of
publicity, false endorsement) once this is shareable. Full analysis in `docs/scaling-plan.md` §8.

**GitHub org naming — done.** The org is now `sibling-shipyard` (renamed from the interim
`coach-phelps-hq`), picked specifically because it isn't tied to a real person. Confirmed nothing
functional broke: the GitHub App, its install URLs, and the live site's domain
(`coach-phelps-hq.vercel.app` — a separate Vercel project name, untouched by the org rename) all
kept working through the redirect.

**Still pending — the repo name and the actual "Coach Phelps" product persona.** `coach-phelps-hq`
itself is still named after the persona, and the coaching persona/character (`SOUL.md`, the
"Coach Phelps" name a user actually sees and talks to) hasn't been renamed yet. Renaming the repo
mostly handles itself (GitHub redirects git/issue URLs for a while, Vercel's Git integration
tracks the repo by internal ID) but still needs manual follow-up: local git remotes, any hardcoded
repo-name references, and Vercel's `.vercel.app` domain — derived from the *project* name at
creation time, not the repo name. If the domain changes, the GitHub App's callback URL needs
updating too.

---

## Ownership

Confirmed: `coach-phelps-hq` (and any future hosted layer built on it) is jointly owned by
Skanda and Akash going forward — not one person's repo the other treats as upstream.
