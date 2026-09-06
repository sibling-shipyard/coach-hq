#!/usr/bin/env node
/**
 * Cyclops health digest — one report of what Sentry saw in a window.
 *
 * Writes three files: the issue body, a JSON summary, and - only when the window is worth a
 * notification - a comment. The workflow posts a comment if and only if that file exists, so the
 * "stay quiet on a quiet day" rule lives here in one place rather than in shell.
 *
 * Also auto-resolves every open issue with zero events in-window (Sentry reopens it if it fires
 * again). Pass `--dry-run` to compute and report that list without calling Sentry's PUT.
 *
 *   node platform/skills/sentry-digest.mjs --window 24h \
 *     --out-body body.md --out-meta meta.json --out-comment comment.md
 */
import fs from "node:fs";
import process from "node:process";

import { ORG, eventsUrl, flagValue, readToken, request, update } from "./_sentry-api.mjs";

const TOKEN = readToken();
const get = (apiPath) => request(apiPath, TOKEN);
const resolveIssue = (id) => update(`${ORG}/issues/${id}/`, TOKEN, { status: "resolved" });

const WINDOWS = {
  "24h": { statsPeriod: "24h", firstSeen: "-24h", label: "last 24 hours", hours: 24 },
  "7d": { statsPeriod: "7d", firstSeen: "-7d", label: "last 7 days", hours: 24 * 7 },
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
    } catch (error) {
      // A tag key absent from an issue 404s: that is "nobody tagged", not a failed digest.
      // Anything else - a 429 from the rate limit this serial loop exists to respect, or a
      // 5xx - is a lookup we did not get an answer to. Counting those as "nobody tagged"
      // silently shrinks the athlete table exactly when Sentry is struggling, and prints a
      // confident "N issue(s) carried no athlete_id tag" that is simply wrong.
      if (error.status !== 404) throw error;
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

/**
 * An open issue with zero events in-window has gone quiet; resolve it so the backlog doesn't
 * need a person to clear it by hand (#902 took ~15 manual API calls). Sentry flips an issue back
 * to unresolved the moment it fires again, so there is no false-negative risk to guard against
 * here - that reopen is the safety net, not something this script needs to reason about.
 *
 * One request per issue, in series: same rate-limit reasoning as `athleteBreakdown`.
 */
async function resolveStale(issues, dryRun) {
  const stale = issues.filter((issue) => windowCount(issue) === 0);
  for (const issue of stale) {
    if (!dryRun) await resolveIssue(issue.id);
  }
  return stale;
}

function table(header, rows) {
  if (!rows.length) return "";
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows]
    .join("\n")
    .concat("\n");
}

/**
 * Every `http.server` span carries `operation` (per-route: `coach-chat`, `coach-message`, ...)
 * and `outcome` (`ok`/`error`) - see `ui/api/_lib/sentry.ts`. Discover's `field=operation` +
 * `field=outcome` + `field=count()` returns one row per (operation, outcome) pair already
 * grouped, so this just folds the two outcome rows per operation into one totals row.
 */
function operationsUrl(statsPeriod) {
  return eventsUrl({
    dataset: "spans",
    fields: ["operation", "outcome", "count()"],
    query: "span.op:http.server",
    statsPeriod,
  });
}

function operationStats(discoverRows) {
  const totals = new Map();
  for (const row of discoverRows) {
    const operation = row.operation ?? "(untagged)";
    const count = Number(row["count()"] ?? 0);
    const entry = totals.get(operation) ?? { operation, ok: 0, error: 0 };
    if (row.outcome === "ok") entry.ok += count;
    else if (row.outcome === "error") entry.error += count;
    totals.set(operation, entry);
  }
  return [...totals.values()]
    .map((entry) => ({ ...entry, calls: entry.ok + entry.error }))
    .sort((a, b) => b.calls - a.calls);
}

function operationRows(operations) {
  return operations.map((o) => {
    const rate = o.calls ? `${((o.ok / o.calls) * 100).toFixed(0)}%` : "—";
    return `| \`${o.operation}\` | ${o.calls} | ${rate} |`;
  });
}

