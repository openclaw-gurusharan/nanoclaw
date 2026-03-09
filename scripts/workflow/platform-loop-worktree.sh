#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKTREE_ROOT="${NANOCLAW_PLATFORM_ISSUE_WORKTREE_ROOT:-$ROOT_DIR/.worktrees}"
CONTROL_WORKTREE_PATH="${NANOCLAW_PLATFORM_LOOP_WORKTREE:-$WORKTREE_ROOT/platform-loop}"

usage() {
  cat <<'EOF'
Usage:
  scripts/workflow/platform-loop-worktree.sh prepare --issue <n> --branch <name> --base <branch>
  scripts/workflow/platform-loop-worktree.sh cleanup --issue <n> --branch <name>
EOF
}

require_clean_status() {
  local path="$1"
  if [[ -n "$(git -C "$path" status --porcelain)" ]]; then
    echo "Worktree has uncommitted changes: $path" >&2
    return 1
  fi
}

json_escape() {
  python3 - <<'PY' "$1"
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

issue_worktree_path() {
  local issue="$1"
  printf '%s/platform-%s' "$WORKTREE_ROOT" "$issue"
}

command_name="${1:-}"
shift || true

if [[ -z "$command_name" ]]; then
  usage >&2
  exit 1
fi

ISSUE_NUMBER=""
BRANCH_NAME=""
BASE_BRANCH=""

while (($#)); do
  case "$1" in
    --issue)
      ISSUE_NUMBER="$2"
      shift 2
      ;;
    --branch)
      BRANCH_NAME="$2"
      shift 2
      ;;
    --base)
      BASE_BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$ISSUE_NUMBER" || -z "$BRANCH_NAME" ]]; then
  echo "--issue and --branch are required" >&2
  usage >&2
  exit 1
fi

WORKTREE_PATH="$(issue_worktree_path "$ISSUE_NUMBER")"

case "$command_name" in
  prepare)
    if [[ -z "$BASE_BRANCH" ]]; then
      echo "--base is required for prepare" >&2
      usage >&2
      exit 1
    fi

    git -C "$ROOT_DIR" fetch origin "$BASE_BRANCH"

    if ! git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH" >/dev/null; then
      echo "Missing remote base branch origin/$BASE_BRANCH" >&2
      exit 1
    fi

    mkdir -p "$WORKTREE_ROOT"

    if [[ -d "$WORKTREE_PATH" ]]; then
      current_branch="$(git -C "$WORKTREE_PATH" branch --show-current)"
      if [[ "$current_branch" != "$BRANCH_NAME" ]]; then
        echo "Worktree path already exists on unexpected branch: $WORKTREE_PATH ($current_branch)" >&2
        exit 1
      fi

      if ! require_clean_status "$WORKTREE_PATH"; then
        exit 1
      fi

      git -C "$WORKTREE_PATH" fetch origin "$BASE_BRANCH"
    else
      if git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/heads/$BRANCH_NAME" >/dev/null; then
        git -C "$ROOT_DIR" worktree add "$WORKTREE_PATH" "$BRANCH_NAME" >/dev/null
      else
        git -C "$ROOT_DIR" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "origin/$BASE_BRANCH" >/dev/null
      fi
    fi

    cat <<EOF
{
  "action": "prepared",
  "issue": $(json_escape "$ISSUE_NUMBER"),
  "branch": $(json_escape "$BRANCH_NAME"),
  "baseBranch": $(json_escape "$BASE_BRANCH"),
  "worktreePath": $(json_escape "$WORKTREE_PATH")
}
EOF
    ;;
  cleanup)
    if [[ "$WORKTREE_PATH" == "$CONTROL_WORKTREE_PATH" ]]; then
      echo "Refusing to clean the control worktree: $WORKTREE_PATH" >&2
      exit 1
    fi

    if [[ ! -d "$WORKTREE_PATH" ]]; then
      cat <<EOF
{
  "action": "noop",
  "reason": "missing_worktree",
  "issue": $(json_escape "$ISSUE_NUMBER"),
  "branch": $(json_escape "$BRANCH_NAME"),
  "worktreePath": $(json_escape "$WORKTREE_PATH")
}
EOF
      exit 0
    fi

    if ! require_clean_status "$WORKTREE_PATH"; then
      cat <<EOF
{
  "action": "skipped",
  "reason": "dirty_worktree",
  "issue": $(json_escape "$ISSUE_NUMBER"),
  "branch": $(json_escape "$BRANCH_NAME"),
  "worktreePath": $(json_escape "$WORKTREE_PATH")
}
EOF
      exit 0
    fi

    git -C "$ROOT_DIR" worktree remove "$WORKTREE_PATH" >/dev/null
    git -C "$ROOT_DIR" branch -D "$BRANCH_NAME" >/dev/null 2>&1 || true
    git -C "$ROOT_DIR" worktree prune >/dev/null 2>&1 || true

    cat <<EOF
{
  "action": "cleaned",
  "issue": $(json_escape "$ISSUE_NUMBER"),
  "branch": $(json_escape "$BRANCH_NAME"),
  "worktreePath": $(json_escape "$WORKTREE_PATH")
}
EOF
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    usage >&2
    exit 1
    ;;
esac
