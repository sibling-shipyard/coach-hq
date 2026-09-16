#!/usr/bin/env bash
#
# check.sh — run every check in the repo, in one shot, and report all of them.
#
# The point is the *summary*: an agent that fixes the first failure, re-runs, finds the second,
# and repeats pays a full tsc+vitest cycle each time. So no `set -e` — every check runs even
# after one fails, and the table at the end is the whole picture.
#
# Usage:
#   bash platform/scripts/check.sh                 # full output per check
#   bash platform/scripts/check.sh --quiet         # summary only; failing checks still print
#   bash platform/scripts/check.sh --quiet --changed  # only checks whose paths hit this branch
set -uo pipefail

# Derive the root from this script's location — the caller's cwd is not ours to trust.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

QUIET=0
CHANGED=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --changed) CHANGED=1 ;;
    -h|--help)
      echo "Usage: bash platform/scripts/check.sh [--quiet] [--changed]"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

# Keep hook enforcement clone-local and tool-agnostic. `--local` writes only this
# clone's repository config; it does not change the user's global git settings.
if [ "$(git -C "$REPO_ROOT" config --local --get core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  if git -C "$REPO_ROOT" config --local core.hooksPath .githooks; then
    echo "Configured this clone to use the versioned hooks: core.hooksPath=.githooks"
  else
    echo "error: could not enable the versioned hooks for this clone." >&2
    exit 1
  fi
fi

NAMES=()
DIRS=()
CMDS=()
POLICIES=()
PATHS=()

# Read checks from checks.conf; skip blank lines and comments.
# $REPO_ROOT in the dir field is expanded via parameter substitution.
# Optional 5th field: comma-separated path globs for --changed (default * = always).
while IFS='|' read -r name dir cmd policy paths || [ -n "$name" ]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  dir="${dir/\$REPO_ROOT/$REPO_ROOT}"
  NAMES+=("$name")
  DIRS+=("$dir")
  CMDS+=("$cmd")
  POLICIES+=("${policy:-block}")
  PATHS+=("${paths:-*}")
done < "$SCRIPT_DIR/checks.conf"

# validate_kdb is hardcoded here — it is not in checks.conf because it validates
# the repo's knowledge-base tooling (including checks.conf itself) and must always run last.
NAMES+=("validate_kdb")
DIRS+=("$REPO_ROOT")
CMDS+=("python3 kdb/scripts/validate_kdb.py")
POLICIES+=("block")
PATHS+=("*")

CHANGED_FILES=""
if [ "$CHANGED" -eq 1 ]; then
  MERGE_BASE="$(git -C "$REPO_ROOT" merge-base HEAD origin/main 2>/dev/null || true)"
  if [ -z "$MERGE_BASE" ]; then
    CHANGED=0
  else
    CHANGED_FILES="$(git -C "$REPO_ROOT" diff --name-only "$MERGE_BASE" HEAD)"
  fi
fi

paths_hit() {
  local globs="$1"
  PATHS_HIT_ROOT="$REPO_ROOT" PATHS_HIT_GLOBS="$globs" PATHS_HIT_FILES="$CHANGED_FILES" python3 - <<'PY'
import os, sys
sys.path.insert(0, os.path.join(os.environ["PATHS_HIT_ROOT"], "kdb/scripts"))
from stack_ci_gate import path_matches
globs = [g.strip() for g in os.environ["PATHS_HIT_GLOBS"].split(",") if g.strip()]
files = [f for f in os.environ["PATHS_HIT_FILES"].splitlines() if f]
if not globs or "*" in globs or "always" in globs:
    raise SystemExit(0)
for path in files:
    if any(path_matches(path, glob) for glob in globs):
        raise SystemExit(0)
raise SystemExit(1)
PY
}

SKIP=()
NEED_UI=0
for i in "${!NAMES[@]}"; do
  if [ "$CHANGED" -eq 1 ] && ! paths_hit "${PATHS[$i]}"; then
    SKIP+=("1")
  else
    SKIP+=("0")
    if [ "${DIRS[$i]}" = "$REPO_ROOT/ui" ]; then
      NEED_UI=1
    fi
  fi
done

require_ui_node_modules() {
  if [ ! -d "$REPO_ROOT/ui/node_modules" ]; then
    echo "error: $REPO_ROOT/ui/node_modules is missing - every ui check would exit 127." >&2
    echo "  Same package.json as your primary checkout? Symlink it, do not reinstall:" >&2
    echo "    ln -s <primary-checkout>/ui/node_modules $REPO_ROOT/ui/node_modules" >&2
    echo "  Otherwise: (cd $REPO_ROOT/ui && npm ci)" >&2
    exit 2
  fi
  MISSING_DEPS=$(node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "ui/package.json"), "utf8"));
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const missing = declared.filter((d) => !fs.existsSync(path.join(root, "ui/node_modules", d)));
    process.stdout.write(missing.join(", "));
  ' "$REPO_ROOT")
  if [ -n "$MISSING_DEPS" ]; then
    echo "error: $REPO_ROOT/ui/node_modules is stale - these declared deps are not installed:" >&2
    echo "    $MISSING_DEPS" >&2
    echo "  Symlinked from another checkout? That copy predates deps this branch adds." >&2
    echo "  Fix (rm -rf drops a symlink without touching its target):" >&2
    echo "    (cd $REPO_ROOT/ui && rm -rf node_modules && npm ci)" >&2
    exit 2
  fi
}

