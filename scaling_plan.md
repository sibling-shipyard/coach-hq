# Scaling Coach Phelps Beyond Two People

**Status:** Website unification itself (Skanda + Akash, real shared site) is done — see
`docs/website-unification-history.md` for the full story of how it happened. This doc is the
parking lot for everything that only matters once there's a friend #3.

## What's still open

**No public repo for a brand-new friend to fork — blocks onboarding anyone new.** Every part of
the login/auth flow assumes the user already has a coach-phelps repo with `SOUL.md` and
`training/ledger/challenge_v2.json` in it — true for Skanda and Akash only because both started from
hand-built personal repos. Recommended approach: fork/scrub one of the two existing personal
repos into a clean public starter (keep `SOUL.md`, `templates/`, `scripts/`,
`.github/workflows/`, strip real training data and history) that a new friend forks, fills in
their own sync credentials, then installs Coach Phelps via "Sign up with GitHub." See
[issue #32](https://github.com/sibling-shipyard/coach-phelps-hq/issues/32).

**Auto-provisioning, as a fancier alternative to the manual-fork approach above.** Instead of a
new friend manually forking a starter repo, the shared site could call GitHub's API on their
behalf to instantiate `coach-phelps-hq` into a new repo automatically the first time they
log in with no repo yet — exactly what clicking "Use this template" does manually, automated.
Real engineering, not designed, and needs the **Administration** GitHub App permission (see
below). Two things fall out of building this that don't exist yet: **guided sync-source
setup** (walking a new user through picking Strava or the iOS path and writing the necessary
repo secrets on their behalf, instead of manual PAT-pasting — needs the **Secrets** permission,
real work since GitHub's repo-secrets endpoint requires client-side libsodium encryption), and
**stripping `ui/` from auto-provisioned repos** (the template-generate flow copies the *entire*
template including `ui/`, which is dead weight once the shared site is the only UI a new user
ever needs — either strip it right after provisioning or split into a data-only template).
None of this is needed while the manual-fork approach above is simpler and sufficient.

**Two GitHub App permissions identified but deliberately not requested yet** (Secrets,
Administration, both explained above) — noted here so a future permission change can bundle
them into one re-consent round for existing installations instead of asking Skanda and Akash to
click through GitHub's approval prompt separately each time. Current permissions, for reference:
Contents (Read and write) and Actions (Read and write) — see `docs/website-unification-history.md`
for what each is used for and why they were added.

**Per-user page configurability.** All three analytics pages (Run, Badminton, Badminton Match
Analytics) ship to every user today, no per-user toggle. Making page inclusion configurable is
tracked as [issue #13](https://github.com/sibling-shipyard/coach-phelps-hq/issues/13), not
designed yet.

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
  not inherited from repo collaboration — being added as a collaborator for code reasons
  doesn't imply consent to share personal training/sleep/coaching data. Not built — flagged
  only.

**Sync-source pluggability, informally already true, not yet documented as an explicit choice.**
Strava Premium and Akash's iOS/HealthKit app are both real, working sync sources today, and
downstream pipeline/UI code doesn't care which one produced `training/activities/history/*.json`. What's
still missing: a documented "choose your sync source" step in `SETUP.md` for a new user, and the
question of whether Akash's iOS app stays iOS-only or Android/other-platform sync becomes a
future ask. Not urgent — only matters once past friend #2-3.

## "Coach Phelps" Naming — Must Rename Before Any Public Launch

Surfaced while picking a name for the shared GitHub org. "Coach Phelps" is an unmistakable
reference to Michael Phelps — a specific, still-active, litigious-about-his-brand public figure
with his own commercial ventures in the same space (swim schools, a foundation, fitness/
supplement brands). That's a real legal exposure once this stops being private:

- **Right of publicity** — most US states (and many other countries) give a person legal control
  over commercial use of their name/identity, especially where it could suggest endorsement or
  affiliation. Applies even without using his photo — the name alone, used as a coaching
  persona, can be enough.
- **False endorsement (Lanham Act, in the US)** — separate federal claim if it reads like the app
  is "coached by" or affiliated with Michael Phelps when it isn't.
- **He actively defends his name commercially**, unlike a retired or lesser-known figure — raises
  both the odds of it being noticed and the seriousness of a response.

**Not a risk today** — private, non-commercial use between Skanda, Akash, and a couple of
friends is essentially zero exposure; nobody polices that. **Becomes a real risk the moment this
goes public-facing** — distributing something discoverable/shareable that uses a real
celebrity's name as the product persona.

**Action required before any public launch, not urgent yet:** rename the public-facing
persona/brand to something original, not tied to a real person. The coaching concept doesn't
need to change, just the name. Do this rename with plenty of runway — before friends #3+ have
"Coach Phelps" wired into their muscle memory, not after.

**GitHub org naming — done.** The org is now `sibling-shipyard` (renamed from the interim
`coach-phelps-hq`), picked specifically because it isn't tied to a real person — sidesteps the
whole Michael Phelps issue above for the org itself. Confirmed nothing functional broke: the
GitHub App, its install URLs, and the live site's domain (`coach-phelps-hq.vercel.app` — a
separate Vercel project name, untouched by the org rename) all kept working through the
redirect. Updated: local git remotes, and the handful of doc/code-comment references that
spelled out the old org name.

**Still pending — the repo name and the actual "Coach Phelps" product persona.** The org rename
happened on its own rather than bundled with these, so they're still open: `coach-phelps-hq`
itself is still named after the persona, and the coaching persona/character (`SOUL.md`, the
"Coach Phelps" name a user actually sees and talks to) hasn't been renamed at all yet — that's
the part with the actual legal exposure once this is public, not the org name. Renaming the repo
mostly handles itself (GitHub redirects git/issue URLs for a while, Vercel's Git integration
tracks the repo by internal ID so it survives a rename), but still needs manual follow-up:
local git remotes again, any hardcoded repo-name references, and Vercel's `.vercel.app` domain
— which is derived from the *project* name at creation time, not the repo name, and needs its
own separate rename if you want it to match. If the domain changes, the GitHub App's callback
URL needs updating too.

## IP Boundary vs. Local Claude Code — Deferred, Genuinely Unresolved

The whole coaching system runs on Claude Code reading `SOUL.md` (and the rest of the repo) from
the filesystem it's pointed at — there's no server-side "brain." That means "give a new user
only the minimal non-UI files, don't let them see SOUL.md / the coaching logic / how the rules
engine works" directly conflicts with "coaching runs locally on the user's own Claude Pro
subscription, no hosted LLM cost for us." You can't fully have both under the current
architecture.

Three options, none decided, none needed while it's just Skanda + Akash (nothing to protect from
each other):

1. **Accept it's not protectable in the local-Claude-Code model.** Anyone invited can read
   SOUL.md, fork it, run their own instance independent of you. Probably fine for a
   friends-and-family tool — the real "product" is the ongoing coaching relationship/tuning, not
   a defensible secret. A values call, not a technical one.
2. **Move coaching to a hosted chat surface**, SOUL.md stays server-side. Reopens the Claude Pro
   cost problem below — this is the option that pairs with the funding-path note.
3. **Hybrid — minimal data-only repo per user, private "brain" repo you control**, with a
   bootstrap step that fetches SOUL.md from the private source at session start rather than
   committing it to the user's repo. Real new engineering, undesigned.

Revisit before inviting friend #3, not before.

## Funding Path for a Future Hosted Chat Surface

Every user brings their own Claude Pro subscription today — centralizing that cost is "a real
ongoing expense, not a one-time engineering problem," so it's deliberately not solved. Worth
recording for whenever a hosted chat surface (IP Boundary option 2 above) gets picked up: pair
it with a cheaper model path than everyone's own Claude Pro — a Gemini free tier, or a metered
Claude API integration billed centrally instead of per-user subscriptions. Not designed, not
costed, just an idea to start from instead of re-deriving the option space from scratch later.

## Ownership

Confirmed: `coach-phelps-hq` (and any future hosted layer built on it) is jointly owned by
Skanda and Akash going forward — not one person's repo the other treats as upstream.
