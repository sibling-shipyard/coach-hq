# Sentry Triage — CLI Reference

Load this file when Cyclops needs live Sentry data. Do not read at boot.

The script is `platform/skills/query-sentry.mjs`. A brief is a conclusion, so the default list
filter is production — Preview traffic and deliberate test failures stay out
(`sentry-runbook.md`).

## Token

Never ask the athlete to paste a token into chat. Same pattern as the runbook:

```bash
TOKEN=${SENTRY_AUTH_TOKEN:-$(cat ~/.config/sentry-token)}
```

On a shared machine prefer the file, `chmod 600`. A 401 means that file or env var is wrong.

## Commands

**1. List recent unresolved production issues** (all three projects)

```bash
node platform/skills/query-sentry.mjs list
```

`--query` replaces the default `is:unresolved` clause. The script still appends
`environment:production` unless the query already names an environment:

```bash
node platform/skills/query-sentry.mjs list --query "is:unresolved level:error"
```

**2. Issue details** (id from `list`, e.g. `123456789`)

```bash
node platform/skills/query-sentry.mjs issue <issue-id>
```

**3. Latest event** (stack trace and tags)

```bash
node platform/skills/query-sentry.mjs event <issue-id>
```

## How to triage

1. Start with `list`.
2. For a relevant issue, `event <issue-id>` for the stack.
3. Route from file paths and ADR 0034 (`ui/api/` → Bob, `ui/client/` → UI Expert, `ios/` → iOS Builder).
4. Do not make code changes. Output a one-page incident brief: what broke, where, who owns it.
