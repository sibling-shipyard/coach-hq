#!/usr/bin/env node
/**
 * Cyclops health digest — one report of what Sentry saw in a window.
 *
 * Writes three files: the issue body, a JSON summary, and - only when the window is worth a
 * notification - a comment. The workflow posts a comment if and only if that file exists, so the
 * "stay quiet on a quiet day" rule lives here in one place rather than in shell.
 *
 *   node platform/skills/sentry-digest.mjs --window 24h \
 *     --out-body body.md --out-meta meta.json --out-comment comment.md
 */
import fs from "node:fs";
import process from "node:process";

import { ORG, flagValue, readToken, request } from "./_sentry-api.mjs";

const TOKEN = readToken();
const get = (apiPath) => request(apiPath, TOKEN);

const WINDOWS = {
  "24h": { statsPeriod: "24h", firstSeen: "-24h", label: "last 24 hours" },
  "7d": { statsPeriod: "7d", firstSeen: "-7d", label: "last 7 days" },
};

// Rage reports are messages, not errors (ops-observability.md), so they never appear in an
// error-level sweep. They are the only place an athlete speaks to us in words - pulled separately.
const RAGE_QUERY = "is:unresolved environment:production operation:rage_report";

function issuesUrl(query, statsPeriod) {
  const params = new URLSearchParams({
    query,
    limit: "100",
    project: "-1",
    statsPeriod,
    sort: "freq",
  });
  return `${ORG}/issues/?${params}`;
}

/** Sentry returns lifetime `count` plus a windowed `filtered.count` when the query is scoped. */
function windowCount(issue) {
  const filtered = issue.filtered?.count;
  return Number(filtered ?? issue.count ?? 0);
}

/** One request per issue, in series: a daily job has no deadline and Sentry has rate limits. */
async function athleteBreakdown(issues) {
  const totals = new Map();
  const unattributed = [];
  for (const issue of issues) {
    let data;
    try {
      data = await get(`${ORG}/issues/${issue.id}/tags/athlete_id/`);
    } catch {
      // A tag key absent from an issue 404s. That is "nobody tagged", not a failed digest -
      // and auth is already proven by the time we get here, so this cannot be a dead token.
      unattributed.push(issue);
      continue;
    }
    for (const value of data.topValues ?? []) {
      const row = totals.get(value.value) ?? { events: 0, issues: new Set() };
      row.events += value.count;
      row.issues.add(issue.shortId ?? issue.id);
      totals.set(value.value, row);
    }
  }
  const rows = [...totals.entries()]
    .map(([athlete, row]) => ({ athlete, events: row.events, issues: row.issues.size }))
    .sort((a, b) => b.events - a.events);
  return { rows, unattributed };
}

function table(header, rows) {
  if (!rows.length) return "";
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows]
    .join("\n")
    .concat("\n");
}

function issueRows(issues) {
  return issues.map((i) => {
    const raw = (i.title ?? "").replace(/\|/g, "\\|");
    const title = raw.length > 70 ? `${raw.slice(0, 69)}…` : raw;
    return `| [${title}](${i.permalink}) | \`${i.project.slug}\` | ${windowCount(i)} |`;
  });
}

/**
 * The notification. Only written when there is something to say - see `shouldNotify`.
 * Rendered here rather than in the workflow so all markdown lives in one file.
 */
function renderComment({ window, meta, runUrl }) {
  const out = [];
  out.push(
    window.key === "7d"
      ? "### Weekly rollup"
      : `### ${meta.newCount} new, ${meta.rageCount} rage report(s)`,
  );
  out.push("");
  out.push(
    `${meta.totalEvents} events across the ${window.label}` +
      (meta.topAthlete ? `, most from \`${meta.topAthlete}\`.` : "."),
  );
  out.push("");
  for (const h of meta.highlights) {
    out.push(`- [${h.title.slice(0, 80)}](${h.permalink}) — \`${h.project}\`, ${h.events} events`);
  }
  out.push("");
  out.push(runUrl ? `Full breakdown in the issue body above. [Run](${runUrl})` : "Full breakdown in the issue body above.");
  return out.join("\n");
}

