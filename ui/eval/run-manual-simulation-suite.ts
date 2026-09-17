#!/usr/bin/env -S npx tsx
/**
 * run-manual-simulation-suite.ts - the fourth, tracked test type (vade-the-tester's original design plan
 * is gone now that its finishing PR landed - see kdb/decisions/0044-vade-the-tester-agent.md):
 * a small library of real FSP/daily-conversation `--turns` scenarios, run one at a time through
 * run-manual-coach-chat-test.ts's real pipeline (real SOUL, real athlete repo, real Gemini call,
 * real commit), scored against each scenario's own `expect` block, with one coverage-index.json
 * entry written per scenario afterward.
 *
 * I don't reimplement anything run-manual-coach-chat-test.ts already does - this drives it as a
 * child process (same way an athlete's own shell would run `npm run test:coach-chat-manual`) and
 * reads back the dated JSON log it already writes under test-results/raw/<date>/manual/. Scratch-branch
 * discipline (never main, never the repo's default branch) is enforced there, not duplicated
 * here - --branch is left unset by default so each scenario gets its own auto-named scratch
 * branch, same as any other manual run.
 *
 * `expect` here checks observed files changed (the real git diff run-manual-coach-chat-test.ts's
 * own log entry already carries, confidence: "observed"), not raw reply action fields the way
 * eval-coach-chat.ts's transcripts do - eval calls askGemini() directly and gets the raw parsed
 * reply back; this tool goes through the full commitTurn() response, which deliberately does not
 * echo action fields (see coachTurn.ts's commitTurn success response) - only reply text, thread
 * state, and repoSha. Checking the observed diff instead is not a downgrade: it's the ground-truth
 * side of the derived/observed distinction coach-chat-testing.md already draws, and it's the same
 * thing a human verifying a manual run by hand is told to check.
 *
 * Usage (from ui/):
 *   npm run test:simulation-suite -- --list
 *   npm run test:simulation-suite                       # run every scenario in the library
 *   npm run test:simulation-suite -- --only fsp          # substring-match on scenario id
 *   npm run test:simulation-suite -- --dry-run           # print what would run, call nothing
 *   npm run test:simulation-suite -- --force              # ignore coverage-index.json, run every
 *                                                          # case regardless of what changed since
 *                                                          # its last pass (a full pre-release run)
 *   npm run test:simulation-suite -- --repo akash         # override every scenario's own
 *                                                          # athlete/repo/localPath and run the
 *                                                          # suite once against that real repo
 *                                                          # instead of each scenario's hardcoded
 *                                                          # target
 *   npm run test:simulation-suite -- --all-repos          # run the whole suite once per real
 *                                                          # athlete repo in scripts/lib/athleteRepos.ts's
 *                                                          # ATHLETE_REPOS (5 passes today),
 *                                                          # overriding every scenario's target on
 *                                                          # each pass - replaces the old ad hoc
 *                                                          # "run run-manual-coach-chat-test.ts by
 *                                                          # hand against all 5 repos" pattern with
 *                                                          # one that still scores and records each
 *                                                          # pass. --repo and --all-repos are
 *                                                          # mutually exclusive; --only still
 *                                                          # narrows to one scenario id within
 *                                                          # whichever repo(s) are selected.
 *
 * Selective re-run: before actually running a case, this checks coverage-index.json for an
 * existing `status: "pass"` entry and, if one exists, runs `git diff --quiet <last_pass_sha> HEAD
 * -- <watched_paths...>` - an empty diff means nothing this case exercises has changed since it
 * last passed, so it's skipped (logged, not silent) rather than re-run for free. A case with no
 * entry, or `status: "fail"`, always runs. --force bypasses this check entirely.
 *
 * Needs GEMINI_API_KEY (or OPENROUTER_API_KEY under LLM_PROVIDER=openrouter) the same way
 * run-manual-coach-chat-test.ts does - checked once up front here so a missing key fails fast
 * with one clear message instead of one confusing failure per scenario.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProviderName } from "../api/_lib/llmClient.js";
import { slugify } from "../api/_lib/slugify.js";
import { dailyLogDir, repoRoot, type FilesChanged, type TestLogEntry } from "../scripts/lib/testLog.js";
import { formatCostUsd } from "../scripts/lib/llmPricing.js";
import { readCoverageIndex, writeCoverageEntry, coverageKey } from "../scripts/lib/coverageIndex.js";
import {
  ATHLETE_REPOS,
  resolveAthleteOverride,
  type AthleteOverride,
} from "../scripts/lib/athleteRepos.js";
import { buildRepoDataProfile } from "../scripts/lib/repoDataProfile.js";
import { checkPreconditions, type Preconditions } from "../scripts/lib/preconditions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(__dirname, "examples");

try {
  process.loadEnvFile(path.join(uiRoot, ".env.local"));
} catch {
  // fine if it doesn't exist - GEMINI_API_KEY may already be in the environment
}

/** One check against a single turn's log entry (matched by `turnIndex`). */
interface TurnExpect {
  turnIndex: number;
  /** Every one of these must appear as a substring of some changed file's path. */
  filesChangedInclude?: string[];
  /** None of these may appear as a substring of any changed file's path. */
  filesChangedExclude?: string[];
  /** Defaults to "PASS" - the harness's own per-turn result. */
  resultMustBe?: "PASS" | "ERROR";
}

