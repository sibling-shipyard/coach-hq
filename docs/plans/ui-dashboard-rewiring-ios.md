# UI dashboard rewiring — iOS (stacked PRs)

> Status: Current · Owner: iOS Builder · Verified: 2026-08-24
> Companion file: `ui-dashboard-rewiring-web.md` (web half of the same shim retirement — separate
> stack, separate owner, no shared PRs).

## Context

The coach-chat backend redesign shipped a full schema split
(`profile.json`/`memory.json`/`injuries.json`/`coach_log.json` +
`seasons.json`/`quests.json`/`progress.json`/`progressions.json`). On iOS, one surface still reads
the old shape directly instead of the new one: the day-count badge. `GitHubAPIClient.swift`'s
`readCoachDayAnchorDate()` reads `user_data/ledger/challenge_v2.json` straight off the repo and
decodes it into `ChallengeV2Summary`. Both live athlete repos (`coach-skanda`, `coach-akash`) are
now migrated to the split ledger, so this file no longer exists — the call 404s (a hard failure,
not a graceful fallback), regressing the same day-count bug ADR 0018 / issue #179 already fixed
once, on a different code path.

This is a much smaller surface than the web side (`ui-dashboard-rewiring-web.md`, 6 steps) — one
real fix plus its cleanup, still written as a small stack so it lands as reviewable, ordered PRs.
**Read this whole file before starting either step.** Whoever picks this up should be able to work
from this file alone.

**Decisions locked for this stack (shared with the web file, repeated here for anyone starting from
iOS):**
- Split-only is the target shape everywhere — no code should read or fall back to
  `challenge_v2`/`ChallengeV2` once this and the web stack are both done.
- Confirmed by research before this stack was written: the day-count badge is the **only** iOS
  surface reading `challenge_v2` directly. No other Swift file touches it. If that's changed by the
  time this is picked up, re-grep (`grep -rn "challenge_v2\|ChallengeV2" ios/`) before assuming
  step 1 is the whole scope.

## Step 1 — read `coach_since` from `profile.json` directly

*First in the stack, no dependency. Unblocks step 2.*

Files:
- `ios/CoachHQ/CoachHQ/Services/GitHubAPIClient.swift` — `readCoachDayAnchorDate()`
  (~lines 211-219). Stop reading `user_data/ledger/challenge_v2.json` / decoding
  `ChallengeV2Summary`. Read `profile.json`'s `coach_since` field directly instead — this is
  already the correct source per ADR 0018 (`coachDay.ts`'s `coachDayNumber()` does this
  server-side; the web fix in `ui-dashboard-rewiring-web.md` step 5 does the equivalent on that
  side). Actively called from `CoachChatView.swift` — confirm that call site doesn't need any other
  change beyond the new read.
- `UserFacingError.swift:66` — `raw.contains("challenge_v2")` string match stops matching once a
  repo is migrated (the string never appears in the new error paths). Update the match to whatever
  the new failure mode actually surfaces as, or remove it if no equivalent string-match is needed
  once step 1's read no longer hits a 404 in the normal case.

**Verification:** confirm the day-count badge shows the correct ADR 0018 `coach_since`-derived
value for both `coach-skanda` and `coach-akash` in a real build. Confirm no `readFile`
404/crash/error-state on badge load for either repo.

## Step 2 — clean up stale comments referencing the old read

*Depends on step 1. Finishing PR for this stack.*

Files with comments that describe the now-replaced `challenge_v2` read (confirmed stale as of
2026-08-21, re-check they're still stale before editing — code may have moved):
`CoachSetupState.swift:48`, `OnboardingHints.swift:36`, `CoachChatView.swift:39,43,488,662`,
`CoachChatPreviewData.swift:8`. Update or remove each to reflect the `profile.json`-based read from
step 1.

Doc upkeep, same PR: delete this file (`ui-dashboard-rewiring-ios.md`) once
`ui-dashboard-rewiring-web.md`'s stack has also shipped — if the web stack is still in progress,
leave both files in place until both are done, then delete together (per `AGENTS.md`'s "Plan
delete-on-last-PR" rule).

**Verification:** `grep -rn "challenge_v2\|ChallengeV2" ios/` returns nothing. Full grep across the
whole repo for `challenge_v2`/`ChallengeV2` (once both this file and `ui-dashboard-rewiring-web.md`
are done) returns nothing outside intentional historical docs (e.g.
`docs/eng-docs/challenge-v2-schema.md`, marked `Status: Historical`).

## Out of scope

- The web half of this exact bug and the whole rest of the dashboard rewire —
  `ui-dashboard-rewiring-web.md`.
- Any other iOS feature work — this stack is a rewire, not a redesign.