/** Weekly always speaks. Daily speaks only when there is something new to say. */
function shouldNotify(windowKey, meta) {
  if (windowKey === "7d") return true;
  return meta.newCount > 0 || meta.rageCount > 0;
}

function renderBody({ window, generatedAt, open, fresh, athletes, rage }) {
  const out = [];
  out.push(`_Generated ${generatedAt} · window: ${window.label} · production only._`);
  out.push("");

  out.push(`## New or regressed in the ${window.label}`);
  out.push("");
  if (!fresh.length) {
    out.push("Nothing new. Every open issue below was already known before this window.");
  } else {
    out.push(table(["Issue", "Project", "Events"], issueRows(fresh)));
  }
  out.push("");

  out.push("## Open issues by events in window");
  out.push("");
  if (!open.length) {
    out.push("No production errors in this window.");
  } else {
    out.push(table(["Issue", "Project", "Events"], issueRows(open)));
    out.push("Counts are for this window, not lifetime — a fixed bug should fall to zero here.");
  }
  out.push("");

  out.push("## By athlete");
  out.push("");
  if (!athletes.rows.length) {
    out.push("No events carried an `athlete_id` tag in this window.");
  } else {
    out.push(
      table(
        ["Athlete", "Events", "Issues"],
        athletes.rows.map((r) => `| \`${r.athlete}\` | ${r.events} | ${r.issues} |`),
      ),
    );
    out.push(
      "One athlete holding most of the events is usually one incident, not many bugs. Check that first.",
    );
    if (athletes.unattributed.length) {
      out.push("");
      out.push(`${athletes.unattributed.length} issue(s) carried no \`athlete_id\` tag.`);
    }
  }
  out.push("");

  out.push("## Rage reports");
  out.push("");
  if (!rage.length) {
    out.push("None in this window.");
  } else {
    out.push(table(["Report", "Project", "Events"], issueRows(rage)));
    out.push("These are athletes typing to us. Read them before the error list.");
  }
  out.push("");
  out.push("---");
  out.push(
    "Maintained by `platform/skills/sentry-digest.mjs`. Edits here are overwritten on the next run.",
  );
  return out.join("\n");
}

async function main() {
  const key = flagValue("--window") ?? "24h";
  const window = WINDOWS[key];
  if (!window) {
    console.error(`Unknown --window ${key}. Use one of: ${Object.keys(WINDOWS).join(", ")}`);
    process.exit(1);
  }

  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const baseQuery = "is:unresolved environment:production";

  const [open, fresh, rage] = await Promise.all([
    get(issuesUrl(baseQuery, window.statsPeriod)),
    get(issuesUrl(`${baseQuery} firstSeen:${window.firstSeen}`, window.statsPeriod)),
    get(issuesUrl(RAGE_QUERY, window.statsPeriod)),
  ]);
  for (const [name, value] of [
    ["open", open],
    ["new", fresh],
    ["rage", rage],
  ]) {
    if (!Array.isArray(value)) {
      throw new Error(`Unexpected ${name} issues payload: ${JSON.stringify(value)}`);
    }
  }

  const athletes = await athleteBreakdown(open);
  const body = renderBody({ window, generatedAt, open, fresh, athletes, rage });

  const meta = {
    window: key,
    generatedAt,
    openCount: open.length,
    newCount: fresh.length,
    rageCount: rage.length,
    totalEvents: open.reduce((sum, i) => sum + windowCount(i), 0),
    topAthlete: athletes.rows[0]?.athlete ?? null,
    // A rage report that is also new appears in both lists; the reader wants it once.
    highlights: [...new Map([...fresh, ...rage].map((i) => [i.id, i])).values()].map((i) => ({
      title: i.title,
      project: i.project.slug,
      permalink: i.permalink,
      events: windowCount(i),
    })),
  };

  const notify = shouldNotify(key, meta);
  meta.notify = notify;

  const bodyPath = flagValue("--out-body");
  const metaPath = flagValue("--out-meta");
  const commentPath = flagValue("--out-comment");
  if (bodyPath) fs.writeFileSync(bodyPath, body);
  else console.log(body);
  if (metaPath) fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  if (commentPath && notify) {
    fs.writeFileSync(
      commentPath,
      renderComment({ window: { ...window, key }, meta, runUrl: process.env.DIGEST_RUN_URL }),
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
