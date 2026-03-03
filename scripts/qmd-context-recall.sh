#!/usr/bin/env bash
set -euo pipefail

# qmd-context-recall.sh
# Syncs session exports when stale, updates QMD index, then runs context search.
#
# Usage:
#   scripts/qmd-context-recall.sh "worker connectivity dispatch"
#   scripts/qmd-context-recall.sh --force-sync --top 10 --fetch 3 --lines 160 "mcp startup failed"
#   scripts/qmd-context-recall.sh --no-get "branch-name issue"
#
# Env overrides:
#   QMD_BIN, SYNC_TOOL, SESSION_EXPORT_DIR, CODEX_DAYS, HANDOFF_FILE

QMD_BIN="${QMD_BIN:-qmd}"
SYNC_TOOL="${SYNC_TOOL:-$HOME/.claude/skills/sync-claude-sessions/scripts/claude-sessions}"
SESSION_EXPORT_DIR="${SESSION_EXPORT_DIR:-$HOME/Documents/remote-claude/Obsidian/Claude-Sessions}"
CODEX_DAYS="${CODEX_DAYS:-21}"
HANDOFF_FILE="${HANDOFF_FILE:-$(pwd)/.claude/progress/session-handoff.jsonl}"

TOP=8
FETCH=2
LINES=140
COLLECTION="sessions"
FORCE_SYNC=0
NO_SYNC=0
MODE="search"
ISSUE_ID=""
DONE_TEXT=""
NEXT_STEP=""
BLOCKER_TEXT=""
COMMANDS_RUN=""
SESSION_STATE="handoff"
USER_SET_TOP=0
USER_SET_FETCH=0