interface Scenario {
  id: string;
  file: string;
  description: string;
  /** Passed straight through to run-manual-coach-chat-test.ts's own --athlete shortcut. */
  athlete?: string;
  /** Only when the athlete isn't one of that script's pre-registered shortcuts. */
  repo?: string;
  localPath?: string;
  /**
   * Checked against the target repo's real RepoDataProfile (scripts/lib/repoDataProfile.ts) before this
   * scenario ever calls the model - see docs/plans/coach-chat-test-harness-hardening.md's A2
   * section. An unmet precondition means the repo can't produce the behavior this scenario tests
   * right now (e.g. no planned session to contradict). A2b: when the unmet field carries a
   * `seedMessages` recipe, this sends that real conversation first and re-checks before deciding
   * - only a field with no recipe (or an unmet one that's still unmet after seeding) falls back
   * to skipping the model call entirely, instead of letting a fallback write pass a generic
   * `expect` check for the wrong reason - the real `ambiguous-contradiction` false positive that
   * motivated this.
   */
  preconditions?: Preconditions;
  /**
   * A3: --repo/--all-repos override every scenario's athlete/repo/localPath by default - but
   * fsp-basic's hardcoded target (coach-skanda-testing) isn't an arbitrary choice, it's the one
   * repo that's never completed the First Session Protocol, which is exactly what this scenario
   * tests. Forcing it onto a real, already-onboarded athlete repo wouldn't just give a
   * meaningless result - it would send scripted "first session" conversation content into a
   * real athlete's actual coaching history. Set this on any scenario whose hardcoded target is
   * load-bearing the same way, not just a convenient default.
   */
  excludeFromRepoOverride?: boolean;
  expect: TurnExpect[];
}

/** Resolves a scenario's local clone path the same way run-manual-coach-chat-test.ts would. */
function resolveLocalPath(scenario: Scenario): string | undefined {
  if (scenario.localPath) return scenario.localPath;
  if (scenario.athlete) return ATHLETE_REPOS[scenario.athlete]?.localPath;
  return undefined;
}

/**
 * Seeded from the FSP/daily example files already in examples/ (vade-the-tester plan's PR1 scope
 * - see kdb/decisions/0044-vade-the-tester-agent.md). No `-727-*` probe files here on purpose -
 * see docs/eng-docs/coach-chat-test-scenarios.md for the full scenario catalog and cut rationale;
 * a single/double-turn check for one specific #727 migration question doesn't belong in a
 * standing regression library.
 *
 * fsp.json runs against coach-skanda-testing, not coach-skanda/coach-akash - a First Session
 * Protocol scenario needs an athlete who hasn't done FSP yet (coachTurn.ts's `firstSession` gate
 * checks `isFirstSessionRitualDone`), and coach-skanda-testing is the one repo
 * docs/eng-docs/coach-chat-testing.md authorizes resetting to a blank state for exactly this. This
 * driver does not reset it itself - that's a separate, explicit step (same doc, "Resetting an
 * athlete repo to a genuinely fresh/blank state") - so running this scenario for real still needs
 * that reset done first if the repo isn't already blank.
 */
