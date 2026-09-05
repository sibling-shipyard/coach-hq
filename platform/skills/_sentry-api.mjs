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

export function request(apiPath, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "sentry.io",
        path: `/api/0${apiPath}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "CoachHQ-Cyclops/1.0",
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
          reject(new Error(`API Error ${res.statusCode}: ${data}`));
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
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