usage() {
  cat <<'EOF'
Usage:
  qmd-context-recall.sh [options] "<query>"
  qmd-context-recall.sh --bootstrap [options] ["<query>"]
  qmd-context-recall.sh --close --next "<next step>" [options]

Options:
  --top N          Number of search hits (default: 8)
  --fetch N        Number of top hits to expand with qmd get (default: 2)
  --lines N        Lines to fetch per expanded hit (default: 140)
  --collection C   QMD collection (default: sessions)
  --bootstrap      Session-start mode: sync/search with handoff-aware query
  --close          Session-end mode: write structured handoff record
  --issue ID       Issue/ticket identifier (e.g., INC-123, GH-42)
  --done TEXT      What was completed in this session
  --next TEXT      Next concrete step for the next session
  --blocker TEXT   Current blocker, if any
  --commands TEXT  Important commands run in this session
  --state STATE    active|done|blocked|handoff (default: handoff)
  --force-sync     Force Claude/Codex export + qmd update before search
  --no-sync        Skip sync/update checks
  --no-get         Don't expand hits with qmd get
  -h, --help       Show this help
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

compact_words() {
  local text="$1"
  local max_words="$2"
  printf '%s' "$text" | tr '\n' ' ' | tr -s ' ' | awk -v n="$max_words" '
    {
      out="";
      count=0;
      for (i=1; i<=NF && count<n; i++) {
        if (length($i) == 0) continue;
        out = out (count ? " " : "") $i;
        count++;
      }
      print out;
    }'
}

latest_mtime_for_ext() {
  local dir="$1"
  local ext="$2"
  local latest=0
  local file=""
  [[ -d "$dir" ]] || {
    echo 0
    return
  }
  while IFS= read -r -d '' file; do
    local m=0
    m="$(stat -f '%m' "$file" 2>/dev/null || echo 0)"
    if (( m > latest )); then
      latest="$m"
    fi
  done < <(find "$dir" -type f -name "*.${ext}" -print0 2>/dev/null)
  echo "$latest"
}

detect_claude_project_dir() {
  local cwd encoded path
  cwd="$(pwd)"
  encoded="${cwd//\//-}"
  path="$HOME/.claude/projects/${encoded}"
  if [[ -d "$path" ]]; then
    echo "$path"
    return
  fi
  # Fallback: most recently modified Claude project directory.
  local latest=""
  latest="$(ls -td "$HOME"/.claude/projects/* 2>/dev/null | head -n 1 || true)"
  if [[ -n "$latest" ]]; then
    echo "$latest"
    return
  fi
  echo ""
}

load_latest_handoff() {
  local branch="$1"
  python3 - "$HANDOFF_FILE" "$branch" <<'PY'
import json, os, sys
path = sys.argv[1]
branch = sys.argv[2]
blank = "\t".join([""] * 7)
if not os.path.exists(path):
    print(blank)
    raise SystemExit(0)
rows = []
with open(path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
if not rows:
    print(blank)
    raise SystemExit(0)
branch_rows = [r for r in rows if str(r.get("branch", "")).strip() == branch]
row = branch_rows[-1] if branch_rows else rows[-1]
def norm(v):
    if v is None:
        return ""
    if isinstance(v, list):
        v = ", ".join(str(x) for x in v)
    s = str(v).replace("\t", " ").replace("\n", " ").strip()
    return s
fields = ["timestamp", "branch", "issue", "state", "done", "next_step", "blocker"]
print("\t".join(norm(row.get(k, "")) for k in fields))
PY
}

save_handoff() {
  local ts="$1"
  local branch="$2"
  local issue="$3"
  local state="$4"
  local done="$5"
  local next="$6"
  local blocker="$7"
  local commands="$8"
  local files="$9"

  mkdir -p "$(dirname "$HANDOFF_FILE")"
  python3 - "$HANDOFF_FILE" "$ts" "$branch" "$issue" "$state" "$done" "$next" "$blocker" "$commands" "$files" <<'PY'
import json, os, sys
path, ts, branch, issue, state, done, next_step, blocker, commands, files = sys.argv[1:]
files_list = [f for f in files.split(",") if f.strip()]
record = {
    "timestamp": ts,
    "branch": branch,
    "issue": issue,
    "state": state,
    "done": done,
    "next_step": next_step,
    "blocker": blocker,
    "commands_run": commands,
    "files_touched": files_list,
}
with open(path, "a", encoding="utf-8") as f:
    f.write(json.dumps(record, ensure_ascii=True) + "\n")
print(path)
PY
}

run_sync() {
  if [[ ! -f "$SYNC_TOOL" ]]; then
    echo "Sync tool not found at: $SYNC_TOOL" >&2
    echo "Skipping sync. Continuing with current QMD index." >&2
    return 0
  fi
  local vault_dir=""
  vault_dir="$(cd -- "$(dirname -- "$SESSION_EXPORT_DIR")" && pwd -P)"
  echo "Syncing Claude sessions (today)..."
  VAULT_DIR="$vault_dir" python3 "$SYNC_TOOL" export --today
  echo "Syncing Codex sessions (last ${CODEX_DAYS} days)..."
  VAULT_DIR="$vault_dir" python3 "$SYNC_TOOL" codex-export --days "$CODEX_DAYS" --output "$SESSION_EXPORT_DIR"
  echo "Refreshing QMD index..."
  "$QMD_BIN" update
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --top)
      TOP="${2:-}"
      USER_SET_TOP=1
      shift 2
      ;;
    --fetch)
      FETCH="${2:-}"
      USER_SET_FETCH=1
      shift 2
      ;;
    --lines)
      LINES="${2:-}"
      shift 2
      ;;
    --collection)
      COLLECTION="${2:-}"
      shift 2
      ;;
    --bootstrap)
      MODE="bootstrap"
      shift
      ;;
    --close)
      MODE="close"
      shift
      ;;
    --issue)
      ISSUE_ID="${2:-}"
      shift 2
      ;;
    --done)
      DONE_TEXT="${2:-}"
      shift 2
      ;;
    --next)
      NEXT_STEP="${2:-}"
      shift 2
      ;;
    --blocker)
      BLOCKER_TEXT="${2:-}"
      shift 2
      ;;
    --commands)
      COMMANDS_RUN="${2:-}"
      shift 2
      ;;
    --state)
      SESSION_STATE="${2:-}"
      shift 2
      ;;
    --force-sync)
      FORCE_SYNC=1
      shift
      ;;
    --no-sync)
      NO_SYNC=1
      shift
      ;;
    --no-get)
      FETCH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