const SCENARIOS: Scenario[] = [
  {
    id: "fsp-basic",
    file: "manual-coach-chat-turns-fsp.json",
    description:
      "Full six-turn First Session Protocol - profile, goal, injury, training freq, wrap-up.",
    repo: "skanda-testing/coach-skanda-testing",
    localPath: "/home/skanda_suresh/Projects/coach-skanda-testing",
    // A3: coach-skanda-testing is load-bearing here, not a convenient default - it's the one
    // repo reset to a blank pre-FSP state, which is what this scenario needs to test the First
    // Session Protocol path at all.
    excludeFromRepoOverride: true,
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/coach/profile.json"] },
      { turnIndex: 3, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 5 },
    ],
  },
  {
    id: "daily-basic",
    file: "manual-coach-chat-turns-daily.json",
    description: "Ordinary daily check-in - weight update, hip soreness, a finished run, wrap-up.",
    athlete: "skanda",
    // repo is set explicitly (mirroring run-manual-coach-chat-test.ts's own ATHLETE_REPOS map)
    // so repoSlug below resolves to the same log-filename slug that script actually writes -
    // slugifying just "skanda" produced a slug ("skanda") that never matched the real log file
    // ("manual-coach-chat-skanda-2003-coach-skanda-2003-log-...ison"), a real bug caught by a
    // live run against a real repo, not by reading the code.
    repo: "skanda-2003/coach-skanda-2003",
    // #1105 B1: turn 1 also asserts coach_log.json (coach_note's write target) - coach_note fires
    // on nearly every ordinary turn (C2), and this is the first non-greet turn in the scenario, so
    // it closes the one acknowledged gap in the coverage matrix (coach-chat-test-scenarios.md) -
    // every other action field already has a real-write assertion somewhere in this file.
    expect: [
      {
        turnIndex: 1,
        filesChangedInclude: ["user_data/coach/profile.json", "user_data/coach/coach_log.json"],
      },
      { turnIndex: 2, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 3 },
      { turnIndex: 4 },
    ],
  },
  {
    id: "daily-sleep-skip",
    file: "manual-coach-chat-turns-daily-2.json",
    description:
      "Ordinary daily check-in - poor sleep, a skipped session, tomorrow's commitment, wrap-up.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    expect: [{ turnIndex: 1 }, { turnIndex: 2 }, { turnIndex: 3 }, { turnIndex: 4 }],
  },
  {
    id: "ambiguous-contradiction",
    file: "manual-coach-chat-turns-ambiguous-contradiction.json",
    description:
      "Athlete reports a planned session done, immediately contradicts it (wrong day), then confirms which one really happened - checks the coach reconciles rather than writing both versions.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // #1105 F1: this needs a real planned session on file to reconcile against - all 5 real
    // athlete repos currently have an empty (data_status: "placeholder") week plan, which is
    // exactly the false positive that motivated this precondition (see this doc's header comment).
    // A2b: rather than skip when unmet (every real repo's week is empty right now), seed a real
    // plan first - the same Weekly Kick-off Ritual request already proven in
    // examples/manual-coach-chat-turns-week-kickoff.json, plus a short real acknowledgment - so
    // whichever repo this runs against gets a real plan to reconcile against instead of relying
    // on a manually pre-seeded repo picked ahead of time.
    preconditions: {
      currentWeekHasSessions: {
        seedMessages: [
          "I don't have a plan for this week yet - go ahead and lay out the full week for me now, nothing unusual going on, just build it around my normal training.",
          "That looks good, let's go with that.",
        ],
      },
    },
    // The real bug this guards against: a contradiction landing as two conflicting current_week.json
    // writes (the wrongly-claimed session left "done" alongside a synthetically-created new session
    // for the real one) instead of one reconciled state - coachWeekFiles.ts's applyWeekPatch creates
    // a brand-new session whenever a patch entry omits session_id (deliberate, for a genuinely new
    // unplanned session - see that file's own comment), which is exactly the shape this scenario
    // could trigger if the reconciling turn doesn't reference the real existing session_id.
    // TurnExpect only checks which files changed, not their content (see this file's header comment
    // on why - commitTurn() doesn't echo action fields), so this can only verify that turn 3 (the
    // confirm/reconcile turn) actually produces a current_week.json write - it cannot verify from
    // here that the write is a clean single reconciled state rather than a duplicate. That's a real
    // gap in what this harness can check; a human should read the turn 3 log's real diff
    // (docs/eng-docs/coach-chat-testing.md, "Verifying a result") the first time this runs live.
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/ledger/current_week.json"] },
      { turnIndex: 3, filesChangedInclude: ["user_data/ledger/current_week.json"] },
    ],
  },
  // Coverage-audit phase 1 (2026-09-15) additions below - see
  // docs/eng-docs/coach-chat-test-scenarios.md's coverage matrix for what each one closes.
  {
    id: "workout-lifecycle",
    file: "manual-coach-chat-turns-workout-lifecycle.json",
    description:
      "workout_create then workout_remove in the same conversation, real-write coverage - both actions had zero simulation coverage before this (eval-only narration guards existed, no real commit had ever been checked).",
    athlete: "skanda",
    repo: "skanda-2003/coach-skanda-2003",
    // #1105 F2: workout_create's injury_ack invariant (coachReplySchema.ts) is required whenever
    // the athlete has any active flag - this scenario's turn 1 only exercises that path for real
    // on a repo that actually has one, otherwise there's nothing for the model to acknowledge.
    preconditions: { injuryFlags: "any" },
    expect: [
      { turnIndex: 1, filesChangedInclude: ["workout_plans/templates/_manifest.json"] },
      { turnIndex: 2, filesChangedInclude: ["workout_plans/templates/_manifest.json"] },
      { turnIndex: 3 },
    ],
  },
  {
    id: "session-plan",
    file: "manual-coach-chat-turns-session-plan.json",
    description:
      "session_plan real-write coverage - had zero live-tested coverage of any kind (docs/plans/coach-chat-redesign-followups.md's open item, no longer deferred now that the workouts redesign it was waiting on has shipped). Creates its own template first so the session_plan turn has a real template_id to reference.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    expect: [
      { turnIndex: 1, filesChangedInclude: ["workout_plans/templates/_manifest.json"] },
      { turnIndex: 2, filesChangedInclude: ["workout_plans/sessions/"] },
      { turnIndex: 3 },
    ],
  },
  {
    id: "week-kickoff-flash",
    file: "manual-coach-chat-turns-week-kickoff.json",
    description:
      "Weekly Kick-off Ritual malformation retest (docs/plans/coach-chat-redesign-followups.md: 3/5 JSON-parse failures found on Flash via OpenRouter, never reproduced on direct Pro). Run this one repeatedly (--only week-kickoff-flash, 5 times) under LLM_PROVIDER=openrouter to sample the real pass rate - a single run here only proves the happy path, it cannot establish a rate on its own. --force is needed on repeat runs since a passing entry would otherwise be skipped by the selective-re-run check.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    expect: [{ turnIndex: 1, filesChangedInclude: ["user_data/ledger/current_week.json"] }],
  },
  {
    id: "injury-resolve-by-bodypart",
    file: "manual-coach-chat-turns-injury-resolve-by-bodypart.json",
    description:
      "Real-write companion to eval transcript 14 - that transcript proves the model picks the right flag_id when disambiguating by body part, but nothing had ever checked the real injuries.json write. Self-contained: the first two turns mint the two flags this conversation later disambiguates between, rather than depending on whatever happens to already be on the target repo.",
    athlete: "skanda",
    repo: "skanda-2003/coach-skanda-2003",
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 2, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 3, filesChangedInclude: ["user_data/coach/injuries.json"] },
      { turnIndex: 4 },
    ],
  },
  {
    id: "pattern-style-sport",
    file: "manual-coach-chat-turns-pattern-style-sport.json",
    description:
      "Real-write companion to eval transcript 15 - memory_update (learned pattern), coaching_style_update, and sports_update all land in memory.json and had no simulation coverage at all before this.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // #1105: this scenario's real precondition is "starting coaching_style != the requested one"
    // (2026-09-15's pass found several repos skipped for real because they were already
    // "accountability", the style turn 2 asks for) - a plain boolean precondition can't express a
    // starting-value-not-equal-to-X check, only presence/absence, so this scenario deliberately
    // has no `preconditions` entry yet. A2b's richer seed-recipe shape is the right place for it.
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/coach/memory.json"] },
      { turnIndex: 2, filesChangedInclude: ["user_data/coach/memory.json"] },
      { turnIndex: 3 },
    ],
  },
  {
    id: "season-transition",
    file: "manual-coach-chat-turns-season-transition.json",
    description:
      "Real-write companion to eval transcript 10 - a returning athlete's season_start (with its bundled main_quest and new_habits) had no simulation coverage: nothing had ever checked that a real season/quest transition actually commits both seasons.json and quests.json.",
    athlete: "skanda",
    repo: "skanda-2003/coach-skanda-2003",
    expect: [
      {
        turnIndex: 1,
        filesChangedInclude: ["user_data/ledger/seasons.json", "user_data/ledger/quests.json"],
      },
      { turnIndex: 2 },
    ],
  },
  {
    id: "quest-event",
    file: "manual-coach-chat-turns-quest-event.json",
    description:
      "quest_event real-write coverage - progress.json had no simulation coverage at all: eval transcript 16 proves the model reports a completion, nothing had ever checked the real append-only write. Message deliberately references 'the daily habit' generically rather than a specific quest name, since the target repo's real active quest names aren't known ahead of a live run - see this repo's real quests.json before running for real, per coach-chat-testing.md's 'pick real content first' discipline.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // #1105 B2: needs a real daily-habit quest on file for "kept up with my daily habit again" to
    // have anything to anchor to - otherwise the model reasonably asks "which habit?" instead of
    // firing quest_event, and that clarifying question doesn't match this scenario's expect block.
    preconditions: { hasHabitQuest: true },
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/ledger/progress.json"] },
      { turnIndex: 2 },
    ],
  },
  // Coverage-audit phase 1 follow-up (issue #1066) - closing the 2 gaps left open in the first
  // pass, real-write companions to eval transcripts 11 and 21.
  {
    id: "quest-create-standalone",
    file: "manual-coach-chat-turns-quest-create-standalone.json",
    description:
      "quest_create (standalone) real-write coverage - eval transcript 11 already proves the model fires this reliably with no season change in the same message; this is the missing real-write check on the actual quests.json commit. Every real athlete repo already has an active season on file, which is exactly the right precondition here (not an obstacle) - the disambiguating signal is the message itself carrying zero season/goal language, not the repo's existing state.",
    athlete: "skanda",
    repo: "skanda-2003/coach-skanda-2003",
    expect: [
      { turnIndex: 1, filesChangedInclude: ["user_data/ledger/quests.json"] },
      { turnIndex: 2 },
    ],
  },
  {
    id: "template-edit-permanent",
    file: "manual-coach-chat-turns-template-edit.json",
    description:
      "template_edit real-write coverage - had never been asserted present anywhere (transcript 05 only proves the negative, that a one-day swap is week_update not template_edit). Creates its own template first, then asks for a permanent change to it, framed as 'going forward' / 'every time' to disambiguate against session_plan's 'just today' framing (covered separately by the session-plan scenario).",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // #1105 F2: same injury_ack invariant as workout-lifecycle above - turn 1 builds a routine
    // from scratch via workout_create, which needs an active flag on file to acknowledge for real.
    preconditions: { injuryFlags: "any" },
    expect: [
      { turnIndex: 1, filesChangedInclude: ["workout_plans/templates/_manifest.json"] },
      { turnIndex: 2, filesChangedInclude: ["workout_plans/templates/"] },
      { turnIndex: 3 },
    ],
  },
  {
    id: "multi-field-success",
    file: "manual-coach-chat-turns-multi-field-success.json",
    description:
      "B2 (#1105): two action fields landing together on the same turn, both correct - a single message asking for a permanent template_edit ('going forward') and a this-week-only week_update in one go. Every existing multi-field integration coverage (fullTurnPipeline.test.ts) only proves two fields failing together (a hallucinated template_id alongside a valid write); nothing before this proved two real fields can both commit cleanly from one turn.",
    athlete: "akash",
    repo: "akash-suresh/coach-akash-suresh",
    // template_edit needs a real existing template to point at - no real athlete repo is assumed
    // to already have the right one on file, so this seeds one first with a real workout_create
    // ask (same phrasing as template-edit-permanent's own turn 1) rather than relying on whatever
    // happens to already be there.
    preconditions: {
      hasTemplate: {
        seedMessages: [
          "Can you build me a full-body strength routine, no equipment, for twice a week?",
        ],
      },
    },
    expect: [
      {
        turnIndex: 1,
        filesChangedInclude: ["user_data/ledger/current_week.json", "workout_plans/templates/"],
      },
      { turnIndex: 2 },
    ],
  },
  // #1105 B3: probes whether #1085's memory_update drop (a durable fact stated alongside an
  // unrelated request, in the same message) is a narration-vs-action failure class rather than a
  // memory_update-specific one. Each probing turn bundles a structural, this-field-only request
  // with an unrelated, non-actionable remark (mirroring #1085's own turn 1 shape) and checks
  // whether the structural write actually lands, not just whether the reply claims it did. This
  // is explicitly an open question - memory_update's own drop on this shape stays an accepted,
  // separately tracked gap; it is not reopened here.
  {
    id: "compound-narration-probe",
    file: "manual-coach-chat-turns-compound-narration-probe.json",
    description:
      "New (#1105 B3): same compound-message shape that dropped memory_update (#1085), aimed at template_edit and week_update instead - a permanent per-day routine edit bundled with an unrelated sleep remark, then a this-week-only schedule move bundled with an unrelated weather remark. Not a known-good case: the expect block honestly reports whichever way each write goes.",
    athlete: "skanda",
    repo: "skanda-2003/coach-skanda-2003",
    // Reuses A2b's existing seed-recipe text verbatim (hasTemplate mirrors session-plan/
    // template-edit-permanent's own inline template-build message; currentWeekHasSessions is the
    // same recipe ambiguous-contradiction already uses) rather than writing new equivalent copies.
    preconditions: {
      hasTemplate: {
        seedMessages: [
          "Can you build me a simple full-body strength routine, no equipment, for twice a week?",
          "That looks good, thanks.",
        ],
      },
      currentWeekHasSessions: {
        seedMessages: [
          "I don't have a plan for this week yet - go ahead and lay out the full week for me now, nothing unusual going on, just build it around my normal training.",
          "That looks good, let's go with that.",
        ],
      },
    },
    expect: [
      { turnIndex: 1, filesChangedInclude: ["workout_plans/templates/"] },
      { turnIndex: 2, filesChangedInclude: ["user_data/ledger/current_week.json"] },
      { turnIndex: 3 },
    ],
  },
];

