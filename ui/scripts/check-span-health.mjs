/**
 * check-span-health.mjs — fails when production is serving traffic and sending no API spans.
 *
 * The outage this exists for (#878) was invisible for hours: errors kept arriving, so every
 * dashboard and alert looked alive, while `dataset=spans` had gone quiet and every Sentry-based
 * diagnosis silently became unreliable. Absence is the signal here, and absence is exactly what
 * nothing else watches.
 *
 * Two questions, both against Sentry, because the answer has to be a conjunction: an empty span
 * store on a day nobody used the product is normal. Traffic is anything the org recorded —
 * an API error, a browser span — and spans are `http.server` on `coach-hq-api`.
 *
 * Run it by hand. Nothing schedules it: what runs on a timer is one owned decision, not something
 * each PR settles for itself.
 *
 * Env: SENTRY_AUTH_TOKEN, falling back to `~/.config/sentry-token` the way the runbook does.
 * SPAN_HEALTH_WINDOW (a Sentry `statsPeriod`, default `24h`) so the failing branch can be
 * exercised against a window you know is empty.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const ORG = "sibling-shipyard";
const WINDOW = process.env.SPAN_HEALTH_WINDOW || "24h";
const API_PROJECT = "coach-hq-api";
const WEB_PROJECT = "coach-hq-web";

function readToken() {
  if (process.env.SENTRY_AUTH_TOKEN) return process.env.SENTRY_AUTH_TOKEN;
  try {
    return readFileSync(join(homedir(), ".config", "sentry-token"), "utf8").trim();
  } catch {
    return "";
  }
}

const token = readToken();
if (!token) {
  console.error(
    "No Sentry token. Export SENTRY_AUTH_TOKEN or write ~/.config/sentry-token - see docs/eng-docs/sentry-runbook.md.",
  );
  process.exit(2);
}

/** One `count()` from Sentry's discover API. Throws on anything but a 200, so a fault is loud. */
async function count({ dataset, project, query }) {
  const url = new URL(`https://sentry.io/api/0/organizations/${ORG}/events/`);
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("project", project);
  url.searchParams.set("environment", "production");
  url.searchParams.set("statsPeriod", WINDOW);
  url.searchParams.set("query", query);
  url.searchParams.set("field", "count()");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sentry ${dataset} query failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return Number(body.data?.[0]?.["count()"] ?? 0);
}

// Project slugs, not ids: the discover API accepts either, and a slug survives a project rebuild.
const [apiSpans, apiErrors, webSpans] = await Promise.all([
  count({ dataset: "spans", project: API_PROJECT, query: "span.op:http.server" }),
  count({ dataset: "errors", project: API_PROJECT, query: "" }),
  count({ dataset: "spans", project: WEB_PROJECT, query: "" }),
]);

const traffic = apiErrors + webSpans;
console.log(
  `last ${WINDOW} production: api http.server spans=${apiSpans}, api errors=${apiErrors}, web spans=${webSpans}`,
);

if (traffic > 0 && apiSpans === 0) {
  console.error(
    `Production served traffic in the last ${WINDOW} and sent no http.server spans. ` +
      `Tracing is broken; treat every span-based finding as unreliable until it is fixed. ` +
      `See docs/eng-docs/sentry-runbook.md.`,
  );
  process.exit(1);
}

if (traffic === 0) {
  console.log("No production traffic in the window, so an empty span store proves nothing.");
}
