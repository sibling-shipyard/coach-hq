# How the Shared Coach Phelps Website Came Together

This is the story of how Skanda's and Akash's separate personal coaching dashboards became one
shared site (`coach-phelps-hq.vercel.app`), what problems came up along the way, and why the
non-obvious decisions were made the way they were. Written so either of you can come back to
this in six months — or so Akash, who wasn't in the room for most of this work, can actually
understand what changed and why, not just that it changed.

For what's still open or deliberately deferred until there's a friend #3, see
[`scaling_plan.md`](../scaling_plan.md) (parking lot) and [`engineering/scaling-plan.md`](engineering/scaling-plan.md)
(authoritative architecture).
The one thing still left to do in each personal repo — removing the now-redundant standalone
`ui/` and deployment — is tracked as an issue in each repo directly (not a doc, since it's a
single to-do, not an ongoing plan): [skanda-2003/coach-phelps#94](https://github.com/skanda-2003/coach-phelps/issues/94),
[akash-suresh/coach-phelps#158](https://github.com/akash-suresh/coach-phelps/issues/158).

## Why this happened

Skanda and Akash were both running their own personal fork of the same coach-phelps template,
each with its own deployment (Skanda on Vercel, Akash on Netlify). On June 30, Strava changed
its API terms in a way that broke free-tier activity syncing for both accounts at once. Skanda
paid for Strava Premium to keep his pipeline working. Akash took a different path — he built a
native iOS app that reads Apple HealthKit directly and commits activity data straight to GitHub,
bypassing Strava entirely.

That split was the trigger for a bigger question: instead of maintaining two increasingly
different personal deployments, why not build one shared site — and while doing that, build it
in a way that could eventually be handed to friends too, not just the two of you.

## The foundation: one org, one repo, "your data stays your repo"

A new GitHub org, originally named `coach-phelps-hq` and later renamed to `sibling-shipyard`
once you'd decided on a real name, was created with both of you as owners — not one person's
personal account hosting the other's data. `coach-phelps-hq` (already the more
genericized of the two personal repos) was transferred into it and became the repo the shared
site deploys from.

The core design principle that shaped almost everything else: **the shared site never becomes
the place where coaching data lives.** Each person's real training data — activity history,
challenge progress, sleep logs — stays in their own personal GitHub repo, exactly as before. The
shared site only reads it, live, from whoever's logged in. Nobody's data moves anywhere it
didn't already live.

## The four milestones

**1. Merging two diverged codebases into one.** Skanda's running-focused UI and Akash's
badminton-focused UI got merged into one shared frontend. The badminton match-analytics pages
Akash had built were kept and now ship to every user by default (not just his account) — no
per-user page configuration was built for this pass, since with only two real users it wasn't
worth the complexity yet. That's tracked as a future nice-to-have, not a gap that blocks
anything today.

**2. Login.** This went through two real iterations, not one. It started as a classic GitHub
OAuth App, which only supports "grant this app access to your entire GitHub account" — no way to
scope it to just one repo. That's an uncomfortably large ask for anyone who isn't already a
trusted collaborator, so it was migrated to a real **GitHub App**, which supports installing on
specific repos only, with an actual repo picker during setup. More correct for two people who
already trust each other, and the only reasonable choice once friends are the real audience.

**3. Live data, not baked into the build.** The old personal deployments each baked one person's
data into the site at build time — works fine for a single-user site, completely wrong for a
shared one. The fix: each person's own sync pipeline now publishes a single merged
`data/aggregate.json` file to their own repo, and the shared site fetches that file live, per
logged-in user, via GitHub's API. One real bug only showed up once this ran against real, full
activity history: GitHub's file-reading API silently fails to return the file content for
anything over roughly 1MB, and a real multi-year activity archive blows past that easily — fixed
by requesting the file in a different format that doesn't have that limit.

**4. Making sync work for both accounts through the shared site.** Covered in its own section
below — this one took two attempts to get right.

## The login bugs — the part that most affects Akash directly

Two real bugs surfaced once a second real account (Akash's) actually used the login flow — not
hypothetical edge cases, things that genuinely happened.

**First: a reinstall loop.** The sign-in button was accidentally pointed at GitHub's
*install/manage* screen instead of the actual sign-in screen, which meant even an
already-installed, already-logged-in user got shown the "pick which repo to install on" screen
every single time they visited. Fixed by pointing it at the correct GitHub endpoint.

**Second, more serious: Akash's very first login resolved to Skanda's data, not his own.** He'd
never installed the app on his own repo yet, but because he's a collaborator on Skanda's
personal repo, GitHub's API returned Skanda's installation as one of "his" — and the code
trusted that without checking who the installation actually belonged to. The fix required
checking not just *that* an installation existed, but that it was actually installed on the
logged-in user's own account. Two layers of this got fixed: the repo-selection logic was made to
only ever consider repos the logged-in user actually owns, and the installation-lookup itself
was fixed to require the account match, not just "does an installation with this app exist
somewhere I have visibility into."

That bug prompted a bigger, deliberate follow-up: rather than just patching this one case and
moving on, the whole login screen was redesigned around what it revealed. A single "Sign in"
button had been trying to do two different things — log in an existing user, or walk a
brand-new user through installing for the first time — and couldn't cleanly express both. It's
now two explicit buttons ("Log in" for existing users, "Sign up" for first-time or for adding a
second repo). Every error case that used to dump raw, unstyled JSON onto the screen (genuinely
this: an actual `{"error": "..."}` blob with nothing clickable) now shows a proper page
explaining what happened and what to do next. And anyone who owns more than one valid
coach-phelps repo can now switch between them without logging out.

## The dashboard crash — a real difference in how you two track progress, not a bug

After the login fixes landed, Akash's dashboard crashed white on first load. The cause: his real
coaching data uses a genuinely different progression model than Skanda's — a season, broken into
phases, broken into blocks, with separate milestone tracking — instead of Skanda's single
fixed-duration "challenge" with a start date and day count. The shared dashboard's components
assumed every account had Skanda's shape and crashed outright when a required field simply
wasn't there.

This wasn't treated as something to force into one shape. Every component that assumed the old
shape was made to tolerate a repo that doesn't have it, showing whatever data actually exists
instead of crashing. Separately, a small step was added to Akash's own sync pipeline that
derives a reasonable "current period" (his active phase and block, with real dates) purely for
display on the shared dashboard — his actual coaching data file itself was never touched or
restructured. One dashboard widget that had no real equivalent for his account
(a countdown-to-event banner) was removed from the shared site entirely, rather than kept as a
Skanda-only feature — a deliberate simplification in favor of a genuinely common baseline.

## Getting Akash's real sync working through the shared system

Akash's actual sync mechanism is his iOS app, not Strava — but his repo's automated pipeline
still tried Strava first, and a Strava failure was killing the *entire* pipeline before it ever
reached the steps that had nothing to do with Strava (regenerating his quest history, sleep log,
and the published aggregate file). Since he's not going back to Strava, that failure was made
non-fatal instead: it's now logged as an expected warning, and the rest of the pipeline runs
regardless.

Separately, and more importantly: his iOS app's commits weren't triggering the sync pipeline
*at all*. Checked directly against his app's actual code, not assumed — his pipeline was only
configured to watch for changes to a few specific files, and none of them were the ones his
phone actually writes to. Fixed the trigger to watch the right files. The result: every real
sync from his phone now automatically regenerates and publishes his dashboard data with zero
manual steps, which wasn't true before any of this.

## A real security incident, and how it was handled

While testing the Strava-pipeline fix locally, a mistake led to a real, if contained, security
incident: a shared credential cache on the local development machine (used to work on both
repos side by side) silently authenticated as Skanda instead of failing, because Akash's own
repo-level credential file had been temporarily moved aside for testing. That refreshed
credential got auto-committed into Akash's repo. Later, a real sync run used it and pulled 17 of
Skanda's actual Strava activities — including his photos — into Akash's repo.

This was caught, and fixed properly: the incorrect commit was reverted (verified byte-for-byte
against Akash's last legitimate commit), the credential file is no longer tracked in git at all
going forward, and Skanda's exposed credential was rotated at the source. A broader fix — removing
the shared-fallback mechanism from both repos' code entirely — was deliberately *not* done,
because Akash has permanently moved off Strava and the specific chain of events that caused this
can't recur for his account anymore. A real, live risk is worth engineering a proper fix for; one
that's already gone isn't worth the extra code to guard against.

## Making the sync button actually scale past two known people

Once repo resolution worked correctly, the "Sync" button on the dashboard still dispatched using
one shared bot credential belonging to Skanda's personal account. That only worked for Akash's
repo because Skanda already happened to be a manual collaborator on it — which isn't something
that extends to a future friend without an admin manually adding them as a collaborator on their
own private repo first. Recognized as the wrong design once actually asked "how would this work
for someone new," not just "does it work for the two people I already have."

The fix: the sync button now dispatches using *each logged-in user's own* access token — the
same one already issued to them at login, already scoped to exactly what they personally
installed the app on. No admin setup required for anyone, ever. This needed one additional
permission grant on the GitHub App (permission to trigger GitHub Actions workflows), which both
of you had to individually approve once. Verified against real GitHub Actions runs for both
accounts, including confirming Akash's sync works with zero special access from Skanda's account
on his repo — the actual proof this design doesn't have the old dependency anymore.

## Where things stand now

Unification is functionally complete and verified live against both real accounts: logging in,
viewing real synced data, and triggering a sync all work correctly and independently for each of
you. The one remaining piece from the original plan is retiring the two old standalone
deployments (Akash's Netlify site, Skanda's separate personal Vercel deployment) now that the
shared site fully replaces both.

Beyond that, everything intentionally left for "whenever there's a friend #3" — a public starter
repo for a brand-new person to fork, a couple of small UX rough edges, and a few GitHub
permissions that aren't needed until specific future features get built — is tracked in
[`scaling_plan.md`](../scaling_plan.md) and [`engineering/scaling-plan.md`](engineering/scaling-plan.md), not here.
