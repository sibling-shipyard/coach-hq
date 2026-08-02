#!/usr/bin/env bash
# provision-user.sh — Operator tool: fork coach-skeleton → private athlete repo.
#
# Modes:
#   --greenfield   Skeleton as-is (new athlete)
#   --migrate      Overlay legacy coach-phelps data with path rewrite
#
# See docs/eng-docs/provision-runbook.md for the full operator checklist.
set -euo pipefail

SKELETON_REPO="sibling-shipyard/coach-skeleton"
APP_INSTALL_URL="https://github.com/apps/coach-phelps/installations/new"

usage() {
  cat <<'EOF'
Usage:
  platform/scripts/provision-user.sh --greenfield --repo OWNER/coach-name [options]
  platform/scripts/provision-user.sh --migrate --repo OWNER/coach-name --legacy OWNER/coach-phelps [options]

Options:
  --repo OWNER/NAME       Target private athlete repo (created if missing)
  --legacy OWNER/NAME     Legacy repo to migrate (required for --migrate)
  --dry-run               Print actions; do not create repos, push, or set secrets
  --skip-secrets          Do not set GitHub Actions secrets
  --skip-push             Clone and migrate locally only (for inspection)
  --skip-regenerate       Copy legacy gen/ only; skip pipeline regen (not recommended)
  --plugins LIST          Comma-separated plugins to enable (e.g. badminton)
  -h, --help              Show this help

Secrets:
  None required. Sync and Apply Coach Patch run under the built-in GITHUB_TOKEN
  (contents: write). Strava athletes may set Strava secrets separately if needed.

Examples:
  platform/scripts/provision-user.sh --greenfield --repo akash-suresh/coach-akash --dry-run
  platform/scripts/provision-user.sh --migrate \
    --repo skanda-2003/coach-skanda --legacy skanda-2003/coach-phelps --plugins badminton
EOF
}

log() { printf '→ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

MODE=""
TARGET_REPO=""
LEGACY_REPO=""
DRY_RUN=0
SKIP_SECRETS=0
SKIP_PUSH=0
SKIP_REGENERATE=0
PROVISION_PLUGINS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --greenfield) MODE="greenfield" ;;
    --migrate) MODE="migrate" ;;
    --repo) TARGET_REPO="${2:?}"; shift ;;
    --legacy) LEGACY_REPO="${2:?}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    --skip-secrets) SKIP_SECRETS=1 ;;
    --skip-push) SKIP_PUSH=1 ;;
    --skip-regenerate) SKIP_REGENERATE=1 ;;
    --plugins) PROVISION_PLUGINS="${2:?}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

[[ -n "$MODE" ]] || die "Specify --greenfield or --migrate"
[[ -n "$TARGET_REPO" ]] || die "--repo OWNER/NAME is required"
[[ "$TARGET_REPO" == */* ]] || die "--repo must be OWNER/NAME"
if [[ "$MODE" == "migrate" ]]; then
  [[ -n "$LEGACY_REPO" ]] || die "--legacy OWNER/NAME is required for --migrate"
  [[ "$LEGACY_REPO" == */* ]] || die "--legacy must be OWNER/NAME"
fi

command -v gh >/dev/null || die "gh CLI required (https://cli.github.com)"
command -v git >/dev/null || die "git required"

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] $*"
  else
    log "$*"
    "$@"
  fi
}

gh_quiet() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] gh $*"
  else
    gh "$@"
  fi
}