if [ "$NEED_UI" -eq 1 ] && [ -f "$REPO_ROOT/ui/package.json" ]; then
  require_ui_node_modules
fi

TOTAL=${#NAMES[@]}
STATUSES=()
DURATIONS=()
FAILED=0
WARNED=0
SKIPPED=0
GATE_STARTED=$SECONDS

for i in "${!NAMES[@]}"; do
  n=$((i + 1))
  name="${NAMES[$i]}"
  policy="${POLICIES[$i]}"
  header="=== [$n/$TOTAL] $name ==="
  check_started=$SECONDS

  if [ "${SKIP[$i]}" = "1" ]; then
    STATUSES+=("SKIP (--changed)")
    DURATIONS+=("0s")
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # --quiet buffers rather than discards: output is only worth hiding while a check is passing.
  if [ "$QUIET" -eq 1 ]; then
    output="$(cd "${DIRS[$i]}" && eval "${CMDS[$i]}" 2>&1)"
    code=$?
    if [ $code -ne 0 ]; then
      echo "$header"
      printf '%s\n' "$output"
    fi
  else
    echo "$header"
    (cd "${DIRS[$i]}" && eval "${CMDS[$i]}")
    code=$?
  fi

  if [ "$code" -eq 0 ]; then
    STATUSES+=("PASS")
  elif [ "$policy" = "warn" ]; then
    STATUSES+=("WARN (exit $code, non-blocking like GitHub)")
    WARNED=$((WARNED + 1))
  else
    STATUSES+=("FAIL (exit $code)")
    FAILED=$((FAILED + 1))
  fi
  DURATIONS+=("$((SECONDS - check_started))s")
done

WIDTH=0
for name in "${NAMES[@]}"; do
  [ ${#name} -gt $WIDTH ] && WIDTH=${#name}
done

echo
echo "=== summary ==="
for i in "${!NAMES[@]}"; do
  printf '  %-*s  %-42s  %s\n' "$WIDTH" "${NAMES[$i]}" "${STATUSES[$i]}" "${DURATIONS[$i]}"
done
echo "Total gate time: $((SECONDS - GATE_STARTED))s"
echo
if [ "$FAILED" -eq 0 ]; then
  if [ "$WARNED" -eq 0 ]; then
    echo "All $TOTAL checks passed ($SKIPPED skipped)."
  else
    echo "All blocking checks passed; $WARNED non-blocking check(s) warned; $SKIPPED skipped."
  fi
  exit 0
fi
echo "$FAILED of $TOTAL checks FAILED."
exit 1