/**
 * A snapshot on its own doesn't say whether things are getting better or worse - split the
 * window into two equal halves (e.g. 3.5d + 3.5d for a 7d window) and compare. `eventsUrl`'s
 * `start`/`end` params (not `statsPeriod`) give each half an explicit, non-overlapping range.
 */
function halfWindowRanges(window) {
  const totalMs = window.hours * 60 * 60 * 1000;
  const now = Date.now();
  const start = new Date(now - totalMs).toISOString();
  const mid = new Date(now - totalMs / 2).toISOString();
  const end = new Date(now).toISOString();
  return { first: { start, end: mid }, second: { start: mid, end } };
}

function operationsRangeUrl({ start, end }) {
  return eventsUrl({
    dataset: "spans",
    fields: ["operation", "outcome", "count()"],
    query: "span.op:http.server",
    start,
    end,
  });
}

/**
 * "Climbing"/"falling" only means something past a little noise on single-digit daily counts -
 * a swing smaller than `epsilon` reads as "flat" rather than flipping on rounding.
 */
function trendDirection(before, after, epsilon) {
  if (before === null || after === null) return null;
  const diff = after - before;
  if (Math.abs(diff) < epsilon) return "flat";
  return diff > 0 ? "climbing" : "falling";
}

/** Total calls and overall success rate, first half of the window vs second half. */
function trendStats(window, firstOps, secondOps) {
  const totalCalls = (ops) => ops.reduce((sum, o) => sum + o.calls, 0);
  const totalOk = (ops) => ops.reduce((sum, o) => sum + o.ok, 0);
  const callsFirst = totalCalls(firstOps);
  const callsSecond = totalCalls(secondOps);
  const halfDays = window.hours / 2 / 24;
  const callsPerDayFirst = halfDays ? callsFirst / halfDays : callsFirst;
  const callsPerDaySecond = halfDays ? callsSecond / halfDays : callsSecond;
  const rateFirst = callsFirst ? (totalOk(firstOps) / callsFirst) * 100 : null;
  const rateSecond = callsSecond ? (totalOk(secondOps) / callsSecond) * 100 : null;
  return {
    callsPerDayFirst,
    callsPerDaySecond,
    callsDirection: trendDirection(callsPerDayFirst, callsPerDaySecond, Math.max(1, callsPerDayFirst * 0.1)),
    successRateFirst: rateFirst,
    successRateSecond: rateSecond,
    rateDirection: trendDirection(rateFirst, rateSecond, 3),
  };
}

function trendLine(window, trend) {
  const fmtCalls = (n) => (Number.isFinite(n) ? Math.round(n) : "—");
  const fmtRate = (n) => (n === null ? "—" : `${n.toFixed(0)}%`);
  return (
    `Trend, first half vs second half of the ${window.label}: ` +
    `${fmtCalls(trend.callsPerDayFirst)} → ${fmtCalls(trend.callsPerDaySecond)} calls/day ` +
    `(${trend.callsDirection ?? "flat"}), ${fmtRate(trend.successRateFirst)} → ` +
    `${fmtRate(trend.successRateSecond)} success rate (${trend.rateDirection ?? "flat"}).`
  );
}

/**
 * Every `gen_ai.generate_content` span (`ui/api/_lib/sentry.ts`, shared by the direct-Gemini and
 * OpenRouter adapters) carries `gen_ai.request.model` and `gen_ai.usage.{input,output,total}_
 * tokens`. Same implicit group-by as `operationsUrl`: a non-aggregate field alongside aggregate
 * functions returns one row per model already summed.
 */
function tokensUrl(statsPeriod) {
  return eventsUrl({
    dataset: "spans",
    fields: [
      "gen_ai.request.model",
      "sum(gen_ai.usage.input_tokens)",
      "sum(gen_ai.usage.output_tokens)",
      "sum(gen_ai.usage.total_tokens)",
      "count()",
    ],
    query: "span.op:gen_ai.generate_content",
    statsPeriod,
  });
}

/**
 * `gen_ai.usage.cost.usd` is OpenRouter-only (#889); direct Gemini never sets it. Sentry's spans
 * dataset also types this attribute as a string, so `sum(gen_ai.usage.cost.usd)` 400s
 * ("Its a string type field") — confirmed live against this project, 2026-09-06. Fetched as raw
 * per-span rows instead, filtered to spans that actually carry it (a small set), and summed in
 * `tokenStats` below.
 */