if [[ "$MODE" == "close" ]]; then
  if [[ "$SESSION_STATE" != "active" && "$SESSION_STATE" != "done" && "$SESSION_STATE" != "blocked" && "$SESSION_STATE" != "handoff" ]]; then
    echo "Invalid --state: $SESSION_STATE (expected active|done|blocked|handoff)" >&2
    exit 2
  fi
  if [[ -z "$NEXT_STEP" && -z "$DONE_TEXT" && -z "$BLOCKER_TEXT" ]]; then
    echo "--close requires at least one of --next, --done, or --blocker." >&2
    exit 2
  fi

  FILES_TOUCHED="$({
    git diff --name-only 2>/dev/null || true
    git diff --name-only --cached 2>/dev/null || true
  } | awk 'NF' | sort -u | head -n 40 | paste -sd',' -)"
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
    BRANCH="unknown-branch"
  fi

  save_handoff "$TS" "$BRANCH" "$ISSUE_ID" "$SESSION_STATE" "$DONE_TEXT" "$NEXT_STEP" "$BLOCKER_TEXT" "$COMMANDS_RUN" "$FILES_TOUCHED" >/dev/null
  echo "Handoff saved to: $HANDOFF_FILE"
  echo "  branch:  $BRANCH"
  [[ -n "$ISSUE_ID" ]] && echo "  issue:   $ISSUE_ID"
  [[ -n "$DONE_TEXT" ]] && echo "  done:    $DONE_TEXT"
  [[ -n "$NEXT_STEP" ]] && echo "  next:    $NEXT_STEP"
  [[ -n "$BLOCKER_TEXT" ]] && echo "  blocker: $BLOCKER_TEXT"
  [[ -n "$FILES_TOUCHED" ]] && echo "  files:   $FILES_TOUCHED"
  echo
  echo "Next session:"
  if [[ -n "$ISSUE_ID" ]]; then
    echo "  qctx --bootstrap --issue \"$ISSUE_ID\""
  else
    echo "  qctx --bootstrap"
  fi
  exit 0
fi

QUERY="${*:-}"

require_cmd "$QMD_BIN"
require_cmd python3

if [[ "$MODE" == "bootstrap" ]]; then
  if (( USER_SET_TOP == 0 )); then
    TOP=10
  fi
  if (( USER_SET_FETCH == 0 )); then
    FETCH=3
  fi
fi

if (( NO_SYNC == 0 )); then
  CLAUDE_DIR="$(detect_claude_project_dir)"
  CLAUDE_LATEST=0
  CODEX_LATEST=0
  EXPORT_LATEST=0

  if [[ -n "$CLAUDE_DIR" ]]; then
    CLAUDE_LATEST="$(latest_mtime_for_ext "$CLAUDE_DIR" "jsonl")"
  fi
  CODEX_LATEST="$(latest_mtime_for_ext "$HOME/.codex/sessions" "jsonl")"
  EXPORT_LATEST="$(latest_mtime_for_ext "$SESSION_EXPORT_DIR" "md")"

  SOURCE_LATEST="$CLAUDE_LATEST"
  if (( CODEX_LATEST > SOURCE_LATEST )); then
    SOURCE_LATEST="$CODEX_LATEST"
  fi

  NEED_SYNC=0
  if (( FORCE_SYNC == 1 )) || (( SOURCE_LATEST > EXPORT_LATEST )); then
    NEED_SYNC=1
  fi

  if (( NEED_SYNC == 1 )); then
    run_sync
  else
    echo "Session exports are up to date. Skipping sync."
  fi
fi

