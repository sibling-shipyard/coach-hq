#!/usr/bin/env node
/**
 * Generates the raw RepoData-shaped golden dataset — activities, challenge_v2,
 * workouts, sync_status, sleep_log, quest_history, current_week — into
 * shared/golden-dataset/repo-data/. Unlike widget_snapshots.json (a static, pre-computed
 * layer for /welcome, /gallery, and iOS previews), this layer feeds the app's real
 * computation code (buildWarmHomeSnapshots, the sport-analytics lens models, streaks,
 * "this week" filters), and a lot of that logic keys off the real wall-clock `new Date()`.
 * So every date here is generated relative to "now", not hand-typed — it has to stay fresh
 * every time this runs, or streaks and "this week" silently go stale. Re-run this any time
 * (it's wired into ui's predev/prebuild); the output directory is gitignored.
 *
 * Randomness (misses, win/loss counts, HR noise, sleep hours) is seeded from today's calendar
 * date, so anyone running `npm run dev` on the same day gets the identical dataset — useful
 * for comparing notes on a specific bug — while it still moves forward day to day.
 *
 * Deliberately NOT a happy-path fixture: it includes blackout gaps, a stalled milestone, a
 * calisthenics floor miss, and a quest that hasn't started yet, so the app's edge-case UI
 * (streak resets, heatmap gaps, "floor not met," empty quest-rate states) can actually be
 * exercised locally, not just the all-green path. See shared/golden-dataset/README.md,
 * ADR-0005, ADR-0007.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_HR_ZONES } from "../../engine/lib/hrZones.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "repo-data");
const latestMessage = JSON.parse(
  readFileSync(path.join(__dirname, "latest_message.json"), "utf8"),
);

const NOW = new Date();

// Seeded by today's calendar date (not time), so everyone who runs `npm run dev` on the
// same day gets the identical dataset — useful for comparing notes on a specific bug —
// while still advancing day to day like a real athlete's history would.
function seedFromDate(date) {
  const str = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

// mulberry32 — small, deterministic PRNG. Good enough for fixture variety, not for anything
// security-sensitive.
function mulberry32(seed) {
  let s = seed;
  return function random() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seedFromDate(NOW));

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

// Strava-shaped local timestamp with a trailing "Z" that the UI's own parseLocal()
// deliberately strips (Strava quirk: "Z" suffix but it's actually local time).
function localTimestamp(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return `${toLocalDateStr(d)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function isoWeekId(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const daysSinceYearStart = Math.floor((date.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const week = Math.ceil(daysSinceYearStart / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function hrZones(seconds) {
  const [z1High, z2High, z3High, z4High] = DEFAULT_HR_ZONES;
  return {
    "Zone 1": { low: null, high: z1High, seconds: Math.round(seconds * 0.25) },
    "Zone 2": { low: z1High + 1, high: z2High, seconds: Math.round(seconds * 0.35) },
    "Zone 3": { low: z2High + 1, high: z3High, seconds: Math.round(seconds * 0.25) },
    "Zone 4": { low: z3High + 1, high: z4High, seconds: Math.round(seconds * 0.1) },
    "Zone 5": { low: z4High + 1, high: null, seconds: Math.round(seconds * 0.05) },
  };
}

// ─── Blackout blocks (illness / travel) ────────────────────────────────────
// Multi-day windows where NOTHING is logged, across every category. Without these the
// training-activity heatmap is 100% filled forever and the displayed foundation streak
// (`activityDayStreak` in warmHomeSnapshots.ts) never resets — neither is realistic, and
// both hide real UI states (heatmap gaps, a streak that isn't "since day one"). Kept out of
// the most recent 3 weeks so "this week" and the current streak still read as healthy.
const BLACKOUT_BLOCKS = [
  { startDaysAgo: 150, length: 3, excused: false }, // sick
  { startDaysAgo: 95, length: 2, excused: false }, // busy week, nothing logged
  { startDaysAgo: 35, length: 3, excused: true }, // travel — the excused one
];
const blackoutDates = new Set();
const excusedDates = [];
for (const block of BLACKOUT_BLOCKS) {
  for (let i = 0; i < block.length; i++) {
    const key = toLocalDateStr(daysAgo(block.startDaysAgo - i));
    blackoutDates.add(key);
    if (block.excused) excusedDates.push(key);
  }
}
function isBlackout(date) {
  return blackoutDates.has(toLocalDateStr(date));
}

// ─── Badminton match descriptions ──────────────────────────────────────────
// matchParser.ts requires a `Games:` marker and lines shaped
// `W <score> w/ <partner> vs <opponent>` — bare "W 21-18" lines (what an earlier version of
// this generator wrote) never populate `games`/`friendlies`, so head-to-head and "am I
// improving" stay permanently unavailable. A small recurring partner/opponent pool means the
// same opponent shows up often enough (≥3 games/year) for head-to-head to activate.
const PARTNER_NAME = "Jordan";
const OPPONENTS = ["Marcus", "Priya", "Chris", "Sam"];

function badmintonDescription(rw, rl) {
  const pct = Math.round((rw / (rw + rl)) * 100);
  const lines = [`${rw}W-${rl}L (${pct}%)`, "Games:"];
  const results = [
    ...Array.from({ length: rw }, () => "W"),
    ...Array.from({ length: rl }, () => "L"),
  ];
  // Interleave rather than all-wins-then-all-losses, closer to a real match log.
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [results[i], results[j]] = [results[j], results[i]];
  }
  for (const result of results) {
    const opponent = OPPONENTS[Math.floor(random() * OPPONENTS.length)];
    const myScore = result === "W" ? 19 + Math.round(random() * 4) : 12 + Math.round(random() * 6);
    const oppScore = result === "W" ? 12 + Math.round(random() * 6) : 19 + Math.round(random() * 4);
    lines.push(`${result} ${myScore}-${oppScore} w/ ${PARTNER_NAME} vs ${opponent}`);
  }
  return lines.join("\n");
}

// ─── Activities ─────────────────────────────────────────────────────────────
// ~26 weeks of history ending yesterday, so the training-activity heatmap, monthly
// analytics, and VO2 trend all have real depth to work with — not just the most recent week.
// Naming follows the exact patterns getTrainingCategory() matches on.

let nextId = 900000;
let badmintonRankedN = 40;
let badmintonFriendlyN = 60;
let foundationN = 120;
let calisthenicsN = 45;
let runN = 20;

const activities = [];

function pushActivity(a) {
  activities.push({
    id: nextId++,
    calories: 0,
    distance: 0,
    total_elevation_gain: 0,
    average_heartrate: null,
    max_heartrate: null,
    has_heartrate: false,
    hr_zones: null,
    description: null,
    max_speed: 0,
    device_name: "Golden Dataset",
    ...a,
  });
}

const WEEKS_OF_HISTORY = 26;
for (let w = WEEKS_OF_HISTORY; w >= 0; w--) {
  const weekStart = mondayOf(daysAgo(w * 7));

  // Foundation — short mobility/strength primer, most days but not every day. Skipped on
  // blackout days, plus a real per-day miss chance — a daily-habit quest still means real
  // rest days and the occasional skipped morning, not literally 365/365.
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + d);
    if (date > NOW) continue;
    if (isBlackout(date)) continue;
    if (random() < 0.55) continue;
    const seconds = 900 + Math.round(random() * 300);
    foundationN++;
    pushActivity({
      name: `Foundation #${foundationN}`,
      sport_type: "WeightTraining",
      start_date_local: localTimestamp(date, 7, 15),
      elapsed_time: seconds,
      moving_time: seconds,
      calories: Math.round(seconds / 8),
      average_heartrate: 118,
      max_heartrate: 142,
      has_heartrate: true,
      hr_zones: hrZones(seconds),
    });
  }

  // Badminton ranked — Monday evening, most weeks but not every week (no court, travel,
  // life) — a per-week chance on top of the blackout check, not a fixed weekly fixture.
  if (weekStart <= NOW && !isBlackout(weekStart) && random() < 0.55) {
    const date = new Date(weekStart);
    const seconds = 6300 + Math.round(random() * 900);
    badmintonRankedN++;
    const rw = 2 + Math.round(random() * 3);
    const rl = 1 + Math.round(random() * 3);
    pushActivity({
      name: `Badminton: Ranked #${badmintonRankedN}`,
      sport_type: "Badminton",
      start_date_local: localTimestamp(date, 19, 0),
      elapsed_time: seconds,
      moving_time: seconds,
      calories: Math.round(seconds / 6),
      average_heartrate: 148,
      max_heartrate: 176,
      has_heartrate: true,
      hr_zones: hrZones(seconds),
      description: badmintonDescription(rw, rl),
    });
  }

  // Badminton friendly — Thursday evening, roughly half the weeks.
  {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + 3);
    if (date <= NOW && !isBlackout(date) && random() < 0.35) {
      const seconds = 5400 + Math.round(random() * 900);
      badmintonFriendlyN++;
      const rw = 1 + Math.round(random() * 2);
      const rl = Math.round(random() * 2);
      pushActivity({
        name: `Badminton: Friendly #${badmintonFriendlyN}`,
        sport_type: "Badminton",
        start_date_local: localTimestamp(date, 19, 30),
        elapsed_time: seconds,
        moving_time: seconds,
        calories: Math.round(seconds / 6.5),
        average_heartrate: 138,
        max_heartrate: 165,
        has_heartrate: true,
        hr_zones: hrZones(seconds),
        description: badmintonDescription(rw, rl),
      });
    }
  }

  // Calisthenics — a per-week session-count roll (0/1/2) rather than a fixed Tue+Fri slot
  // every week. This is what actually produces organic "floor not met" weeks — not a couple
  // of hardcoded exceptions — while still landing near the 2/week target most of the time.
  const calisthenicsRoll = random();
  const calisthenicsSessionCount = calisthenicsRoll < 0.3 ? 0 : calisthenicsRoll < 0.65 ? 1 : 2;
  // For a 1-session week, pick Tuesday or Friday rather than always Tuesday — otherwise
  // every "light" week looks mechanically identical.
  const calisthenicsOffsets =
    calisthenicsSessionCount === 1 ? [random() < 0.5 ? 1 : 4] : [1, 4].slice(0, calisthenicsSessionCount);
  for (const offset of calisthenicsOffsets) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + offset);
    if (date > NOW) continue;
    if (isBlackout(date)) continue;
    const seconds = 2700 + Math.round(random() * 900);
    calisthenicsN++;
    pushActivity({
      name: `Calisthenics #${calisthenicsN}`,
      sport_type: "WeightTraining",
      start_date_local: localTimestamp(date, 18, 0),
      elapsed_time: seconds,
      moving_time: seconds,
      calories: Math.round(seconds / 7),
      average_heartrate: 128,
      max_heartrate: 158,
      has_heartrate: true,
      hr_zones: hrZones(seconds),
    });
  }

  // Easy ride — Saturday, most weeks.
  {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + 5);
    if (date <= NOW && !isBlackout(date) && random() < 0.4) {
      const seconds = 2200 + Math.round(random() * 600);
      pushActivity({
        name: "Easy Loop Ride",
        sport_type: "Ride",
        start_date_local: localTimestamp(date, 9, 0),
        elapsed_time: seconds,
        moving_time: seconds,
        distance: 12000 + Math.round(random() * 4000),
        calories: Math.round(seconds / 9),
        average_heartrate: 122,
        max_heartrate: 148,
        has_heartrate: true,
        max_speed: 11.2,
        hr_zones: hrZones(seconds),
      });
    }
  }

  // Sunday run — a per-week chance, not a fixed cadence, while still comfortably clearing the
  // "≥4 active weeks in trailing 8" band-availability threshold. Distance is tightly banded
  // around the same route so it clusters for the benchmark/PR lens, with an occasional
  // near-exact-5K "time trial" for standard-distance PB detection.
  {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + 6);
    if (date <= NOW && !isBlackout(date) && random() < 0.35) {
      const isTimeTrial = w % 5 === 0;
      // Route name intentionally has no run number in it — getTrainingCategory() falls back
      // to sport_type "Run" for categorization either way, and runningLensModel's route
      // clustering keys off the literal name text plus distance. Its "500m bucket" math
      // (`Math.round((distance / 500) * 500)`) is actually a no-op that resolves to the exact
      // meter value, so clustering needs an EXACT repeated distance, not just "close" — a
      // real GPS-recorded repeat of the same route. River Loop is fixed at exactly 5120m;
      // only the time trial's distance varies (a deliberate one-off effort, not a repeat).
      const distance = isTimeTrial ? 5000 + Math.round(random() * 60) : 5120;
      const pace = 320 - Math.round(random() * 20); // seconds per km, slow jog
      const seconds = Math.round((distance / 1000) * pace);
      runN++;
      pushActivity({
        name: isTimeTrial ? "5K Time Trial" : "River Loop",
        sport_type: "Run",
        start_date_local: localTimestamp(date, 8, 30),
        elapsed_time: seconds,
        moving_time: seconds,
        distance,
        calories: Math.round(seconds / 5.5),
        average_heartrate: isTimeTrial ? 168 : 152,
        max_heartrate: isTimeTrial ? 182 : 174,
        has_heartrate: true,
        max_speed: 4.1,
        hr_zones: hrZones(seconds),
      });
    }
  }
}

activities.sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

// ─── Challenge v2 (schema v4, ADR-0006) ─────────────────────────────────────

const seasonStart = daysAgo(WEEKS_OF_HISTORY * 7);
const seasonEnd = new Date(NOW);
seasonEnd.setDate(seasonEnd.getDate() + 90);
const blockStart = daysAgo(28);
const blockEnd = new Date(NOW);
blockEnd.setDate(blockEnd.getDate() + 14);

// Full history, not just the tail — monthlyAnalyticsModel computes a per-month completion
// rate from this, so trimming it to the last two weeks would make every earlier month look
// like a 0% miss streak even though foundation activities exist for it.
const foundationDates = activities
  .filter((a) => a.name.startsWith("Foundation #"))
  .map((a) => a.start_date_local.slice(0, 10));

// A second, recently-started daily_streak quest. Any month before its start date has zero
// eligible days for it, exercising monthlyAnalyticsModel's null-rate "not started yet" empty
// state — without disturbing Foundation's long, mostly-complete history.
const coldPlungeStart = daysAgo(21);
const coldPlungeMissed = [toLocalDateStr(daysAgo(4)), toLocalDateStr(daysAgo(11))];

// ADR 0018: coach_since seeded well before season.start_date, so local dev demonstrates a real
// athlete's day number NOT resetting when a new season starts (unlike season.start_date, which
// this fixture already rotates every so often as WEEKS_OF_HISTORY history rolls forward).
const coachSinceDate = daysAgo(WEEKS_OF_HISTORY * 7 + 90);

const ledger = {
  seasons: {
    current_season_id: "build-season",
    seasons: [
      {
        id: "build-season",
        name: "Build Season",
        start_date: toLocalDateStr(seasonStart),
        end_date: toLocalDateStr(seasonEnd),
      },
    ],
  },
  quests: {
    weekly_targets: {},
    main_quest: {
      id: "weekly-structured-sessions",
      name: "Weekly structured sessions",
      type: "weekly_floor",
      weekly_floor: 2.5,
      loaded_floor: 1,
      skill_weight: 0.4,
      skill_cap: 5,
      sessions: activities
        .filter((a) => a.name.startsWith("Badminton:") || a.name.startsWith("Calisthenics #"))
        .slice(-6)
        .map((a) => ({
          date: a.start_date_local.slice(0, 10),
          label: a.name,
          kind: a.name.startsWith("Badminton: Ranked") ? "loaded" : "skill",
          weight: a.name.startsWith("Badminton: Ranked") ? 1 : 0.5,
        })),
    },
    quests: [
      {
        id: "foundation",
        name: "Foundation",
        type: "daily_streak",
        category: "foundation",
        start_date: toLocalDateStr(seasonStart),
        end_date: null,
        status: "active",
        polarity: "default_not_done",
        tracking: "daily",
      },
      {
        id: "cold-plunge",
        name: "Cold Plunge",
        type: "daily_streak",
        category: "recovery",
        start_date: toLocalDateStr(coldPlungeStart),
        end_date: null,
        status: "active",
        polarity: "default_done",
        tracking: "daily",
      },
      {
        id: "mental-visualization",
        name: "Mental visualization",
        type: "progress",
        category: "mindset",
        start_date: toLocalDateStr(blockStart),
        end_date: null,
        status: "active",
        tracking: "count",
      },
      {
        id: "inner-game-of-tennis",
        name: "Inner Game of Tennis",
        type: "progress",
        category: "reading",
        start_date: toLocalDateStr(blockStart),
        end_date: null,
        status: "active",
        tracking: "count",
      },
    ],
  },
  progress: {
    rows: [
      ...foundationDates.map((date) => ({ quest_id: "foundation", date, status: "completed" })),
      ...excusedDates.map((date) => ({ quest_id: "foundation", date, status: "excused" })),
      ...coldPlungeMissed.map((date) => ({ quest_id: "cold-plunge", date, status: "missed" })),
      { quest_id: "mental-visualization", date: toLocalDateStr(daysAgo(1)), status: "completed", value: 2 },
      { quest_id: "inner-game-of-tennis", date: toLocalDateStr(daysAgo(1)), status: "completed", value: 3 },
    ],
  },
  progressions: {
    milestones: [
      {
        id: "fl_single_leg",
        name: "Front lever",
        baseline: "8S",
        current: "9S",
        target: "FULL 5S",
        short_name: "Front lever",
        short_current: "9S",
        short_target: "FULL 5S",
        progress: {
          unit: "s",
          baseline_value: 8,
          current_value: 9,
          target_value: 25,
          history: [
            { date: toLocalDateStr(daysAgo(56)), value: 8 },
            { date: toLocalDateStr(daysAgo(28)), value: 8.5 },
            { date: toLocalDateStr(daysAgo(7)), value: 9 },
          ],
        },
      },
      {
        id: "handstand_free",
        name: "Freestanding handstand",
        baseline: "6S",
        current: "6S",
        target: "15S",
        progress: {
          unit: "s",
          baseline_value: 6,
          current_value: 6,
          target_value: 15,
        },
      },
      {
        id: "weighted_pullups",
        name: "Weighted pull-ups",
        baseline: "BW",
        current: "BW+12KG",
        target: "BW+20KG x 5",
        progress: {
          unit: "kg",
          baseline_value: 0,
          current_value: 12,
          target_value: 20,
          history: [
            { date: toLocalDateStr(daysAgo(70)), value: 4 },
            { date: toLocalDateStr(daysAgo(49)), value: 6 },
            { date: toLocalDateStr(daysAgo(28)), value: 9 },
            { date: toLocalDateStr(daysAgo(7)), value: 12 },
          ],
        },
      },
    ],
  },
};

// ─── Workouts ────────────────────────────────────────────────────────────────

function exercise(num, name, opts) {
  return { num, name, type: "reps", sets: 3, form_cue: "Keep the movement clean.", why: "Builds the pattern the sessions rely on.", ...opts };
}

const templates = [
  {
    id: "foundation-am",
    title: "Foundation — AM Primer",
    subtitle: "Daily mobility + activation",
    workout_type: "foundation",
    estimated_duration_mins: 15,
    location: "Home",
    equipment: [],
    coaching_note: "Easy range, no forcing.",
    phases: [
      {
        name: "Primer",
        duration: "15 min",
        default_rest_secs: 20,
        exercises: [
          exercise(1, "Hip openers", { type: "timed", duration_secs: 60, sets: 2 }),
          exercise(2, "Dead hang", { type: "timed", duration_secs: 30, sets: 3 }),
          exercise(3, "Band pull-aparts", { type: "reps", reps: 15, sets: 3 }),
        ],
      },
    ],
  },
  {
    id: "calisthenics-pull",
    title: "Calisthenics — Pull + Handstand",
    subtitle: "Front lever and handstand work",
    workout_type: "calisthenics",
    estimated_duration_mins: 50,
    location: "Home bar",
    equipment: ["Pull-up bar", "Rings"],
    coaching_note: "Stop one clean rep before grind.",
    phases: [
      {
        name: "Front lever",
        duration: "20 min",
        default_rest_secs: 90,
        exercises: [exercise(1, "Tuck front lever hold", { type: "timed", duration_secs: 9, sets: 5 })],
      },
      {
        name: "Handstand",
        duration: "20 min",
        default_rest_secs: 60,
        exercises: [exercise(1, "Wall handstand hold", { type: "timed", duration_secs: 20, sets: 5 })],
      },
    ],
  },
  {
    id: "calisthenics-core",
    title: "Calisthenics — Core + L-sit",
    subtitle: "Core compression and hollow body work",
    workout_type: "calisthenics",
    estimated_duration_mins: 35,
    location: "Home bar",
    equipment: ["Parallettes"],
    coaching_note: "Ribs down the whole set — quality over duration.",
    phases: [
      {
        name: "Compression",
        duration: "20 min",
        default_rest_secs: 60,
        exercises: [
          exercise(1, "L-sit hold", { type: "timed", duration_secs: 15, sets: 5 }),
          exercise(2, "Hollow body hold", { type: "timed", duration_secs: 30, sets: 3 }),
        ],
      },
    ],
  },
  {
    id: "strength-a",
    title: "Strength A",
    subtitle: "Lower body + core",
    workout_type: "strength",
    estimated_duration_mins: 40,
    location: "Gym",
    equipment: ["Barbell", "Rack"],
    coaching_note: "Bar speed over bar weight today.",
    phases: [
      {
        name: "Main lifts",
        duration: "30 min",
        default_rest_secs: 120,
        exercises: [
          exercise(1, "Back squat", { type: "reps", reps: 5, sets: 4 }),
          exercise(2, "Romanian deadlift", { type: "reps", reps: 8, sets: 3 }),
        ],
      },
    ],
  },
  {
    id: "strength-b",
    title: "Strength B",
    subtitle: "Upper body push + pull",
    workout_type: "strength",
    estimated_duration_mins: 40,
    location: "Gym",
    equipment: ["Barbell", "Bench", "Pull-up bar"],
    coaching_note: "Full lockout on every rep, no half reps for volume.",
    phases: [
      {
        name: "Main lifts",
        duration: "30 min",
        default_rest_secs: 120,
        exercises: [
          exercise(1, "Bench press", { type: "reps", reps: 5, sets: 4 }),
          exercise(2, "Weighted pull-up", { type: "reps", reps: 6, sets: 3 }),
        ],
      },
    ],
  },
  {
    id: "recovery-flow",
    title: "Recovery Flow",
    subtitle: "Full-body mobility reset",
    workout_type: "recovery",
    estimated_duration_mins: 20,
    location: "Home",
    equipment: ["Mat"],
    coaching_note: "Nothing here should be hard.",
    phases: [
      {
        name: "Flow",
        duration: "20 min",
        default_rest_secs: 15,
        exercises: [exercise(1, "Cat-cow", { type: "timed", duration_secs: 60, sets: 1 })],
      },
    ],
  },
];

const sessions = [
  { ...templates.find((t) => t.id === "calisthenics-pull"), session_date: toLocalDateStr(NOW), based_on_template: "calisthenics-pull" },
  { ...templates.find((t) => t.id === "foundation-am"), session_date: toLocalDateStr(daysAgo(-1)), based_on_template: "foundation-am" },
];

const workouts = { templates, sessions };

// ─── Sync status ─────────────────────────────────────────────────────────────

const syncStatus = {
  timestamp: NOW.toISOString(),
  status: "ok",
  warnings: [],
  activities_synced: activities.length,
  activities_renamed: 0,
  descriptions_parsed: activities.filter((a) => a.description).length,
  commit_message: "Golden dataset — generated for local dev",
};

// ─── Sleep log (unconsumed today, minimal) ──────────────────────────────────

const sleepLog = Array.from({ length: 14 }, (_, i) => {
  const date = daysAgo(13 - i);
  return { date: toLocalDateStr(date), hours: 6.5 + Math.round(random() * 20) / 10, quality: "good" };
});

// ─── Quest history (unconsumed today, minimal) ──────────────────────────────

const questHistory = {
  generated_at: NOW.toISOString(),
  quests: {
    foundation: { completed_dates: foundationDates },
  },
};

// ─── Current week (raw layer — date-relative, distinct from the static
// shared/golden-dataset/current_week.json used by /welcome, /gallery, iOS) ──
// Live + populated so local /workouts demos today + this week + library (A5).

const GOLDEN_TIMEZONE = "Europe/London";

function plannedSession(date, opts) {
  const {
    discipline,
    kind,
    title,
    templateId = null,
    durationMin,
    priority = "anchor",
    status = "planned",
    coachNote = null,
  } = opts;
  return {
    id: `${date}-${discipline}-golden`,
    origin: "planned",
    discipline,
    kind,
    title,
    priority,
    status,
    planned_duration_min: durationMin,
    planned_load: null,
    template_id: templateId,
    session_file: null,
    coach_note: coachNote,
    original_date: null,
    completion_activity_ids: [],
  };
}

const weekMonday = mondayOf(NOW);
const weekStartStr = toLocalDateStr(weekMonday);
const weekEnd = new Date(weekMonday);
weekEnd.setDate(weekEnd.getDate() + 6);
const weekEndStr = toLocalDateStr(weekEnd);
const todayStr = toLocalDateStr(NOW);
const todayOffset = Math.min(6, Math.max(0, daysBetween(weekStartStr, todayStr)));

/** Offset → sessions for that day. Today always gets the runnable calisthenics slot. */
const weekPlanByOffset = {
  0: [
    plannedSession(weekStartStr, {
      discipline: "badminton",
      kind: "competitive",
      title: "Ranked court",
      durationMin: 90,
      priority: "anchor",
      coachNote: "Hold quality when the score tightens.",
    }),
  ],
  1: [
    plannedSession(addDaysLocal(weekStartStr, 1), {
      discipline: "strength",
      kind: "strength",
      title: "Strength A",
      templateId: "strength-a",
      durationMin: 40,
      priority: "support",
    }),
  ],
  3: [
    plannedSession(addDaysLocal(weekStartStr, 3), {
      discipline: "badminton",
      kind: "friendly",
      title: "Friendly court",
      durationMin: 90,
      priority: "anchor",
    }),
  ],
  4: [
    plannedSession(addDaysLocal(weekStartStr, 4), {
      discipline: "cycling",
      kind: "endurance",
      title: "Easy spin",
      durationMin: 50,
      priority: "optional",
    }),
  ],
};

