#!/usr/bin/env node
import https from 'node:https';
import process from 'node:process';

const ORG_SLUG = 'sibling-shipyard';
const TOKEN = process.env.SENTRY_AUTH_TOKEN;

if (!TOKEN) {
  console.error('Error: SENTRY_AUTH_TOKEN environment variable is not set.');
  process.exit(1);
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'sentry.io',
      path: `/api/0${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Antigravity-Cyclops/1.0',
        ...options.headers
      }
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch(e) {
            resolve(data);
          }
        } else {
          reject(new Error(`API Error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const [command, arg1, arg2] = process.argv.slice(2);

  try {
    if (command === 'list') {
      const query = process.argv.includes('--query') ? process.argv[process.argv.indexOf('--query') + 1] : 'is:unresolved';
      const encodedQuery = encodeURIComponent(query);
      const data = await request(`/organizations/${ORG_SLUG}/issues/?query=${encodedQuery}&limit=10`);
      console.log(JSON.stringify(data.map(issue => ({
        id: issue.id,
        project: issue.project.slug,
        title: issue.title,
        culprit: issue.culprit,
        count: issue.count,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink
      })), null, 2));
    } 
    else if (command === 'issue' && arg1) {
      const data = await request(`/issues/${arg1}/`);
      console.log(JSON.stringify(data, null, 2));
    }
    else if (command === 'event' && arg1) {
      const data = await request(`/issues/${arg1}/events/latest/`);
      console.log(JSON.stringify({
        eventID: data.eventID,
        tags: data.tags,
        context: data.contexts,
        entries: data.entries?.filter(e => e.type === 'exception' || e.type === 'message')
      }, null, 2));
    }
    else {
      console.error('Usage:');
      console.error('  query-sentry.mjs list [--query "<query>"]');
      console.error('  query-sentry.mjs issue <issue-id>');
      console.error('  query-sentry.mjs event <issue-id>');
      process.exit(1);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
