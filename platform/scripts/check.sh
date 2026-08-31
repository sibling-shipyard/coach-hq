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

add_check() {
  NAMES+=("$1")
  DIRS+=("$2")
  CMDS+=("$3")
  POLICIES+=("$4")
}

add_check "ui typecheck (npm run check)" "$REPO_ROOT/ui" "npm run check" block
add_check "ui lint (npm run lint)" "$REPO_ROOT/ui" "npm run lint" block
add_check "ui format (npm run format:check)" "$REPO_ROOT/ui" "npm run format:check" block
add_check "ui tests (npm test)" "$REPO_ROOT/ui" "npm test" block
add_check "compose-soul --check" "$REPO_ROOT" "node platform/scripts/compose-soul.mjs --check" block
add_check "validate-soul" "$REPO_ROOT" "node platform/scripts/validate-soul.mjs" warn
add_check "validate_kdb" "$REPO_ROOT" "python3 kdb/scripts/validate_kdb.py" block
add_check "platform tests" "$REPO_ROOT" "python3 -m unittest discover -s platform/tests -p \"test_*.py\"" block

TOTAL=${#NAMES[@]}
STATUSES=()
DURATIONS=()
FAILED=0
WARNED=0
GATE_STARTED=$SECONDS

for i in "${!NAMES[@]}"; do
  n=$((i + 1))
  name="${NAMES[$i]}"
  policy="${POLICIES[$i]}"
  header="=== [$n/$TOTAL] $name ==="
  check_started=$SECONDS

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
    echo "All $TOTAL checks passed."
  else
    echo "All blocking checks passed; $WARNED non-blocking check(s) warned."
  fi
  exit 0
fi
echo "$FAILED of $TOTAL checks FAILED."
exit 1