function costUrl(statsPeriod) {
  return eventsUrl({
    dataset: "spans",
    fields: ["gen_ai.request.model", "gen_ai.usage.cost.usd"],
    query: "span.op:gen_ai.generate_content has:gen_ai.usage.cost.usd",
    statsPeriod,
  });
}

/**
 * $/M tokens for models that never report a real `gen_ai.usage.cost.usd` (the direct-Gemini
 * path) — used to *estimate* $ from token counts. Every entry must trace to a real figure in
 * `docs/eng-docs/chat-provider-bench.md`, never an invented number (M4 brief).
 *
 * Empty today, on purpose: that doc's own "Still missing" section says production's model,
 * `gemini-pro-latest`, was never billed during benchmarking — no working paid key existed at the
 * time, so the direct-Gemini arm measured `gemini-flash-latest` instead, and even that arm reads
 * "not billed on this path" (a free-tier key). The doc's only real cost figure
 * (`google/gemini-3.8-flash` via OpenRouter, $0.0094-$0.0110/call) already reaches this script as
 * measured `cost.usd`, not something to re-derive here. Add a `{ input, output }` ($/M tokens)
 * entry, cited, once a paid direct-Gemini key produces a real per-token measurement.
 */
const PRICING_USD_PER_MTOK = {};

/**
 * One row per model: real tokens always, real `cost.usd` when Sentry has it, else an amount
 * estimated from `PRICING_USD_PER_MTOK`, else `null` ("no pricing data" — never a guess).
 */
