#!/usr/bin/env node
/**
 * Cyclops Sentry query — list unresolved production issues, then fetch one issue or its latest event.
 *
 * Token: `SENTRY_AUTH_TOKEN`, else `~/.config/sentry-token`. Same fallback as sentry-runbook.md.
 * Never print the token. A 401 means the file or env is wrong, not that someone should paste it.
 */
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const ORG_SLUG = "sibling-shipyard";
const TOKEN_FILE = path.join(os.homedir(), ".config", "sentry-token");
const TOKEN_HINT =
  "Set SENTRY_AUTH_TOKEN or write the token to ~/.config/sentry-token (chmod 600). Never paste it into chat.";

function readToken() {
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

const TOKEN = readToken();

function listQuery(raw) {
  const query = raw || "is:unresolved";
  return /\benvironment:/.test(query) ? query : `${query} environment:production`;
}

function request(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "sentry.io",
        path: `/api/0${apiPath}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
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

async function main() {
  const [command, arg1] = process.argv.slice(2);

  try {
    if (command === "list") {
      const flagAt = process.argv.indexOf("--query");
      const rawQuery = flagAt >= 0 ? process.argv[flagAt + 1] : undefined;
      const params = new URLSearchParams({
        query: listQuery(rawQuery),
        limit: "10",
        // All three projects (web, api, ios). The org issues endpoint does not default to that.
        project: "-1",
      });
      const data = await request(`/organizations/${ORG_SLUG}/issues/?${params}`);
      if (!Array.isArray(data)) {
        throw new Error(`Unexpected issues payload: ${JSON.stringify(data)}`);
      }
      console.log(
        JSON.stringify(
          data.map((issue) => ({
            id: issue.id,
            project: issue.project.slug,
            title: issue.title,
            culprit: issue.culprit,
            count: issue.count,
            lastSeen: issue.lastSeen,
            permalink: issue.permalink,
          })),
          null,
          2,
        ),
      );
    } else if (command === "issue" && arg1) {
      const data = await request(`/issues/${arg1}/`);
      console.log(JSON.stringify(data, null, 2));
    } else if (command === "event" && arg1) {
      const data = await request(`/issues/${arg1}/events/latest/`);
      console.log(
        JSON.stringify(
          {
            eventID: data.eventID,
            tags: data.tags,
            context: data.contexts,
            entries: data.entries?.filter((e) => e.type === "exception" || e.type === "message"),
          },
          null,
          2,
        ),
      );
    } else {
      console.error("Usage:");
      console.error("  query-sentry.mjs list [--query \"<query>\"]");
      console.error("  query-sentry.mjs issue <issue-id>");
      console.error("  query-sentry.mjs event <issue-id>");
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
