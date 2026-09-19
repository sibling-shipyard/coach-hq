# Skeleton recarve: commands and report

> Status: Plan · Owner: Tech Lead · Created: 2026-09-19 · Parent: [`platform-skeleton-recarve.md`](platform-skeleton-recarve.md)

Run from the HQ repo root on a clean `main`. Every command below is read-only until step 6.
Athlete repos are real people's data, so use `gh api` against remote `main`, never a local clone.
Local clones went stale in the last run. Set `WORK=$(mktemp -d)` and keep everything under it.

The five athlete repos and the skeleton are listed in `ATHLETE_REPOS` in
`ui/scripts/run-manual-coach-chat-test.ts`. Read that map at run time, do not copy it here.
The carved tree is described in [`skeleton-layout.md`](../eng-docs/skeleton-layout.md).

## Step 1: freeze inputs

```bash
git rev-parse HEAD                                                  # HQ sha
gh api repos/sibling-shipyard/coach-skeleton/git/ref/heads/main -q .object.sha
for R in <each athlete repo>; do
  gh api repos/$R/git/ref/heads/main -q .object.sha                 # main sha
  gh api repos/$R/contents/.coach-engine-version -H 'Accept: application/vnd.github.raw'
done
```

Write the values into the report header. Step 7 compares against them.

## Step 2: dry run

```bash
node platform/scripts/carve-skeleton.mjs --dry-run --no-sentry --out-dir $WORK/carve
```

`--no-sentry` skips the DSN stamp, so the dry run never needs a secret. The dry run differs from a
real push only in the Sentry DSN line of the workflows. Note that line as the one expected difference.

## Steps 3 and 4: compare every file

Compare git blob shas, so nothing is downloaded. `git hash-object` on each carved file is checked
against the repo's `git/trees/main?recursive=1` listing. Run it for the skeleton and for each athlete repo.

```python
import json, subprocess, sys, os
repo, out = sys.argv[1], sys.argv[2]
tree = json.loads(subprocess.check_output(["gh","api",f"repos/{repo}/git/trees/main?recursive=1"]))
assert not tree.get("truncated"), "tree truncated: list by directory instead"
remote = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
local = {}
for root, dirs, files in os.walk(out):
    dirs[:] = [d for d in dirs if d not in (".git", "__pycache__")]
    for f in files:
        p = os.path.join(root, f)
        local[os.path.relpath(p, out)] = subprocess.check_output(["git","hash-object",p]).decode().strip()
print("identical", [p for p in local if remote.get(p) == local[p]])
print("differ", [p for p in local if p in remote and remote[p] != local[p]])
print("only in carve", [p for p in local if p not in remote])
print("only in repo", [p for p in remote if p not in local])
```

Put every path in exactly one class. A path with no class stops the run.

| Class        | Paths                                                                                          | How to read a difference                   |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Engine-owned | `engine/`, `.github/workflows/`, `.claude/`, `propagated/`, root docs, `.coach-engine-version` | Pending update, or local drift. Say which. |
| Athlete data | `user_data/**`, `gen/**`                                                                       | Compare structure, not content. See below. |
| Athlete-only | `archive/`, notes, `sleep_log.json`, `leftover_coach_notes.md`                                 | Never touched. List only.                  |

For an engine-owned difference, tell pending update from drift. If the repo's own file equals the
skeleton's file at the repo's engine sha, the carve changed it and it is a pending update. If not,
someone edited it in the repo and it is drift. Never overwrite drift without asking.

On the last run one athlete repo showed 37 differing files, 17 of them data. Expect data files to
differ by content, so classify them by structure only.

### Data structure

Two checks per repo. First the shape validator, on a throwaway shallow clone:

```bash
gh repo clone <repo> $WORK/<name> -- --depth 1 -q
python3 engine/scripts/validate-data-shape.py --root $WORK/<name>
```

Then compare each data file's keys against its carve template. Run it for `coach/profile`,
`coach/memory`, `coach/injuries`, `ledger/seasons`, `ledger/quests` and `ledger/current_week`.

```python
import json, sys
def walk(t, a, path=""):
    out = []
    if isinstance(t, dict) and isinstance(a, dict):
        for k in t:
            out += [f"MISSING {path}{k}"] if k not in a else walk(t[k], a[k], f"{path}{k}.")
        out += [f"EXTRA   {path}{k}" for k in a if k not in t]
    elif t is not None and a is not None and type(t) is not type(a) \
            and not (isinstance(t, (int, float)) and isinstance(a, (int, float))):
        out.append(f"TYPE    {path[:-1]}: template {type(t).__name__}, repo {type(a).__name__}")
    return out
print("\n".join(walk(json.load(open(sys.argv[1])), json.load(open(sys.argv[2])))))
```

Read the output with these rules:

- `MISSING` is a backfill candidate.
- `EXTRA` under a free-form map is expected: `weekly_targets` keys and any memory note label.
- `EXTRA` anywhere else is a schema question. Report it, do not delete it.
- `TYPE` is a data bug. Report it, do not fix it in this run.

## Step 5: backfill list

A backfill is only a `MISSING` key that the carve template defines, set to the template's default,
in a data file of a repo whose `main` you froze in step 1. Never change an existing value.

For each candidate build the new file in memory and check the diff is exactly the added line:

```python
diff = [l for l in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0)
        if l[0] in "+-" and not l.startswith(("+++", "---"))]
assert diff == ['+  "<field>": null,'], diff   # a comma change on the previous line is the one allowed extra
```

## Step 6: decide and apply

Show the athlete the report and stop. Ask separately for each item, and apply only a yes.

| Action                             | How                                                                                                      | Recorded as                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Backfill a data field              | `gh api -X PUT repos/<repo>/contents/<path>` on `main`, one field per commit                             | `chore: add <field> to <file>` |
| Propagate engine or workflow files | One PR per repo, opened by the athlete's own account or an agreed bot                                    | Its own PR                     |
| Push the skeleton                  | `carve-skeleton.mjs --push`, needs `SENTRY_DSN` for the coach-hq-api project; it **force-pushes** `main` | The skeleton commit            |

Check `SENTRY_DSN` is the coach-hq-api project's before a push. The carve refuses to run without it.

## Step 7: verify

1. Recheck every `main` sha. Only repos you changed may have moved.
2. Rerun `validate-data-shape.py` and the key comparison on every repo. No `MISSING` may remain that
   you meant to backfill.
3. Dry run again and rerun the tree comparison against the skeleton. It must show no difference
   except the DSN line.
4. Open `.coach-engine-version` in each repo you propagated to and confirm it names the new HQ sha.

## Report

Save the report with the run's own PR as `skeleton-recarve-<date>.md`, not in `docs/plans/`. One table
per repo, with a summary on top.

| Path                                | Class        | Status                          | Action    |
| ----------------------------------- | ------------ | ------------------------------- | --------- |
| `.github/workflows/sync.yml`        | engine-owned | pending update                  | propagate |
| `user_data/coach/memory.json`       | data         | MISSING `training_availability` | backfill  |
| `user_data/coach/archive/phases.md` | athlete-only | listed                          | none      |

The summary gives the counts per class and per status, the frozen shas, and the list of approved and
declined actions. A later run diffs its table against this one to see what changed.
