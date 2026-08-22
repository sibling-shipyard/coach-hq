#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genDir, repoRoot } from "../lib/repo-layout.mjs";
import { loadActivities } from "./build-dashboard-snapshot.mjs";

const DAY_MS = 86_400_000;

function dateKey(activity) {
  return typeof activity.start_date_local === "string" ? activity.start_date_local.slice(0, 10) : null;
}

// Bucket on sport_type only. `category` is a sub-tag within a sport (RNK/FRN/CAS are all
// Badminton; CAL/FDN are both WeightTraining) — keying on it shatters one sport across several
// buckets and mixes two field namespaces into one map. See #459.
function sportKey(activity) {
  const value = activity.sport_type;
  if (typeof value !== "string" || !value.trim()) return null;
  // Split camelCase before lowercasing so the renderer's underscore->space title-case yields
  // "Weight Training", not "Weighttraining".
  return value.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function daysBetween(later, earlier) {
  return Math.floor((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

export function buildAthleteInsights(activities, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const bySport = new Map();
  for (const activity of activities) {
    const sport = sportKey(activity);
    const date = dateKey(activity);
    if (!sport || !date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) continue;
    const age = daysBetween(today, date);
    if (age < 0 || age >= 365) continue;
    const dates = bySport.get(sport) ?? [];
    dates.push(date);
    bySport.set(sport, dates);
  }

  const sports = {};
  for (const [sport, rawDates] of [...bySport].sort(([a], [b]) => a.localeCompare(b))) {
    const dates = [...new Set(rawDates)].sort();
    let longestGap = 0;
    for (let i = 1; i < dates.length; i++) longestGap = Math.max(longestGap, daysBetween(dates[i], dates[i - 1]));
    const recent = rawDates.filter((date) => daysBetween(today, date) < 28).length;
    const prior = rawDates.filter((date) => {
      const age = daysBetween(today, date);
      return age >= 28 && age < 112;
    }).length;
    sports[sport] = {
      sessions_365d: rawDates.length,
      sessions_per_week_recent_4w: Number((recent / 4).toFixed(2)),
      sessions_per_week_prior_12w: Number((prior / 12).toFixed(2)),
      longest_gap_days_365d: longestGap,
      days_since_last_session: daysBetween(today, dates.at(-1)),
    };
  }
  return { generated_at: now.toISOString().replace(".000Z", "Z"), window_days: 365, sports };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootFlag = process.argv.indexOf("--repo-root");
  const root = rootFlag >= 0 && process.argv[rootFlag + 1]
    ? path.resolve(process.argv[rootFlag + 1])
    : repoRoot(path.dirname(fileURLToPath(import.meta.url)));
  const output = path.join(genDir(root), "athlete_insights.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(buildAthleteInsights(loadActivities(root)), null, 2) + "\n");
  console.log(`✓ ${path.relative(root, output)} written`);
}