function addDaysLocal(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

weekPlanByOffset[todayOffset] = [
  plannedSession(todayStr, {
    discipline: "calisthenics",
    kind: "strength",
    title: "Calisthenics — Pull + Handstand",
    templateId: "calisthenics-pull",
    durationMin: 50,
    priority: "support",
    coachNote: "Stop one clean rep before grind.",
  }),
];

const intents = ["train", "recovery", "train", "train", "open", "rest", "review"];

const currentWeek = {
  schema_version: 1,
  data_status: "live",
  timezone: GOLDEN_TIMEZONE,
  week: {
    id: isoWeekId(weekStartStr),
    start_date: weekStartStr,
    end_date: weekEndStr,
    focus: "Protect the two court anchors; let the support work stay supportive.",
    guardrails: [
      "Keep the hard-dose ceiling intact after the second court session.",
      "No catch-up volume if recovery slips.",
    ],
  },
  coach_read: {
    headline: "Two anchors. One restraint.",
    body: "The week has enough stimulus already. Win it by protecting Monday and Thursday, then keep Friday genuinely optional.",
    valid_from: weekStartStr,
    valid_until: weekEndStr,
  },
  days: Array.from({ length: 7 }, (_, i) => {
    const date = addDaysLocal(weekStartStr, i);
    const sessions = weekPlanByOffset[i] ?? [];
    return {
      date,
      intent: sessions.length ? intents[i] : i >= 5 ? intents[i] : "open",
      coach_note: sessions.length ? null : i >= 5 ? "Protect the adaptation day." : null,
      sessions,
    };
  }),
  coach_comments: [],
  updated_at: NOW.toISOString(),
  updated_by: "golden-dataset-generator",
  trace_id: "golden-dataset-generator",
};

// ─── Write ───────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });
const files = {
  "activities.json": activities,
  "ledger.json": ledger,
  "workouts.json": workouts,
  "sync_status.json": syncStatus,
  "sleep_log.json": sleepLog,
  "quest_history.json": questHistory,
  "current_week.json": currentWeek,
  "latest_message.json": latestMessage,
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(content, null, 2) + "\n");
}
console.log(`✓ golden repo-data written (${activities.length} activities) → ${OUT_DIR}`);
