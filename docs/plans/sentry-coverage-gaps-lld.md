# Sentry Coverage Audit — Findings LLD

> Drill-down for `sentry-coverage-gaps.md`. Full inventory; the plan doc only summarizes.

Severity is the P0/P1/P2 scale from `AGENTS.md` § Priorities: P0 = fix now (fully silent, real
user impact), P1 = fix before calling this done (visible in logs/UI, not Sentry), P2 = flag
only, athlete's call.

A second (Cursor) review was cross-checked against this repo's actual code before folding
anything in — kept findings are marked **verified**; its references to an "audit § Definition
of done items 1-7" and a companion `sentry-coverage-audit.md` don't correspond to anything in
this repo, so that framing was dropped rather than trusted blind.

## Backend — `ui/api/` (owner: Bob the Builder)

| # | file:line | issue | sev |
|---|---|---|---|
| B1 | `coach-chat/_lib/coachTurn.ts:2398` | `commitTurn` write failure after a billed Gemini call → 502, `console.error` only. Sibling facts-commit catch 40 lines up *does* capture — inconsistency. | P0 |
| B2 | `coach-chat/_lib/commit/activitySyncTurn.ts:198-202` | Same pattern: commit fails after billed generation, no capture. Confirmed by own test asserting only status/body. | P0 |
| B3 | `auth/[...action].ts:285-293` | GitHub OAuth token-exchange failure → redirect, zero logging/capture (the `/user` failure 20 lines below does capture). | P1 |
| B4 | `auth/[...action].ts:661-663` | Installations-repo re-fetch failure silently falls back to `{repositories: []}` — athlete told "no owned repos" on a swallowed GitHub fault. | P1 |
| B5 | `coachTurn.ts:338`, `coach-chat.ts:69`, `activitySyncTurn.ts:80` | 3× "SOUL bundle unavailable" → 500, uncaptured. | P1 |
| B6 | `coach-chat.ts:194` | Missing Gemini/OpenRouter API key → 500, uncaptured. | P1 |
| B7 | `session.ts:140-142`, `auth/[...action].ts:429-431,251-252,121-131` | 4× "site misconfigured" 500s across the auth surface, uncaptured. | P1 |
| B8 | `coachTurn.ts:2285-2325` | First-session benchmark/first-week generation swallows every failure — silently blocks a new athlete's onboarding. | P1 |
| B9 | `coach-chat/_lib/decide/coachSinceStamp.ts:42-44,51-54` | Unparsable profile / failed merge-patch silently skips the `coach_since` stamp that triggers B8. | P1 |
| B10 | `coachChatFiles.ts:191-196`, `coachMessage.ts:401-408` | `parseJsonOrNull` used across 9 athlete data files — documented in-code as best-effort, but zero visibility, not in the runbook. | P2 |
| B16 | `coachChatFiles.ts:202-224` (`getHeadSha`) callers — `coach-chat.ts:161`, `activitySyncTurn.ts:53`, `coachTurn.ts:323` | `getHeadSha` throws with `.status` on any non-ok (verified). Every caller blanket `.catch(() => null)`, so a GitHub 5xx/network fault is indistinguishable from "branch doesn't exist yet" and never captured — unlike `getFileRaw`'s already-correct 404-vs-fault split. **Verified new from second review.** | P1 |
| B17 | `auth/_lib/session.ts:144-160` (`ensureFreshSession`) | Thrown network error during token-refresh falls back to the still-valid old session — correct behavior (issue #117), but zero logging/capture means a systemic GitHub outage is invisible until it surfaces as an unrelated 401 downstream. Same contract as I4 — see § Locked Decisions in the plan doc. | P1 |
| B11-B15 | merge-patch fallbacks, Gemini explicit-cache `.catch(()=>null)`, `corrupt_oauth_session` redirect | console.warn-only or fully silent, low blast radius / arguably intentional | P2 |

Confirmed **not** findings: `repo-file.ts`, `widget-snapshots.ts` fault paths, `decryptSession`,
`droppedActions` funnel, `githubGitData.ts` retries — all correctly captured already.

## Python pipeline — `engine/`, `scripts/` (owner: Bob the Builder)

No `sentry_sdk` anywhere; no Python dependency manifest exists in the repo at all. The only
signal today is `engine/scripts/notify_sync_failure.py`, a hand-rolled envelope POST that fires
once per **whole Sync workflow** failure (any step nonzero) — it knows "something died," never
which exception. Every other Python entry point (`regenerate_derived.py`,
`generate_quest_history.py`, `engine/lib/`, `engine/core/`, `platform/scripts/*.py`) has zero
error reporting. No ADR addresses this scope.

| # | file:line | issue | sev |
|---|---|---|---|
| PY1 | `engine/core/query_history.py:58` | Corrupt activity file silently dropped, no log, no count. | P1 |
| PY2 | `engine/core/vs_usual.py:87-90` | Same pattern for `vs_usual` enrichment. | P1 |
| PY3 | `engine/scripts/generate_quest_history.py:154-196` | Missing ledger → exits 0 writing `{"quests":{}}`, indistinguishable from "no quests." | P1 |
| PY4 | `engine/scripts/regenerate_derived.py:80-92` | `sync_status.json` counters hardcoded to 0 every run — the status file lies. | P1 |
| PY5 | `engine/.github/workflows/validate-data.yml` | Only `gen/widget_snapshots.json` has a shape-validation gate; `dashboard_snapshot`, `athlete_insights`, `quest_history`, `sync_status` have none. | P1 |
| PY6 | `platform/scripts/carve-skeleton.mjs:502-519` (`stampSyncDsn`, Node not Python) | Already `console.warn`s when `SENTRY_DSN` is unset at carve time, but the carve **still succeeds** — easy to stand up an athlete repo whose Sync alert silently never fires. **Verified new from second review, good catch.** Locked fix: fail closed by default, `--no-sentry` explicit opt-out for local/test carves — see plan doc § Locked Decisions. | P1 |
| PY7 | (operational, no single file) | Since carve historically only warned, some already-carved athlete repos may be missing the DSN today with no way to notice short of checking. Not a PR — a checklist once PY6 ships. See plan doc § Operational follow-ups. | P1 |

**Important nuance:** PY1-PY5 are correctness bugs, not Sentry gaps — nothing here throws, so
no amount of Sentry wiring catches them. They need to start raising/asserting on bad state
*before* Sentry coverage does anything for them. PY6/PY7 are different — they're why the one
signal the pipeline *does* have can go missing without anyone knowing.

## iOS — `ios/CoachHQ/` (owner: iOS Builder)

| # | file:line | issue | sev |
|---|---|---|---|
| I1 | `HealthKitSyncManager.swift:179-186` | `HKObserverQuery` error discarded — not even printed. Background sync can silently die. | P0 |
| I2 | `HealthKitSyncManager.swift:150-153` | Background-delivery registration failure, print-only. | P0 |
| I3 | `HealthKitSyncManager.swift:418-431` | `postActivitySync` retries forever on failure, never reported — no soft-continue safety net, the sync is just stuck. | P0 |
| I4 | `GitHubAuthManager.swift:515-550` | Token-refresh chain (401/502/exception) — print-only or fully silent. **Reclassified from P0**: `validToken()` falls back to the stale-but-valid token first (same soft-continue as B17); the eventual downstream 401 is already intentionally uncaptured by design (matches the documented session-expiry convention, `GitHubAPIClient.swift:102-114`). Same contract and fix as B17 — see plan doc § Locked Decisions. | P1 |
| I5 | `GitHubAuthManager.swift:396-415` | Keychain `SecItemAdd`/`SecItemDelete` status discarded on every token save — a failed *write* looks like a successful refresh until next launch. Not a soft-continue case (no stale-but-valid fallback exists here, the persisted state itself is corrupted) — stays P0. | P0 |
| I6 | `AppGroupSnapshotBridge.swift:26-35`, `WidgetSnapshotStore.swift:87` | Widget-data pipeline is entirely `try?`-guarded — any failure means stale/empty widgets forever, no signal. | P0 |
| I7 | `ios/CoachHQ/CoachHQWidget/*.swift` | Zero Sentry integration in the widget extension target — no `import Sentry` anywhere. **Reclassified from P0**: a broken/stale widget is visible on the home screen — not fully silent, doesn't clear the P0 bar on its own. | P1 |
| I8 | `CoachChatAPIClient.swift` (whole file) | Retry layer never reports to Sentry, unlike `GitHubAPIClient`'s equivalent — every Coach Chat network failure is blind at this layer. | P0 |
| I9-I15 | `GitHubAuthManager.swift` (coachAppInstalled, resolveRepoIfNeeded, fetchUser), `WorkoutService.swift` (4 methods), `CoachMessageAPIClient.swift` | print-only or fully silent catches | P1 |

## Frontend — `ui/client/` (owner: UI Expert)

Runbook claims two covered client fetches (`/api/auth/me`, `/api/repo-file`) — accurate, but
**nine more** `ui/api/` calls report nothing on failure, and it's Coach Chat's entire surface:

| # | file:line | issue | sev |
|---|---|---|---|
| F1 | `pages/CoachChat.tsx:188-201` | Activity-sync-to-chat failure: no toast, no console, no Sentry — pending thread just sits there. | P0 |
| F2 | `pages/CoachChat.tsx:414-416` | `fetchProfileStatus` failure: completely silent, `coachSince` quietly stays null. | P0 |
| F3 | `coachChatModel.ts` send/greet/threads (3 verbs) + `CoachChat.tsx` consumers | Toast/error-card shown to athlete, zero Sentry record. | P1 |
| F4 | `hooks/useWidgetSnapshots.ts:21-23`, `coachChatModel.ts:158-159` | Both `/api/widget-snapshots` call sites `.catch(()=>...)` silently. | P1 |
| F5 | `contexts/AuthContext.tsx:96-98` | `/api/auth/list-my-repos` failure → error page shown, cause never in Sentry. | P1 |
| F6 | `components/welcome/WelcomeInviteCta.tsx:38-40` | `/api/waitlist` failure → inline error copy, no Sentry. | P1 |
| F7 | localStorage cache read/write/scan (`coachChatModel.ts` ×4 sites) | Self-healing, low severity | P2 |

Not a Sentry gap but worth flagging: one global `ErrorBoundary` wraps the entire app (both
instances do report to Sentry) — no per-page/per-widget isolation, so any render crash takes
down the whole tree instead of degrading locally. Architecture item, not in this plan's scope.