LAST_TS=""
LAST_BRANCH=""
LAST_ISSUE=""
LAST_STATE=""
LAST_DONE=""
LAST_NEXT=""
LAST_BLOCKER=""
if [[ "$MODE" == "bootstrap" ]]; then
  IFS=$'\t' read -r LAST_TS LAST_BRANCH LAST_ISSUE LAST_STATE LAST_DONE LAST_NEXT LAST_BLOCKER < <(load_latest_handoff "${BRANCH:-}")
  if [[ -z "$ISSUE_ID" && -n "$LAST_ISSUE" ]]; then
    ISSUE_ID="$LAST_ISSUE"
  fi
  if [[ -z "$QUERY" ]]; then
    QUERY_PARTS=()
    if [[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]]; then
      QUERY_PARTS+=("$BRANCH")
    fi
    [[ -n "$ISSUE_ID" ]] && QUERY_PARTS+=("$ISSUE_ID")
    [[ -n "$LAST_NEXT" ]] && QUERY_PARTS+=("$(compact_words "$LAST_NEXT" 8)")
    [[ -n "$LAST_BLOCKER" ]] && QUERY_PARTS+=("$(compact_words "$LAST_BLOCKER" 6)")
    QUERY="$(printf '%s ' "${QUERY_PARTS[@]}" | tr -s ' ' | sed 's/[[:space:]]*$//')"
  fi
fi

if [[ -z "$QUERY" ]]; then
  if [[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]]; then
    QUERY="$BRANCH"
  else
    usage
    exit 2
  fi
fi

if [[ "$MODE" == "bootstrap" ]]; then
  echo
  echo "Bootstrap context:"
  [[ -n "$BRANCH" ]] && echo "  branch:    $BRANCH"
  [[ -n "$ISSUE_ID" ]] && echo "  issue:     $ISSUE_ID"
  [[ -n "$LAST_TS" ]] && echo "  handoff:   $LAST_TS (${LAST_STATE:-unknown})"
  [[ -n "$LAST_DONE" ]] && echo "  last done: $LAST_DONE"
  [[ -n "$LAST_NEXT" ]] && echo "  next step: $LAST_NEXT"
  [[ -n "$LAST_BLOCKER" ]] && echo "  blocker:   $LAST_BLOCKER"
fi

echo
echo "Searching QMD context..."
echo "  query:      $QUERY"
echo "  collection: $COLLECTION"
echo

SEARCH_CMD=("$QMD_BIN" search "$QUERY" -c "$COLLECTION" -n "$TOP" --files)
RESULTS="$("${SEARCH_CMD[@]}" 2>&1 || true)"

if [[ "$RESULTS" == *"No results found."* ]] && [[ -n "$BRANCH" ]] && [[ "$QUERY" != *"$BRANCH"* ]] && [[ "$BRANCH" != "main" ]] && [[ "$BRANCH" != "master" ]] && [[ "$BRANCH" != "HEAD" ]]; then
  ALT_QUERY="$QUERY $BRANCH"
  echo "No direct hits. Retrying with branch context: $ALT_QUERY"
  RESULTS="$("$QMD_BIN" search "$ALT_QUERY" -c "$COLLECTION" -n "$TOP" --files 2>&1 || true)"
fi

echo "$RESULTS"

if [[ "$MODE" == "bootstrap" ]]; then
  echo
  if [[ -n "$LAST_NEXT" ]]; then
    echo "Next Action: $LAST_NEXT"
  else
    TOP_DOCID="$(printf '%s\n' "$RESULTS" | awk -F',' '/^#/{print $1; exit}')"
    if [[ -n "$TOP_DOCID" ]]; then
      echo "Next Action: Review $TOP_DOCID first, then continue current branch task."
    fi
  fi
fi

if (( FETCH <= 0 )); then
  exit 0
fi

mapfile -t DOC_IDS < <(printf '%s\n' "$RESULTS" | awk -F',' '/^#/{print $1}' | head -n "$FETCH")
if (( ${#DOC_IDS[@]} == 0 )); then
  exit 0
fi

echo
echo "Top context snippets:"
for docid in "${DOC_IDS[@]}"; do
  echo "--------------------------------------------------------------------------------"
  echo "$docid"
  "$QMD_BIN" get "$docid" -l "$LINES"
  echo
done