function tokenStats(tokenRows, costRows) {
  const realCost = new Map();
  for (const row of costRows) {
    const model = row["gen_ai.request.model"] ?? "(untagged)";
    const cost = Number(row["gen_ai.usage.cost.usd"]);
    if (!Number.isFinite(cost)) continue;
    realCost.set(model, (realCost.get(model) ?? 0) + cost);
  }
  return tokenRows
    .map((row) => {
      const model = row["gen_ai.request.model"] ?? "(untagged)";
      const inputTokens = Number(row["sum(gen_ai.usage.input_tokens)"] ?? 0);
      const outputTokens = Number(row["sum(gen_ai.usage.output_tokens)"] ?? 0);
      const totalTokens = Number(row["sum(gen_ai.usage.total_tokens)"] ?? 0);
      const calls = Number(row["count()"] ?? 0);
      const measured = realCost.get(model);
      if (measured !== undefined) {
        return { model, calls, inputTokens, outputTokens, totalTokens, costUsd: measured, estimated: false };
      }
      const pricing = PRICING_USD_PER_MTOK[model];
      const costUsd = pricing
        ? (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
        : null;
      return { model, calls, inputTokens, outputTokens, totalTokens, costUsd, estimated: costUsd !== null };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Shared by the model table and the athlete table - same three states, same markers. */
function formatCost(costUsd, estimated) {
  return costUsd === null ? "no pricing data" : `${estimated ? "~" : ""}$${costUsd.toFixed(4)}`;
}

function tokenRows(models) {
  return models.map((m) => {
    return `| \`${m.model}\` | ${m.calls} | ${m.inputTokens} | ${m.outputTokens} | ${m.totalTokens} | ${formatCost(m.costUsd, m.estimated)} |`;
  });
}

/**
 * Every `gen_ai.generate_content` span's `user.id` carries the same athlete id as the
 * `athlete_id` tag on `http.server` spans (both set from `setAthleteScope` in
 * `ui/api/_lib/sentry.ts`) - but `athlete_id` itself is a custom *tag*, set on the per-request
 * isolation scope, and Sentry's spans dataset does not copy scope tags onto descendant spans:
 * confirmed live (2026-09-06) that `athlete_id` reads `null` on every `gen_ai.generate_content`
 * span. `user.id` comes from `scope.setUser(...)` instead, which Sentry treats as a promoted
 * field and *does* propagate to every child span - also confirmed live, populated on 100% of
 * sampled `gen_ai.generate_content` spans. Group by this field, not `athlete_id`.
 */
function athleteTokensUrl(statsPeriod) {
  return eventsUrl({
    dataset: "spans",
    fields: [
      "user.id",
      "gen_ai.request.model",
      "sum(gen_ai.usage.input_tokens)",
      "sum(gen_ai.usage.output_tokens)",
      "sum(gen_ai.usage.total_tokens)",
      "count()",
    ],
    query: "span.op:gen_ai.generate_content",
    statsPeriod,
  });
}

/** Same "typed as a string" 400 as `costUrl` - raw rows, filtered to spans that carry it. */
function athleteCostUrl(statsPeriod) {
  return eventsUrl({
    dataset: "spans",
    fields: ["user.id", "gen_ai.request.model", "gen_ai.usage.cost.usd"],
    query: "span.op:gen_ai.generate_content has:gen_ai.usage.cost.usd",
    statsPeriod,
  });
}

/**
 * One row per athlete, folding every model they used into one calls/tokens/cost total - same
 * three cost states as `tokenStats` (real, estimated, "no pricing data"), just grouped one level
 * up. An athlete who used more than one model gets `estimated: true` if *any* of their calls were
 * estimated rather than billed - good enough for "who is this costing us" without a full
 * per-athlete-per-model table.
 */
function athleteTokenStats(tokenRows, costRows) {
  const realCost = new Map();
  for (const row of costRows) {
    const key = `${row["user.id"] ?? "(unknown)"} ${row["gen_ai.request.model"] ?? "(untagged)"}`;
    const cost = Number(row["gen_ai.usage.cost.usd"]);
    if (!Number.isFinite(cost)) continue;
    realCost.set(key, (realCost.get(key) ?? 0) + cost);
  }
  const totals = new Map();
  for (const row of tokenRows) {
    const athlete = row["user.id"] ?? "(unknown)";
    const model = row["gen_ai.request.model"] ?? "(untagged)";
    const inputTokens = Number(row["sum(gen_ai.usage.input_tokens)"] ?? 0);
    const outputTokens = Number(row["sum(gen_ai.usage.output_tokens)"] ?? 0);
    const totalTokens = Number(row["sum(gen_ai.usage.total_tokens)"] ?? 0);
    const calls = Number(row["count()"] ?? 0);
    const measured = realCost.get(`${athlete} ${model}`);
    const pricing = PRICING_USD_PER_MTOK[model];
    const modelCost =
      measured !== undefined
        ? measured
        : pricing
          ? (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
          : null;
    const modelEstimated = measured === undefined && modelCost !== null;
    const entry = totals.get(athlete) ?? { athlete, calls: 0, totalTokens: 0, costUsd: null, estimated: false };
    entry.calls += calls;
    entry.totalTokens += totalTokens;
    if (modelCost !== null) {
      entry.costUsd = (entry.costUsd ?? 0) + modelCost;
      if (modelEstimated) entry.estimated = true;
    }
    totals.set(athlete, entry);
  }
  return [...totals.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function issueRows(issues) {
  return issues.map((i) => {
    const raw = (i.title ?? "").replace(/\|/g, "\\|");
    const title = raw.length > 70 ? `${raw.slice(0, 69)}…` : raw;
    return `| [${title}](${i.permalink}) | \`${i.project.slug}\` | ${windowCount(i)} |`;
  });
}

/**
 * The `## By athlete` table's two halves come from different data sources - error events
 * (`athleteBreakdown`, keyed on the issues API's `athlete_id` tag) and model spans
 * (`athleteTokenStats`, keyed on `user.id` - see that function's comment for why) - joined here on
 * the athlete id string both share. An athlete with calls but no errors, or errors but no calls,
 * is real and shown with `—` on the side that has nothing to report, not dropped.
 */
function athleteRows(eventRows, tokenStatsRows) {
  const tokenByAthlete = new Map(tokenStatsRows.map((t) => [t.athlete, t]));
  const seen = new Set(eventRows.map((r) => r.athlete));
  const merged = [
    ...eventRows.map((r) => ({ ...r, tokenEntry: tokenByAthlete.get(r.athlete) })),
    ...tokenStatsRows
      .filter((t) => !seen.has(t.athlete))
      .map((t) => ({ athlete: t.athlete, events: 0, issues: 0, tokenEntry: t })),
  ];
  return merged.sort(
    (a, b) => b.events - a.events || (b.tokenEntry?.totalTokens ?? 0) - (a.tokenEntry?.totalTokens ?? 0),
  );
}

function athleteTableRows(rows) {
  return rows.map((r) => {
    const t = r.tokenEntry;
    const tokens = t ? t.totalTokens : "—";
    const cost = t ? formatCost(t.costUsd, t.estimated) : "—";
    return `| \`${r.athlete}\` | ${r.events} | ${r.issues} | ${tokens} | ${cost} |`;
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

function renderBody({
  window,
  generatedAt,
  open,
  fresh,
  athletes,
  athleteMerged,
  athleteTokens,
  rage,
  resolved,
  dryRun,
  operations,
  tokens,
  trend,
}) {
  const out = [];
  out.push(`_Generated ${generatedAt} · window: ${window.label} · production only._`);
  out.push("");

  out.push("## Calls by operation");
  out.push("");
  if (!operations.length) {
    out.push("No API calls recorded in this window.");
  } else {
    out.push(table(["Operation", "Calls", "Success rate"], operationRows(operations)));
    const totalCalls = operations.reduce((sum, o) => sum + o.calls, 0);
    const totalOk = operations.reduce((sum, o) => sum + o.ok, 0);
    const overallRate = totalCalls ? ((totalOk / totalCalls) * 100).toFixed(0) : "—";
    out.push(
      `${totalCalls} calls across ${operations.length} operation(s) in the ${window.label}, ` +
        `${overallRate}% overall success rate. A 4xx counts as an error here, on purpose.`,
    );
    out.push("");
    out.push(trendLine(window, trend));
  }
  out.push("");

  out.push("## Tokens & cost by model");
  out.push("");
  if (!tokens.length) {
    out.push("No `gen_ai.generate_content` spans recorded in this window.");
  } else {
    out.push(
      table(
        ["Model", "Calls", "Input tokens", "Output tokens", "Total tokens", "Cost (USD)"],
        tokenRows(tokens),
      ),
    );
    const totalTokens = tokens.reduce((sum, t) => sum + t.totalTokens, 0);
    const notes = [];
    if (tokens.some((t) => t.costUsd !== null && t.estimated)) {
      notes.push("`~` is estimated from tokens, not billed.");
    }
    if (tokens.some((t) => t.costUsd === null)) {
      notes.push('"no pricing data" means no billed cost and no pricing figure for that model yet.');
    }
    out.push(
      `${totalTokens} tokens across ${tokens.length} model(s) in the ${window.label}.` +
        (notes.length ? ` ${notes.join(" ")}` : ""),
    );
  }
  out.push("");

  out.push("## Auto-resolved (no events this window)");
  out.push("");
  if (!resolved.length) {
    out.push("None this run.");
  } else {
    const verb = dryRun ? "would be auto-resolved" : "auto-resolved";
    const titles = resolved.map((i) => `[${(i.title ?? "").slice(0, 70)}](${i.permalink})`);
    out.push(`${resolved.length} issue(s) ${verb} (no events this window): ${titles.join(", ")}`);
    out.push("");
    out.push("Sentry reopens an issue the moment it fires again — check here before reopening by hand.");
  }
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
  if (!athleteMerged.length) {
    out.push("No events or model calls could be attributed to an athlete in this window.");
  } else {
    out.push(
      table(["Athlete", "Events", "Issues", "Tokens", "Cost"], athleteTableRows(athleteMerged)),
    );
    out.push(
      "One athlete holding most of the events is usually one incident, not many bugs. Check that first.",
    );
    if (athleteTokens.some((t) => t.costUsd !== null && t.estimated)) {
      out.push("`~` is estimated from tokens, not billed — see the tokens table above.");
    }
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
  const halves = halfWindowRanges(window);

  const [
    open,
    fresh,
    rage,
    operationEvents,
    tokenEvents,
    costEvents,
    athleteTokenEvents,
    athleteCostEvents,
    firstHalfEvents,
    secondHalfEvents,
  ] = await Promise.all([
    get(issuesUrl(baseQuery, window.statsPeriod)),
    get(issuesUrl(`${baseQuery} firstSeen:${window.firstSeen}`, window.statsPeriod)),
    get(issuesUrl(RAGE_QUERY, window.statsPeriod)),
    get(operationsUrl(window.statsPeriod)),
    get(tokensUrl(window.statsPeriod)),
    get(costUrl(window.statsPeriod)),
    get(athleteTokensUrl(window.statsPeriod)),
    get(athleteCostUrl(window.statsPeriod)),
    get(operationsRangeUrl(halves.first)),
    get(operationsRangeUrl(halves.second)),
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
  // The Discover/events endpoint answers `{ data, meta }`, not a bare array like the issues ones.
  for (const [name, value] of [
    ["operations", operationEvents],
    ["tokens", tokenEvents],
    ["cost", costEvents],
    ["athlete tokens", athleteTokenEvents],
    ["athlete cost", athleteCostEvents],
    ["trend first half", firstHalfEvents],
    ["trend second half", secondHalfEvents],
  ]) {
    if (!Array.isArray(value?.data)) {
      throw new Error(`Unexpected ${name} payload: ${JSON.stringify(value)}`);
    }
  }

  const dryRun = process.argv.includes("--dry-run");
  const resolved = await resolveStale(open, dryRun);
  const athletes = await athleteBreakdown(open);
  const operations = operationStats(operationEvents.data);
  const tokens = tokenStats(tokenEvents.data, costEvents.data);
  const athleteTokens = athleteTokenStats(athleteTokenEvents.data, athleteCostEvents.data);
  const athleteMerged = athleteRows(athletes.rows, athleteTokens);
  const trend = trendStats(
    window,
    operationStats(firstHalfEvents.data),
    operationStats(secondHalfEvents.data),
  );
  const body = renderBody({
    window,
    generatedAt,
    open,
    fresh,
    athletes,
    athleteMerged,
    athleteTokens,
    rage,
    resolved,
    dryRun,
    operations,
    tokens,
    trend,
  });

  const totalCalls = operations.reduce((sum, o) => sum + o.calls, 0);
  const totalOk = operations.reduce((sum, o) => sum + o.ok, 0);

  const meta = {
    window: key,
    generatedAt,
    dryRun,
    openCount: open.length,
    newCount: fresh.length,
    rageCount: rage.length,
    autoResolvedCount: resolved.length,
    autoResolvedTitles: resolved.map((i) => i.title),
    totalEvents: open.reduce((sum, i) => sum + windowCount(i), 0),
    topAthlete: athletes.rows[0]?.athlete ?? null,
    operations: operations.map((o) => ({
      operation: o.operation,
      calls: o.calls,
      ok: o.ok,
      error: o.error,
      successRate: o.calls ? Number(((o.ok / o.calls) * 100).toFixed(1)) : null,
    })),
    totalCalls,
    overallSuccessRate: totalCalls ? Number(((totalOk / totalCalls) * 100).toFixed(1)) : null,
    tokens: tokens.map((t) => ({
      model: t.model,
      calls: t.calls,
      inputTokens: t.inputTokens,
      outputTokens: t.outputTokens,
      totalTokens: t.totalTokens,
      costUsd: t.costUsd === null ? null : Number(t.costUsd.toFixed(6)),
      // null means no cost at all (no billed figure, no pricing table entry) - distinct from a
      // real $0 estimate, which `estimated: true` with a non-null costUsd would represent.
      costEstimated: t.costUsd === null ? null : t.estimated,
    })),
    totalTokens: tokens.reduce((sum, t) => sum + t.totalTokens, 0),
    trend: {
      callsPerDayFirst: Number(trend.callsPerDayFirst.toFixed(1)),
      callsPerDaySecond: Number(trend.callsPerDaySecond.toFixed(1)),
      callsDirection: trend.callsDirection,
      successRateFirst: trend.successRateFirst === null ? null : Number(trend.successRateFirst.toFixed(1)),
      successRateSecond: trend.successRateSecond === null ? null : Number(trend.successRateSecond.toFixed(1)),
      rateDirection: trend.rateDirection,
    },
    athletes: athleteMerged.map((r) => ({
      athlete: r.athlete,
      events: r.events,
      issues: r.issues,
      totalTokens: r.tokenEntry?.totalTokens ?? 0,
      costUsd: r.tokenEntry?.costUsd ?? null,
      costEstimated: r.tokenEntry?.costUsd == null ? null : r.tokenEntry.estimated,
    })),
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