# Copy legacy path → new layout path inside $WORKDIR (target repo root).
apply_legacy_overlay() {
  local legacy_root="$1"
  local target_root="$2"

  copy_tree() {
    local src_rel="$1"
    local dst_rel="$2"
    local required="${3:-0}"
    local src="${legacy_root}/${src_rel}"
    local dst="${target_root}/${dst_rel}"
    if [[ -e "$src" ]]; then
      mkdir -p "$(dirname "$dst")"
      if [[ -d "$src" ]]; then
        rm -rf "$dst"
        cp -R "$src" "$dst"
        log "  copied ${src_rel}/ → ${dst_rel}/"
      else
        cp "$src" "$dst"
        log "  copied ${src_rel} → ${dst_rel}"
      fi
    elif [[ "$required" -eq 1 ]]; then
      die "Required legacy path missing: ${src_rel} (check ${LEGACY_REPO})"
    else
      warn "  missing ${src_rel} (skipped)"
    fi
  }

  log "Applying legacy → new path map from ${LEGACY_REPO}:"

  copy_tree "training/coach" "user_data/coach" 1
  copy_tree "training/ledger" "user_data/ledger" 1
  copy_tree "training/activities/history" "user_data/activities/hist" 0
  copy_tree "training/reference" "user_data/coach/reference"
  copy_tree "sessions" "user_data/activities/workout_plans/sessions"
  copy_tree "templates" "user_data/activities/workout_plans/templates"
  copy_tree "training/seasons" "user_data/ledger/seasons"

  copy_tree "training/activities/sleep_log.json" "user_data/coach/sleep_log.json"
  copy_tree "training/chat_history.json" "user_data/coach/chat_history.json"
  copy_tree "training/sync_state.json" "user_data/activities/sync_state.json"
  copy_tree "training/sync_status.json" "gen/sync_status.json"
  copy_tree "training/widget_snapshots.json" "gen/widget_snapshots.json"
  copy_tree "training/activities/quest_log.md" "gen/quest_log.md"
  copy_tree "training/activities/quest_history.json" "gen/quest_history.json"
  copy_tree "data/aggregate.json" "gen/aggregate.json"

  copy_tree "training/ebadders_history.json" "training/ebadders_history.json"
  copy_tree "plugins/badminton/data/badminton_match_data.json" "user_data/activities/badminton_match_data.json"

  # Remove skeleton seed placeholders when hist/ has real files
  if [[ -d "${target_root}/user_data/activities/hist" ]]; then
    find "${target_root}/user_data/activities/hist" -name '.gitkeep' -delete 2>/dev/null || true
  fi
}

