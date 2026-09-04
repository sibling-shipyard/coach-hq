#!/usr/bin/env node
/**
 * Cyclops Sentry query — list unresolved production issues, then fetch one issue or its latest event.
 *
 * Token and request rules live in `_sentry-api.mjs`, shared with `sentry-digest.mjs`.
 */
import process from "node:process";

import { ORG, flagValue, listQuery, readToken, request } from "./_sentry-api.mjs";

const TOKEN = readToken();
const get = (apiPath) => request(apiPath, TOKEN);

async function main() {
  const [command, arg1] = process.argv.slice(2);

  try {
    if (command === "list") {
      const params = new URLSearchParams({
        query: listQuery(flagValue("--query")),
        limit: flagValue("--limit") ?? "100",
        // All three projects (web, api, ios). The org issues endpoint does not default to that.
        project: "-1",
      });
      const data = await get(`${ORG}/issues/?${params}`);
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
      console.log(JSON.stringify(await get(`${ORG}/issues/${arg1}/`), null, 2));
    } else if (command === "event" && arg1) {
      const data = await get(`${ORG}/issues/${arg1}/events/latest/`);
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
    } else if (command === "athletes" && arg1) {
      const data = await get(`${ORG}/issues/${arg1}/tags/athlete_id/`);
      console.log(
        JSON.stringify(
          {
            uniqueAthletes: data.uniqueValues,
            totalEvents: data.totalValues,
            athletes: (data.topValues ?? []).map((v) => ({
              athlete_id: v.value,
              count: v.count,
              firstSeen: v.firstSeen,
              lastSeen: v.lastSeen,
            })),
          },
          null,
          2,
        ),
      );
    } else {
      console.error("Usage:");
      console.error('  query-sentry.mjs list [--query "<query>"] [--limit <n>]');
      console.error("  query-sentry.mjs issue <issue-id>");
      console.error("  query-sentry.mjs event <issue-id>");
      console.error("  query-sentry.mjs athletes <issue-id>");
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
