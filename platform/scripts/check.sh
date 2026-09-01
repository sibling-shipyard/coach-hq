#!/usr/bin/env bash
#
# check.sh — run every check in the repo, in one shot, and report all of them.
#
# The point is the *summary*: an agent that fixes the first failure, re-runs, finds the second,
# and repeats pays a full tsc+vitest cycle each time. So no `set -e` — every check runs even
# after one fails, and the table at the end is the whole picture.
#
# Usage:
#   bash platform/scripts/check.sh            # full output per check
#   bash platform/scripts/check.sh --quiet    # summary only; failing checks still print output
set -uo pipefail

# Derive the root from this script's location — the caller's cwd is not ours to trust.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

QUIET=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    -h|--help)
      echo "Usage: bash platform/scripts/check.sh [--quiet]"
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

NAMES=()
DIRS=()
CMDS=()

# Read checks from checks.conf; skip blank lines and comments.
# $REPO_ROOT in the dir field is expanded via parameter substitution.
while IFS='|' read -r name dir cmd || [ -n "$name" ]; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  dir="${dir/\$REPO_ROOT/$REPO_ROOT}"
  NAMES+=("$name")
  DIRS+=("$dir")
  CMDS+=("$cmd")
done < "$SCRIPT_DIR/checks.conf"

# validate_kdb is hardcoded here — it is not in checks.conf because it validates
# the repo's knowledge-base tooling (including checks.conf itself) and must always run last.
NAMES+=("validate_kdb")
DIRS+=("$REPO_ROOT")
CMDS+=("python3 kdb/scripts/validate_kdb.py")

TOTAL=${#NAMES[@]}
STATUSES=()
FAILED=0

for i in "${!NAMES[@]}"; do
  n=$((i + 1))
  name="${NAMES[$i]}"
  header="=== [$n/$TOTAL] $name ==="

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

  if [ $code -eq 0 ]; then
    STATUSES+=("PASS")
  else
    STATUSES+=("FAIL (exit $code)")
    FAILED=$((FAILED + 1))
  fi
done

WIDTH=0
for name in "${NAMES[@]}"; do
  [ ${#name} -gt $WIDTH ] && WIDTH=${#name}
done

# The git hooks are versioned but each clone has to opt in, so a fresh checkout enforces
# nothing until someone runs the command below. Say so here rather than letting it fail quiet.
if [ "$(git -C "$REPO_ROOT" config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
  echo
  echo "note: pre-commit hooks are not enabled in this clone."
  echo "      enable them with:  git config core.hooksPath .githooks"
fi

echo
echo "=== summary ==="
for i in "${!NAMES[@]}"; do
  printf '  %-*s  %s\n' "$WIDTH" "${NAMES[$i]}" "${STATUSES[$i]}"
done
echo
if [ "$FAILED" -eq 0 ]; then
  echo "All $TOTAL checks passed."
  exit 0
fi
echo "$FAILED of $TOTAL checks FAILED."
exit 1
