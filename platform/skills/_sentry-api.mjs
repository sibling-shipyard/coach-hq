/**
 * Shared Sentry API access for the Cyclops tools (`query-sentry.mjs`, `sentry-digest.mjs`).
 *
 * Token: `SENTRY_AUTH_TOKEN`, else `~/.config/sentry-token`. Same fallback as sentry-runbook.md.
 * Never print the token. A 401 means the file or env is wrong, not that someone should paste it.
 */
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const ORG_SLUG = "sibling-shipyard";
// Every issue path is org-scoped. Sentry's unscoped `/issues/<id>/` form 404s, and the 404 is
// indistinguishable from a deleted issue - so it reads as "nothing there", not "wrong URL".
export const ORG = `/organizations/${ORG_SLUG}`;

const TOKEN_FILE = path.join(os.homedir(), ".config", "sentry-token");
export const TOKEN_HINT =
  "Set SENTRY_AUTH_TOKEN or write the token to ~/.config/sentry-token (chmod 600). Never paste it into chat.";

export function readToken() {
  const fromEnv = process.env.SENTRY_AUTH_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (fromFile) return fromFile;
  } catch {
    // fall through to the same error as a missing env var
  }
  console.error(`Error: no Sentry token. ${TOKEN_HINT}`);
  process.exit(1);
}

export function request(apiPath, token, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      {
        hostname: "sentry.io",
        path: `/api/0${apiPath}`,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "CoachHQ-Cyclops/1.0",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 401) {
            reject(new Error(`Sentry returned 401. ${TOKEN_HINT}`));
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
            return;
          }
          // Carries the status so callers can tell a 404 ("nothing there") from a 429 or a
          // 5xx ("ask again"). Without it every failure looks the same to a `catch`.
          const error = new Error(`API Error ${res.statusCode}: ${data}`);
          error.status = res.statusCode;
          reject(error);
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** PUT to update an issue (e.g. `{ status: "resolved" }`). Same error/status handling as `request`. */
export function update(apiPath, token, body) {
  return request(apiPath, token, { method: "PUT", body });
}

export function flagValue(name, argv = process.argv) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** The list filter is production-only by default; Preview traffic and test failures stay out. */
export function listQuery(raw) {
  const query = raw || "is:unresolved";
  return /\benvironment:/.test(query) ? query : `${query} environment:production`;
}

/**
 * Our `operation`/`outcome` tags (`ui/api/_lib/sentry.ts`) only mean something on this project.
 * An unscoped query (`project: "-1"`, as the issues endpoints use) pulls in `http.server` spans
 * from web/iOS too, which carry an unrelated `outcome` value (e.g. a sync job's `"nothing_new"`)
 * and no `operation` tag at all - confirmed against the live API while building the M2 digest
 * section, and the same scoping `ui/scripts/check-span-health.mjs` already uses.
 */
export const API_PROJECT = "coach-hq-api";

/**
 * Build a Discover/Events API URL (`/organizations/{org}/events/`) for aggregating **spans**,
 * not issues - the query/aggregation surface behind the `Coach HQ health` Sentry dashboard
 * (id 5873386), used here so the digest can report call volume and success rate the Issues API
 * (`issuesUrl` in `sentry-digest.mjs`) has no concept of. `request()` returns this endpoint's body
 * as `{ data, meta }`, unlike the issues endpoints' bare array - callers read `.data`.
 *
 * `start`/`end` (ISO 8601) is an alternative to `statsPeriod` for an arbitrary, non-"last N"
 * range - confirmed live against this endpoint (2026-09-06) for the digest's trend-delta halves,
 * which need e.g. "3.5 days ago to now" rather than a relative window. This endpoint has no
 * `interval`/`byDay` grouping (that lives on the separate `events-stats` time-series endpoint,
 * also confirmed live) - two `start`/`end` queries against the flat table is simpler here and
 * reuses the exact same row shape and grouping every other digest query already parses.
 */
export function eventsUrl({ dataset, fields, query, statsPeriod, start, end, project = API_PROJECT }) {
  const params = new URLSearchParams({
    dataset,
    project,
    environment: "production",
    query,
    ...(start && end ? { start, end } : { statsPeriod }),
  });
  for (const field of fields) params.append("field", field);
  return `${ORG}/events/?${params}`;
}