/** coach-hq paths that, if changed, could invalidate a scenario's last pass - coverage-index.json's watched_paths. */
const WATCHED_PATHS = [
  "ui/api/coach-chat.ts",
  "ui/api/coach-chat/_lib/coachTurn.ts",
  "ui/api/coach-chat/_lib/gemini/coachPromptText.ts",
  "ui/api/coach-chat/_lib/gemini/coachReplySchema.ts",
  "ui/api/coach-chat/_lib/gemini/geminiClient.ts",
  "ui/api/coach-chat/_lib/decide/turnWrites/",
  "ui/api/_lib/llmClient.ts",
  "ui/api/_lib/llmAdapters/",
];

interface ManualLogEntry extends TestLogEntry {
  turnIndex: number;
  filesChanged: FilesChanged;
  // #1053 gap 2: real per-turn cost, written by run-manual-coach-chat-test.ts now that
  // coachTurn.ts surfaces real usage - summed here so a scenario's console output shows real
  // spend, same number a day-doc's Simulation suite section reports.
  costUsd?: number;
}

function parseArgs(argv: string[]) {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  const repo = get("--repo");
  const allRepos = argv.includes("--all-repos");
  if (repo && allRepos) {
    console.error("run-manual-simulation-suite: --repo and --all-repos are mutually exclusive.");
    process.exit(1);
  }
  if (repo && !ATHLETE_REPOS[repo]) {
    console.error(
      `run-manual-simulation-suite: unknown --repo shortcut "${repo}" - expected one of: ${Object.keys(ATHLETE_REPOS).join(", ")}`,
    );
    process.exit(1);
  }
  return {
    list: argv.includes("--list"),
    only: get("--only"),
    dryRun: argv.includes("--dry-run"),
    // Bypasses the selective-re-run check below entirely - a full run before a release, an
    // explicit ask, not the default.
    force: argv.includes("--force"),
    // #1053 gap 3: overrides which scratch branch every selected scenario runs against, passed
    // straight through to run-manual-coach-chat-test.ts's own --branch. Needed for fsp-basic: it
    // runs against coach-skanda-testing, which needs a fresh reset onto a NEW scratch branch first
    // (docs/eng-docs/coach-chat-testing.md's reset procedure) - without this, the driver could
    // only ever run fsp-basic against an auto-named branch it creates itself, never the specific
    // already-reset one. Applies to every scenario the invocation selects (--only narrows to one
    // in practice) - there was no need for a per-scenario field in the SCENARIOS library above.
    branch: get("--branch"),
    // #1105 A3: forces every scenario's own athlete/repo/localPath to one real repo for this
    // invocation - see resolveAthleteOverride in scripts/lib/athleteRepos.ts for the shortcut lookup.
    repo,
    // #1105 A3: runs the whole suite once per real athlete repo in ATHLETE_REPOS instead of once
    // against whatever each scenario hardcodes - see the repo-pass loop in main() below.
    allRepos,
  };
}