# Copy enabled plugin packs from HQ and write user_data/ledger/plugins.json.
install_provision_plugins() {
  local target_root="$1"
  local hq_root="$2"
  local plugins_csv="$3"

  [[ -n "$plugins_csv" ]] || return 0

  local -a enabled=()
  local -a names=()
  IFS=',' read -r -a names <<< "$plugins_csv"

  for raw in "${names[@]}"; do
    local name
    name="$(echo "$raw" | xargs)"
    [[ -n "$name" ]] || continue

    case "$name" in
      badminton)
        mkdir -p "${target_root}/engine/plugins"
        rm -rf "${target_root}/engine/plugins/badminton"
        cp -R "${hq_root}/platform/plugins/badminton" "${target_root}/engine/plugins/badminton"
        log "  installed engine/plugins/badminton/"
        mkdir -p "${target_root}/user_data/coach/reference"
        cp "${hq_root}/platform/skeleton-templates/reference/badminton.md" \
          "${target_root}/user_data/coach/reference/badminton.md"
        log "  seeded user_data/coach/reference/badminton.md"
        enabled+=("badminton")
        ;;
      *)
        warn "Unknown plugin '${name}' — skipped"
        ;;
    esac
  done

  if [[ ${#enabled[@]} -eq 0 ]]; then
    return 0
  fi

  local plugins_json="${target_root}/user_data/ledger/plugins.json"
  mkdir -p "$(dirname "$plugins_json")"
  PROVISION_PLUGINS_JSON="$plugins_json" PROVISION_PLUGINS_ENABLED="${enabled[*]}" python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["PROVISION_PLUGINS_JSON"])
enabled = [s for s in os.environ.get("PROVISION_PLUGINS_ENABLED", "").split() if s]
path.write_text(json.dumps({"enabled": enabled}, indent=2) + "\n")
PY
  log "  wrote user_data/ledger/plugins.json → enabled: ${enabled[*]}"
}

legacy_wants_badminton_plugin() {
  local target_root="$1"
  [[ -f "${target_root}/training/ebadders_history.json" ]] && return 0
  [[ -f "${target_root}/gen/badminton_analytics_snapshot.json" ]] && return 0
  [[ -f "${target_root}/user_data/activities/badminton_analytics_snapshot.json" ]] && return 0
  [[ -f "${target_root}/user_data/activities/badminton_match_data.json" ]] && return 0
  [[ -f "${target_root}/user_data/activities/match_history.json" ]] && return 0
  return 1
}

# Rebuild gen/ from migrated user_data/ (quest_log, quest_history, aggregate).
regenerate_gen() {
  local target_root="$1"
  local hq_root
  hq_root="$(cd "$(dirname "$0")/../.." && pwd)"
  command -v python3 >/dev/null || die "python3 required for gen/ regeneration"
  command -v node >/dev/null || die "node required for gen/ regeneration"

  # Run badminton match history migration if legacy match data exists
  if [[ -f "${hq_root}/platform/scripts/migrate_match_history.py" ]]; then
    (cd "$target_root" && python3 "${hq_root}/platform/scripts/migrate_match_history.py") || warn "Match history migration skipped or failed"
  fi

  # Skeleton may lag HQ engine fixes — sync layout helpers before regen.
  if [[ -f "${hq_root}/engine/lib/repo_layout.py" ]]; then
    cp "${hq_root}/engine/lib/repo_layout.py" "${target_root}/engine/lib/repo_layout.py"
    cp "${hq_root}/engine/lib/repo-layout.mjs" "${target_root}/engine/lib/repo-layout.mjs"
    cp "${hq_root}/engine/lib/plugins.py" "${target_root}/engine/lib/plugins.py"
    cp "${hq_root}/engine/lib/plugins.mjs" "${target_root}/engine/lib/plugins.mjs"
    cp "${hq_root}/engine/lib/challenge_schema.py" "${target_root}/engine/lib/challenge_schema.py"
    cp "${hq_root}/engine/lib/current-week.mts" "${target_root}/engine/lib/current-week.mts"
    cp "${hq_root}/engine/scripts/generate_quest_log.py" "${target_root}/engine/scripts/generate_quest_log.py"
    cp "${hq_root}/engine/scripts/generate_quest_history.py" "${target_root}/engine/scripts/generate_quest_history.py"
    cp "${hq_root}/engine/scripts/regenerate_derived.py" "${target_root}/engine/scripts/regenerate_derived.py"
    cp "${hq_root}/engine/scripts/build-aggregate.mjs" "${target_root}/engine/scripts/build-aggregate.mjs"
    cp "${hq_root}/engine/scripts/validate-current-week.mts" "${target_root}/engine/scripts/validate-current-week.mts"
    cp "${hq_root}/engine/scripts/validate-current-week" "${target_root}/engine/scripts/validate-current-week"
    chmod +x "${target_root}/engine/scripts/validate-current-week"
    cp "${hq_root}/engine/claude/athlete/CLAUDE.md" "${target_root}/CLAUDE.md"
    mkdir -p "${target_root}/.claude/hooks"
    cp "${hq_root}/engine/claude/athlete/hooks/session-start.sh" "${target_root}/.claude/hooks/session-start.sh"
    chmod +x "${target_root}/.claude/hooks/session-start.sh"
    cp "${hq_root}/engine/claude/athlete/settings.json" "${target_root}/.claude/settings.json"
    cp "${hq_root}/platform/SOUL.md" "${target_root}/propagated/SOUL.md"
  fi

  log "Regenerating gen/ from migrated user_data/..."
  if ! (cd "$target_root" && python3 engine/scripts/regenerate_derived.py); then
    warn "regenerate_derived.py failed (schema mismatch?) — legacy gen/ copies kept; rebuilding aggregate"
  fi
  (cd "$target_root" && node engine/scripts/build-aggregate.mjs --aggregate)
  log "  gen/ regenerated (aggregate + best-effort quest files)"
}

# Fail fast if overlay left skeleton seeds in place.
verify_migration() {
  local target_root="$1"
  local challenge="${target_root}/user_data/ledger/challenge_v2.json"
  local aggregate="${target_root}/gen/aggregate.json"

  [[ -f "$challenge" ]] || die "Missing user_data/ledger/challenge_v2.json after overlay"

  if grep -q '"My 60-Day Challenge"' "$challenge" 2>/dev/null; then
    die "challenge_v2.json still skeleton template — legacy overlay did not run"
  fi

  [[ -f "$aggregate" ]] || die "Missing gen/aggregate.json after regen"

  if grep -q '"generated_at": "1970-01-01' "$aggregate" 2>/dev/null; then
    die "aggregate.json still skeleton placeholder — run regen or check hist/ + ledger/"
  fi

  local activity_count
  activity_count="$(python3 -c "import json; print(len(json.load(open('${aggregate}')).get('activities',[])))")"
  log "  verified: challenge migrated, aggregate has ${activity_count} activities"

  local hist_dir="${target_root}/user_data/activities/hist"
  local hist_count=0
  if [[ -d "$hist_dir" ]]; then
    hist_count="$(find "$hist_dir" -name '*.json' | wc -l | tr -d ' ')"
  fi
  if [[ "$hist_count" -eq 0 && "$activity_count" -gt 0 ]]; then
    warn "hist/ empty but aggregate has activities — ensure git add -f hist/ on push"
  elif [[ "$hist_count" -gt 0 ]]; then
    log "  verified: ${hist_count} activity files in hist/"
  fi
}

ensure_target_repo() {
  if gh repo view "$TARGET_REPO" >/dev/null 2>&1; then
    log "Target repo exists: https://github.com/${TARGET_REPO}"
    return 0
  fi

  log "Creating ${TARGET_REPO} from template ${SKELETON_REPO}..."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "[dry-run] gh repo create ${TARGET_REPO} --private --template ${SKELETON_REPO}"
    return 0
  fi

  gh repo view "$SKELETON_REPO" >/dev/null 2>&1 || die "Template ${SKELETON_REPO} not found — run carve-skeleton.mjs --push first"

  # --template requires the template repo to be marked as template (org setting).
  if gh repo create "$TARGET_REPO" --private --template "$SKELETON_REPO" 2>/dev/null; then
    return 0
  fi

  warn "Template create failed — falling back to clone + push"
  local tmp
  tmp="$(mktemp -d)"
  git clone --depth 1 "https://github.com/${SKELETON_REPO}.git" "$tmp/skeleton"
  rm -rf "$tmp/skeleton/.git"
  gh repo create "$TARGET_REPO" --private --description "Coach Phelps athlete repo"
  git -C "$tmp/skeleton" init -b main
  git -C "$tmp/skeleton" add -A
  git -C "$tmp/skeleton" commit -m "core: provision from ${SKELETON_REPO}"
  git -C "$tmp/skeleton" remote add origin "https://github.com/${TARGET_REPO}.git"
  git -C "$tmp/skeleton" push -u origin main
  rm -rf "$tmp"
}

clone_to_workdir() {
  local url="$1"
  local dest="$2"
  if [[ "$DRY_RUN" -eq 1 && ! -d "$dest/.git" ]]; then
    log "[dry-run] git clone ${url} → ${dest} (skipped — dir missing)"
    return 0
  fi
  rm -rf "$dest"
  git clone "$url" "$dest"
}

set_repo_secrets() {
  [[ "$SKIP_SECRETS" -eq 1 ]] && { log "Skipping secrets (--skip-secrets)"; return 0; }

  # Sync and Apply Coach Patch run under the built-in GITHUB_TOKEN (contents: write) —
  # no PAT or repo secret required. Strava secrets, if ever needed, are set separately.
  log "No repo secrets required (workflows use the built-in GITHUB_TOKEN)."
}

print_next_steps() {
  cat <<EOF

✓ Provision complete for ${TARGET_REPO} (${MODE})

Next steps (operator + athlete):
  1. Athlete installs GitHub App: ${APP_INSTALL_URL}
     (select repo: ${TARGET_REPO})
  2. No secrets to set — workflows use the built-in GITHUB_TOKEN.
     Confirm Settings → Actions → General → Workflow permissions = Read and write.
  3. Validation (docs/eng-docs/m1-plan.md §7):
     - validate-data.yml green on first push
     - Shared site login → repo resolves
     - Dashboard loads gen/aggregate.json
     - BYO boot reads user_data/coach/state.md
     - Sync: iOS push

Legacy repo kept as backup — do not delete ${LEGACY_REPO:-N/A}.
EOF
}

# --- main ---

log "Mode: ${MODE} → https://github.com/${TARGET_REPO}"
[[ "$MODE" == "migrate" ]] && log "Legacy: https://github.com/${LEGACY_REPO}"

ensure_target_repo

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

if [[ "$MODE" == "greenfield" && "$SKIP_PUSH" -eq 0 && "$DRY_RUN" -eq 0 ]]; then
  set_repo_secrets
  print_next_steps
  exit 0
fi

if [[ "$MODE" == "migrate" || "$SKIP_PUSH" -eq 1 ]]; then
  clone_to_workdir "https://github.com/${TARGET_REPO}.git" "${WORKDIR}/target"

  if [[ "$MODE" == "migrate" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "[dry-run] would clone legacy ${LEGACY_REPO} and apply path overlay"
      if gh repo view "$LEGACY_REPO" >/dev/null 2>&1; then
        log "[dry-run] legacy repo reachable"
      else
        warn "[dry-run] cannot view ${LEGACY_REPO} — check gh auth / access"
      fi
    else
      clone_to_workdir "https://github.com/${LEGACY_REPO}.git" "${WORKDIR}/legacy"
      apply_legacy_overlay "${WORKDIR}/legacy" "${WORKDIR}/target"
      if [[ -z "$PROVISION_PLUGINS" ]] && legacy_wants_badminton_plugin "${WORKDIR}/target"; then
        PROVISION_PLUGINS="badminton"
        log "Legacy badminton match data detected — enabling badminton plugin"
      fi
      hq_root="$(cd "$(dirname "$0")/../.." && pwd)"
      install_provision_plugins "${WORKDIR}/target" "$hq_root" "$PROVISION_PLUGINS"
      if [[ "$SKIP_REGENERATE" -eq 0 ]]; then
        regenerate_gen "${WORKDIR}/target"
      else
        warn "Skipping gen/ regeneration (--skip-regenerate)"
      fi
      verify_migration "${WORKDIR}/target"
    fi
  fi

  if [[ "$SKIP_PUSH" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
    log "Local workdir: ${WORKDIR}/target (not pushed)"
    [[ "$DRY_RUN" -eq 1 ]] && exit 0
    # --skip-push: overlay applied locally for inspection only
    set_repo_secrets
    print_next_steps
    exit 0
  fi

  if [[ "$MODE" == "migrate" ]]; then
    pushd "${WORKDIR}/target" >/dev/null
    git add -A
    # hist/ is gitignored in skeleton (iOS/Strava write path) but must be
    # committed on migrate — legacy repos track activity source files.
    if [[ -d user_data/activities/hist ]]; then
      git add -f user_data/activities/hist/
    fi
    if git diff --cached --quiet; then
      warn "No changes after migration overlay"
    else
      git commit -m "core: migrate from ${LEGACY_REPO} (path rewrite to user_data/ + gen/)"
      git push origin main
      log "Pushed migration commit to ${TARGET_REPO}"
    fi
    popd >/dev/null
  fi
fi

set_repo_secrets
print_next_steps