interface CoverageEntry {
  type: string;
  last_pass_sha: string | null;
  last_run_date: string;
  watched_paths: string[];
  // #1105: "skipped-precondition" is distinct from "pass"/"fail" - the model was never called
  // because the target repo's real data couldn't produce the behavior this scenario tests, not
  // because anything succeeded or broke. `reason` carries which precondition field was unmet.
  // A2b adds "seed-failed": a seed recipe existed and was actually sent (real, billed turns), but
  // the re-check afterward still found the precondition unmet - distinct from "skipped-precondition"
  // because real cost was spent here, and distinct from "fail" because the scenario's own turns
  // never ran at all.
  status: "pass" | "fail" | "skipped-precondition" | "seed-failed";
  reason?: string;
  last_cost_usd?: number;
}

/**
 * True when HQ has changed anything under `watchedPaths` since `lastPassSha`. `git diff --quiet`
 * exits 0 (no diff -> execFileSync doesn't throw) or 1 (real diff -> throws) for a valid range;
 * any other failure (bad/unreachable sha, e.g. after a history rewrite) is treated as "changed" -
 * re-running an unnecessary case is cheap next to silently skipping a case that needs it.
 */
function watchedPathsChanged(lastPassSha: string, watchedPaths: string[]): boolean {
  try {
    execFileSync("git", ["diff", "--quiet", lastPassSha, "HEAD", "--", ...watchedPaths], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

function findLatestManualLog(repoSlug: string, sinceMs: number): string | undefined {
  const { dir } = dailyLogDir("manual");
  if (!fs.existsSync(dir)) return undefined;
  const prefix = `manual-coach-chat-${repoSlug}-log-`;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((c) => c.mtime >= sinceMs)
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? path.join(dir, candidates[0].f) : undefined;
}

function scoreScenario(
  scenario: Scenario,
  entries: ManualLogEntry[],
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const turnExpect of scenario.expect) {
    const entry = entries.find((e) => e.turnIndex === turnExpect.turnIndex);
    if (!entry) {
      failures.push(`turn ${turnExpect.turnIndex}: no log entry found`);
      continue;
    }
    const wantResult = turnExpect.resultMustBe ?? "PASS";
    if (entry.result !== wantResult) {
      failures.push(
        `turn ${turnExpect.turnIndex}: expected result ${wantResult}, got ${entry.result}`,
      );
    }
    const files = entry.filesChanged?.files ?? [];
    for (const want of turnExpect.filesChangedInclude ?? []) {
      if (!files.some((f) => f.includes(want))) {
        failures.push(
          `turn ${turnExpect.turnIndex}: expected a changed file matching "${want}", got [${files.join(", ")}]`,
        );
      }
    }
    for (const unwanted of turnExpect.filesChangedExclude ?? []) {
      if (files.some((f) => f.includes(unwanted))) {
        failures.push(
          `turn ${turnExpect.turnIndex}: expected no changed file matching "${unwanted}", got [${files.join(", ")}]`,
        );
      }
    }
  }
  return { pass: failures.length === 0, failures };
}

function currentHqSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

/**
 * A2b: sends a scenario's seed recipe - a synthetic greet turn plus each real message in
 * `seedMessages`, in order - through the exact same child-process path (run-manual-coach-chat-test.ts,
 * `--turns`) the scenario's own turns use below, on the same repo and the same scratch branch.
 * This is a real, separate multi-turn run: every message here is a real, billed model call, on
 * top of the scenario's own turns that follow if the re-check afterward passes (see this file's
 * cost-reporting at the end of main() - seed cost is tracked and printed separately from
 * scenario cost on purpose, not folded into it, per the A2b cost note).
 *
 * Returns the real cost spent (read back off the seed run's own log entry, same shape as a
 * scenario's log) and whether the child process finished without throwing - a hard failure here
 * doesn't necessarily mean nothing landed, but the caller re-checks the real profile either way
 * rather than trusting this flag.
 */
function sendSeedMessages(
  scenario: Scenario,
  seedMessages: string[],
  branch: string,
): { costUsd: number; ranCleanly: boolean } {
  const seedTurns = [{ greet: true, message: "" }, ...seedMessages.map((message) => ({ message }))];
  const seedPath = path.join(examplesDir, `.seed-${scenario.id}-${Date.now()}.json`);
  fs.writeFileSync(seedPath, JSON.stringify(seedTurns, null, 2));

  const scriptArgs = [
    "tsx",
    "--tsconfig",
    "tsconfig.json",
    "eval/run-manual-coach-chat-test.ts",
    ...(scenario.athlete ? ["--athlete", scenario.athlete] : []),
    ...(scenario.repo ? ["--repo", scenario.repo] : []),
    ...(scenario.localPath ? ["--local-path", scenario.localPath] : []),
    "--branch",
    branch,
    "--turns",
    seedPath,
  ];

  const repoSlug = slugify(scenario.repo ?? scenario.athlete ?? scenario.id, "-");
  const startMs = Date.now();
  let ranCleanly = true;
  try {
    execFileSync("npx", scriptArgs, { cwd: uiRoot, stdio: "inherit" });
  } catch {
    // Same as the scenario's own invocation below - a non-zero exit (an ERROR turn) doesn't mean
    // nothing happened; the seed's own log, read next, is the ground truth either way.
    ranCleanly = false;
  } finally {
    fs.rmSync(seedPath, { force: true });
  }

  const logPath = findLatestManualLog(repoSlug, startMs);
  if (!logPath) return { costUsd: 0, ranCleanly: false };
  const entries = JSON.parse(fs.readFileSync(logPath, "utf8")) as ManualLogEntry[];
  const costUsd = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  return { costUsd, ranCleanly };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const s of SCENARIOS) console.log(`${s.id} - ${s.description}`);
    return;
  }

  const scenarios = args.only ? SCENARIOS.filter((s) => s.id.includes(args.only!)) : SCENARIOS;
  if (scenarios.length === 0) {
    console.error(`run-manual-simulation-suite: no scenario matches --only "${args.only}".`);
    process.exit(1);
    return;
  }

  const usingOpenRouter = resolveProviderName(process.env) === "openrouter";
  const requiredKeyName = usingOpenRouter ? "OPENROUTER_API_KEY" : "GEMINI_API_KEY";
  const haveKey = Boolean(process.env[requiredKeyName]);
  if (!args.dryRun && !haveKey) {
    console.error(
      `run-manual-simulation-suite: ${requiredKeyName} not set (check ui/.env.local or export it) - ` +
        `every scenario here makes a real, paid Gemini call. Pass --dry-run to see the plan ` +
        `without spending anything, or set the key to actually run it.`,
    );
    process.exit(1);
    return;
  }

  const coveragePath = path.join(repoRoot, "test-results", "coverage-index.json");
  const coverageIndex = readCoverageIndex(coveragePath);
  const hqSha = currentHqSha();
  const today = new Date().toISOString().slice(0, 10);

  // #1105 A3: one "repo pass" per real athlete repo this invocation runs the suite against.
  // undefined means "no override - each scenario keeps its own hardcoded athlete/repo/localPath",
  // which is today's behavior and what --list/plain runs/--only alone still do. --repo runs a
  // single pass against one forced repo; --all-repos runs one pass per entry in ATHLETE_REPOS.
  let repoPasses: (AthleteOverride | undefined)[] = args.allRepos
    ? Object.keys(ATHLETE_REPOS).map((shortcut) => resolveAthleteOverride(shortcut))
    : args.repo
      ? [resolveAthleteOverride(args.repo)]
      : [undefined];

  // #1105 A3 follow-up: a real athlete repo in ATHLETE_REPOS isn't guaranteed to be cloned on
  // this machine - not every machine running this suite has all 5 checked out locally.
  // buildRepoDataProfile/the post-turn diff verification below both need a real local clone
  // (fs.readFileSync, git -C <path> fetch/diff); without this check, a missing clone's scenario
  // still runs, the turn itself succeeds via the GitHub API, and only the post-turn `git -C
  // <missing-path> fetch` throws - caught by the try/catch around the child-process invocation,
  // but reported as a hard failure rather than what it actually is (this repo just isn't
  // available on this machine). --all-repos runs on whichever repos ARE present and warns about
  // the rest; --repo <shortcut> for a repo that isn't cloned locally is a clear config error, not
  // something to silently skip - the operator explicitly asked for that one.
  if (args.allRepos) {
    const missing = repoPasses.filter(
      (pass) => pass && !fs.existsSync(pass.localPath),
    ) as AthleteOverride[];
    if (missing.length > 0) {
      console.log(
        `[all-repos] not cloned locally, skipping: ${missing.map((p) => `${p.athlete} (${p.localPath})`).join(", ")}.`,
      );
    }
    repoPasses = repoPasses.filter((pass) => !pass || fs.existsSync(pass.localPath));
    if (repoPasses.length === 0) {
      console.error(
        "run-manual-simulation-suite: --all-repos found no locally-cloned repo to run against.",
      );
      process.exit(1);
    }
  } else if (args.repo) {
    const [pass] = repoPasses;
    if (pass && !fs.existsSync(pass.localPath)) {
      console.error(
        `run-manual-simulation-suite: --repo ${args.repo} isn't cloned locally at ${pass.localPath}.`,
      );
      process.exit(1);
    }
  }

  let anyFailed = false;
  // A2b cost note: every seed message is a real, billed model call on top of the scenario's own
  // turns - tracked separately here and printed separately at the end, so it's visible rather
  // than hidden inside the per-scenario cost numbers above.
  let totalSeedCostUsd = 0;
  let totalSeedMessages = 0;
  for (const overridePass of repoPasses) {
    for (const scenario of scenarios) {
      // Every athlete/repo/localPath lookup below reads off this effective scenario, not the
      // library entry directly, so a --repo/--all-repos override reaches every code path (precondition
      // checks, seeding, the real invocation) the same way the scenario's own hardcoded target would.
      // fsp-basic's hardcoded target is load-bearing (see excludeFromRepoOverride's own doc
      // comment) - an active repo override has nothing honest to run it against, so skip this
      // pass/scenario combination entirely rather than force it onto the wrong repo.
      if (overridePass && scenario.excludeFromRepoOverride) {
        console.log(
          `[skip] ${scenario.id} [${overridePass.athlete}]: excluded from --repo/--all-repos - ` +
            `its hardcoded target is load-bearing, not a convenient default.`,
        );
        continue;
      }
      const effectiveScenario: Scenario = overridePass
        ? {
            ...scenario,
            athlete: overridePass.athlete,
            repo: overridePass.repo,
            localPath: overridePass.localPath,
          }
        : scenario;
      // Only a plain, unoverridden run (overridePass undefined) keeps today's bare key - it's
      // the only mode where a scenario still runs against its own hardcoded default repo, so it's
      // the only mode where an existing on-disk entry is describing the same thing this run would
      // produce. --repo and --all-repos both deviate from that default, so both disambiguate by
      // the override's athlete shortcut - conflating "ran against the scenario's own repo" and
      // "ran against an arbitrary --repo override" under one key was the actual bug here (a plain
      // --repo run used to silently share the unoverridden key, corrupting it for later runs).
      const key = coverageKey(scenario.id, overridePass?.athlete);
      // #1105 A3: only non-empty when a repo override is in play, so plain runs' output stays
      // exactly as it reads today.
      const repoTag = overridePass ? ` [${overridePass.athlete}]` : "";
      const existing = coverageIndex[key] as CoverageEntry | undefined;
      if (!args.force && existing?.status === "pass" && existing.last_pass_sha) {
        const watched = existing.watched_paths ?? WATCHED_PATHS;
        if (!watchedPathsChanged(existing.last_pass_sha, watched)) {
          console.log(
            `[skip] ${scenario.id}${repoTag}: no diff between ${existing.last_pass_sha.slice(0, 7)} and HEAD` +
              ` across ${watched.length} watched path(s) (${watched.join(", ")}); last passed` +
              ` ${existing.last_run_date}. Use --force to run anyway.`,
          );
          continue;
        }
      }

      // A2b: the branch the scenario itself runs against. Left as args.branch (possibly undefined,
      // in which case run-manual-coach-chat-test.ts auto-names one) unless this scenario needs
      // seeding first - seeding and the scenario's real turns must land on the SAME scratch branch,
      // so as soon as a seed is about to run, this is pinned to one explicit name shared by both.
      let scenarioBranch = args.branch;

      if (effectiveScenario.preconditions) {
        const localPath = resolveLocalPath(effectiveScenario);
        // No local clone to check against - can't verify the precondition either way, so fall
        // through to running it rather than silently skipping something we have no evidence about.
        if (localPath && fs.existsSync(localPath)) {
          const profile = buildRepoDataProfile(localPath);
          const { met, reason, seedMessages } = checkPreconditions(
            profile,
            effectiveScenario.preconditions,
          );
          if (!met && (!seedMessages || seedMessages.length === 0)) {
            // No seed recipe for this field - the only honest fallback left is A2's original skip
            // (real usage history can't be faked, or a different one of the 5 real repos already
            // satisfies it naturally and should be used instead of seeding this one).
            console.log(`[skip] ${scenario.id}${repoTag}: precondition unmet - ${reason}`);
            if (!args.dryRun) {
              writeCoverageEntry(coveragePath, key, {
                type: "manual",
                last_pass_sha: existing?.last_pass_sha ?? null,
                last_run_date: today,
                watched_paths: existing?.watched_paths ?? WATCHED_PATHS,
                status: "skipped-precondition",
                reason,
              });
            }
            continue;
          }
          if (!met && seedMessages && seedMessages.length > 0) {
            if (args.dryRun) {
              console.log(
                `[dry-run] ${scenario.id}${repoTag}: precondition unmet - ${reason}. Would send ${seedMessages.length} real seed message(s) then re-check, rather than spend anything for real.`,
              );
              continue;
            }

            scenarioBranch = scenarioBranch ?? `test/manual-seed-${scenario.id}-${Date.now()}`;
            console.log(
              `[seed] ${scenario.id}${repoTag}: precondition unmet - ${reason}. Sending ${seedMessages.length} ` +
                `real seed message(s) on ${scenarioBranch} before re-checking.`,
            );
            const seedResult = sendSeedMessages(effectiveScenario, seedMessages, scenarioBranch);
            totalSeedCostUsd += seedResult.costUsd;
            totalSeedMessages += seedMessages.length;
            console.log(
              `[seed] ${scenario.id}${repoTag}: seed run cost ${formatCostUsd(seedResult.costUsd)} for ` +
                `${seedMessages.length} real message(s) - billed separately from this scenario's own turns.`,
            );

            // buildRepoDataProfile reads whatever's on disk at localPath - the seed's commits
            // landed on scenarioBranch via the GitHub API, not on whatever branch this clone
            // happened to have checked out, so pull it down for real before re-checking. This
            // clone is shared across every scenario that targets the same repo (several SCENARIOS
            // entries reuse one athlete's localPath), so the checkout below must be temporary -
            // captured and restored right after the read, not left on scenarioBranch for the rest
            // of the run.
            const originalRef = execFileSync(
              "git",
              ["-C", localPath, "rev-parse", "--abbrev-ref", "HEAD"],
              { encoding: "utf8" },
            ).trim();
            let checkedOutForSeed = false;
            try {
              execFileSync("git", ["-C", localPath, "fetch", "origin", scenarioBranch], {
                stdio: "pipe",
              });
              execFileSync(
                "git",
                ["-C", localPath, "checkout", "-B", scenarioBranch, `origin/${scenarioBranch}`],
                { stdio: "pipe" },
              );
              checkedOutForSeed = true;
            } catch (err) {
              console.log(
                `[seed] ${scenario.id}${repoTag}: couldn't check out ${scenarioBranch} locally to re-check ` +
                  `(${err instanceof Error ? err.message : String(err)}) - treating the ` +
                  `precondition as still unmet.`,
              );
            }

            const reprofile = buildRepoDataProfile(localPath);

            if (checkedOutForSeed) {
              try {
                execFileSync("git", ["-C", localPath, "checkout", originalRef], { stdio: "pipe" });
              } catch (err) {
                console.log(
                  `[seed] ${scenario.id}${repoTag}: couldn't restore ${localPath} to ${originalRef} ` +
                    `after re-checking (${err instanceof Error ? err.message : String(err)}) - this ` +
                    `clone may be left on ${scenarioBranch} for later scenarios that share it.`,
                );
              }
            }

            const recheck = checkPreconditions(reprofile, effectiveScenario.preconditions);
            if (!recheck.met) {
              // The seed message is a real model call and can fail the same narration-vs-action way
              // any other turn can - proceeding anyway would silently recreate the exact bug this
              // whole track exists to fix, one layer deeper. Distinct status from
              // "skipped-precondition": real cost was spent here, so this counts against the run.
              console.log(
                `[seed-failed] ${scenario.id}${repoTag}: still unmet after seeding - ${recheck.reason}`,
              );
              anyFailed = true;
              writeCoverageEntry(coveragePath, key, {
                type: "manual",
                last_pass_sha: existing?.last_pass_sha ?? null,
                last_run_date: today,
                watched_paths: existing?.watched_paths ?? WATCHED_PATHS,
                status: "seed-failed",
                reason: recheck.reason,
                last_cost_usd: seedResult.costUsd,
              });
              continue;
            }
            console.log(
              `[seed] ${scenario.id}${repoTag}: precondition met after seeding - running the scenario's real turns.`,
            );
          }
        }
      }

      const turnsPath = path.join(examplesDir, scenario.file);
      const scriptArgs = [
        "tsx",
        "--tsconfig",
        "tsconfig.json",
        "eval/run-manual-coach-chat-test.ts",
        ...(effectiveScenario.athlete ? ["--athlete", effectiveScenario.athlete] : []),
        ...(effectiveScenario.repo ? ["--repo", effectiveScenario.repo] : []),
        ...(effectiveScenario.localPath ? ["--local-path", effectiveScenario.localPath] : []),
        ...(scenarioBranch ? ["--branch", scenarioBranch] : []),
        "--turns",
        turnsPath,
      ];
      if (args.dryRun) {
        console.log(`[dry-run] ${scenario.id}${repoTag}: would run - npx ${scriptArgs.join(" ")}`);
        continue;
      }

      console.log(
        `\n=== ${scenario.id}${repoTag} (running - ${existing ? "diff since last pass" : "no prior pass"}) ===`,
      );
      const repoSlug = slugify(
        effectiveScenario.repo ?? effectiveScenario.athlete ?? scenario.id,
        "-",
      );
      const startMs = Date.now();
      try {
        execFileSync("npx", scriptArgs, { cwd: uiRoot, stdio: "inherit" });
      } catch {
        // run-manual-coach-chat-test.ts exits non-zero on any ERROR/unconfirmed-audit turn - that's
        // not fatal to scoring here, the log it already wrote is what scoring reads next.
      }

      const logPath = findLatestManualLog(repoSlug, startMs);
      if (!logPath) {
        console.log(`${scenario.id}${repoTag}: no run log found - treating as a hard failure.`);
        anyFailed = true;
        writeCoverageEntry(coveragePath, key, {
          type: "manual",
          last_pass_sha: existing?.last_pass_sha ?? null,
          last_run_date: today,
          watched_paths: WATCHED_PATHS,
          status: "fail",
        });
        continue;
      }

      const entries = JSON.parse(fs.readFileSync(logPath, "utf8")) as ManualLogEntry[];
      const { pass, failures } = scoreScenario(scenario, entries);
      const scenarioCostUsd = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
      console.log(
        `${scenario.id}${repoTag}: ${pass ? "PASS" : "FAIL"} (log: ${path.relative(repoRoot, logPath)}, cost: ${formatCostUsd(scenarioCostUsd)})`,
      );
      for (const f of failures) console.log(`  - ${f}`);
      if (!pass) anyFailed = true;

      // #1076: write this scenario's entry now, re-reading the file fresh first, instead of
      // accumulating into the in-memory coverageIndex and writing it all back at the very end -
      // see coverageIndex.ts for why (concurrent runs were clobbering each other's writes).
      writeCoverageEntry(coveragePath, key, {
        type: "manual",
        last_pass_sha: pass ? hqSha : (existing?.last_pass_sha ?? null),
        last_run_date: today,
        watched_paths: WATCHED_PATHS,
        status: pass ? "pass" : "fail",
        last_cost_usd: scenarioCostUsd,
      });
    }
  } // end of repoPasses loop

  if (args.dryRun) return;

  if (totalSeedMessages > 0) {
    console.log(
      `\nSeed cost (A2b, on top of every scenario's own turns above): ${totalSeedMessages} real ` +
        `message(s), ${formatCostUsd(totalSeedCostUsd)} total.`,
    );
  }
  console.log(`\nCoverage index updates written to ${path.relative(repoRoot, coveragePath)}`);
  if (anyFailed) process.exit(2);
}

main();
