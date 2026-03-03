#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${DB_PATH:-$ROOT_DIR/store/messages.db}"
WINDOW_MINUTES="${WINDOW_MINUTES:-180}"
RECENT_LIMIT="${RECENT_LIMIT:-12}"
REASON_LIMIT="${REASON_LIMIT:-10}"
STALE_QUEUED_MINUTES="${STALE_QUEUED_MINUTES:-20}"
STALE_RUNNING_MINUTES="${STALE_RUNNING_MINUTES:-60}"
JSON_MODE=0
JSON_OUT=""

CHECKS_FILE="$(mktemp /tmp/jarvis-status-checks.XXXXXX)"
trap 'rm -f "$CHECKS_FILE"' EXIT

usage() {
  cat <<'USAGE'
Usage: scripts/jarvis-status.sh [options]

Options:
  --window-minutes <n>         Sliding window in minutes (default: 180)
  --recent-limit <n>           Number of recent runs (default: 12)
  --reason-limit <n>           Top failure reasons to show (default: 10)
  --stale-queued-minutes <n>   Threshold for stale queued runs (default: 20)
  --stale-running-minutes <n>  Threshold for stale running runs (default: 60)
  --db <path>                  SQLite DB path
  --json                       Emit JSON report to stdout
  --json-out <path>            Write JSON report to file
  -h, --help                   Show help
USAGE
}

is_pos_int() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

record_check() {
  local status="$1"
  local severity="$2"
  local id="$3"
  local message="$4"
  local evidence="${5:-}"
  printf '%s\t%s\t%s\t%s\t%s\n' "$status" "$severity" "$id" "$message" "$evidence" >>"$CHECKS_FILE"
}

pass() { echo "[PASS] $2"; record_check "pass" "info" "$1" "$2" "${3:-}"; }
warn() { echo "[WARN] $2"; record_check "warn" "warn" "$1" "$2" "${3:-}"; }
fail() { echo "[FAIL] $2"; record_check "fail" "critical" "$1" "$2" "${3:-}"; }

emit_json() {
  local fail_count warn_count overall
  fail_count="$(awk -F'\t' '$1=="fail"{c++} END{print c+0}' "$CHECKS_FILE")"
  warn_count="$(awk -F'\t' '$1=="warn"{c++} END{print c+0}' "$CHECKS_FILE")"
  overall="pass"
  if [ "$fail_count" -gt 0 ]; then
    overall="fail"
  elif [ "$warn_count" -gt 0 ]; then
    overall="warn"
  fi

  local json
  json=$(
    python3 - "$CHECKS_FILE" "$overall" "$WINDOW_MINUTES" <<'PY'
import json
import sys
from datetime import datetime, timezone

checks_path, overall, window = sys.argv[1:4]
checks = []
with open(checks_path, "r", encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 5:
            continue
        checks.append({
            "id": parts[2],
            "status": parts[0],
            "severity": parts[1],
            "message": parts[3],
            "evidence": {"raw": parts[4]} if parts[4] else {}
        })

payload = {
    "script": "jarvis-status",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "overall_status": overall,
    "window_minutes": int(window),
    "checks": checks,
    "recommendations": [
        "bash scripts/jarvis-ops.sh trace --lane andy-developer",
        "bash scripts/jarvis-ops.sh watch --once --lines 300",
        "bash scripts/jarvis-ops.sh reliability"
    ]
}
print(json.dumps(payload, ensure_ascii=True, indent=2))
PY
  )

  if [ "$JSON_MODE" -eq 1 ]; then
    echo
    echo "$json"
  fi
  if [ -n "$JSON_OUT" ]; then
    printf '%s\n' "$json" >"$JSON_OUT"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --window-minutes) WINDOW_MINUTES="$2"; shift 2 ;;
    --recent-limit) RECENT_LIMIT="$2"; shift 2 ;;
    --reason-limit) REASON_LIMIT="$2"; shift 2 ;;
    --stale-queued-minutes) STALE_QUEUED_MINUTES="$2"; shift 2 ;;
    --stale-running-minutes) STALE_RUNNING_MINUTES="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift ;;
    --json-out) JSON_OUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

for v in "$WINDOW_MINUTES" "$RECENT_LIMIT" "$REASON_LIMIT" "$STALE_QUEUED_MINUTES" "$STALE_RUNNING_MINUTES"; do
  if ! is_pos_int "$v"; then
    echo "Expected positive integer, got: $v"
    exit 1
  fi
done

if ! have_cmd sqlite3; then
  echo "sqlite3 is required"
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "DB not found: $DB_PATH"
  exit 1
fi

echo "== Jarvis Status =="
echo "db: $DB_PATH"
echo "window: last ${WINDOW_MINUTES}m"

lane_rows="$(sqlite3 -separator '|' "$DB_PATH" "
WITH window_runs AS (
  SELECT *
  FROM worker_runs
  WHERE julianday(started_at) >= julianday('now', '-${WINDOW_MINUTES} minutes')
)
SELECT
  group_folder,
  SUM(CASE WHEN status IN ('review_requested', 'done') THEN 1 ELSE 0 END) AS pass_count,
  SUM(CASE WHEN status IN ('failed_runtime', 'failed_timeout', 'failed_contract') THEN 1 ELSE 0 END) AS fail_count,
  SUM(CASE WHEN status IN ('queued', 'provisioning', 'running', 'stopping') THEN 1 ELSE 0 END) AS active_count,
  COUNT(*) AS total_count
FROM window_runs
WHERE group_folder LIKE 'jarvis-worker-%'
GROUP BY group_folder
ORDER BY group_folder;
")"

echo
echo "Lane summary:"
if [ -z "$lane_rows" ]; then
  warn "status.lane_window" "no worker runs in current window"
else
  pass "status.lane_window" "worker runs present in current window"
  while IFS='|' read -r lane pass_count fail_count active total; do
    [ -z "$lane" ] && continue
    echo "  - $lane: pass=$pass_count fail=$fail_count active=$active runs=$total"
  done <<<"$lane_rows"
fi

reason_rows="$(sqlite3 -separator '|' "$DB_PATH" "
WITH window_runs AS (
  SELECT *
  FROM worker_runs
  WHERE julianday(started_at) >= julianday('now', '-${WINDOW_MINUTES} minutes')
),
failed_runs AS (
  SELECT *
  FROM window_runs
  WHERE status IN ('failed_runtime', 'failed_timeout', 'failed_contract')
)
SELECT
  COALESCE(
    CASE
      WHEN json_valid(error_details) THEN
        COALESCE(NULLIF(json_extract(error_details, '$.reason'), ''), NULLIF(json_extract(error_details, '$.missing[0]'), ''))
      ELSE NULL
    END,
    NULLIF(result_summary, ''),
    'unknown'
  ) AS reason,
  COUNT(*) AS cnt
FROM failed_runs
GROUP BY reason
ORDER BY cnt DESC, reason
LIMIT ${REASON_LIMIT};
")"

echo
echo "Top failure reasons:"
if [ -z "$reason_rows" ]; then
  pass "status.failure_reasons" "no failures in current window"
  echo "  (none)"
else
  warn "status.failure_reasons" "failures present in current window"
  while IFS='|' read -r reason cnt; do
    [ -z "$reason" ] && continue
    echo "  - $reason: $cnt"
  done <<<"$reason_rows"
fi

stale_queued="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM worker_runs WHERE status IN ('queued','provisioning') AND julianday(started_at) < julianday('now', '-${STALE_QUEUED_MINUTES} minutes');")"
stale_running="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM worker_runs WHERE status IN ('running','stopping') AND julianday(started_at) < julianday('now', '-${STALE_RUNNING_MINUTES} minutes');")"
running_without_container="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM worker_runs WHERE status='failed_runtime' AND json_valid(error_details)=1 AND json_extract(error_details, '$.reason')='running_without_container';")"

echo
echo "Stale state summary:"
echo "  - stale queued (${STALE_QUEUED_MINUTES}m+): $stale_queued"
echo "  - stale running (${STALE_RUNNING_MINUTES}m+): $stale_running"
echo "  - running_without_container (all time): $running_without_container"

if [ "$stale_queued" -eq 0 ]; then
  pass "status.stale_queued" "no stale queued runs"
else
  warn "status.stale_queued" "stale queued runs detected: $stale_queued"
fi

if [ "$stale_running" -eq 0 ]; then
  pass "status.stale_running" "no stale running runs"
else
  fail "status.stale_running" "stale running runs detected: $stale_running"
fi

if [ "$running_without_container" -eq 0 ]; then
  pass "status.running_without_container" "no running_without_container failures recorded"
else
  warn "status.running_without_container" "running_without_container failures recorded: $running_without_container"
fi

dispatch_block_count=0
if [ -d "$ROOT_DIR/data/ipc/errors" ]; then
  dispatch_block_count="$(find "$ROOT_DIR/data/ipc/errors" -type f -name 'dispatch-block-*.json' | wc -l | tr -d ' ')"
fi

echo
echo "Dispatch validator blocks: $dispatch_block_count"
if [ "$dispatch_block_count" -eq 0 ]; then
  pass "status.dispatch_blocks" "no dispatch block artifacts"
else
  warn "status.dispatch_blocks" "dispatch block artifacts present: $dispatch_block_count"
  recent_blocks="$(rg -n '"reason_text"|"run_id"|"target_folder"' "$ROOT_DIR/data/ipc/errors"/dispatch-block-*.json 2>/dev/null | tail -n 9 || true)"
  if [ -n "$recent_blocks" ]; then
    echo "  recent block details:"
    while IFS= read -r row; do
      [ -n "$row" ] && echo "  - $row"
    done <<<"$recent_blocks"
  fi
fi

recent_rows="$(sqlite3 -separator '|' "$DB_PATH" "
SELECT
  run_id,
  group_folder,
  status,
  started_at,
  COALESCE(
    CASE
      WHEN json_valid(error_details) THEN
        COALESCE(NULLIF(json_extract(error_details, '$.reason'), ''), NULLIF(json_extract(error_details, '$.missing[0]'), ''))
      ELSE NULL
    END,
    COALESCE(result_summary, '')
  ) AS summary
FROM worker_runs
WHERE julianday(started_at) >= julianday('now', '-${WINDOW_MINUTES} minutes')
ORDER BY started_at DESC
LIMIT ${RECENT_LIMIT};
")"

echo
echo "Recent runs:"
if [ -z "$recent_rows" ]; then
  echo "  (none)"
else
  while IFS='|' read -r run_id lane status started summary; do
    [ -z "$run_id" ] && continue
    if [ -n "$summary" ]; then
      echo "  - $run_id | $lane | $status | $started | $summary"
    else
      echo "  - $run_id | $lane | $status | $started"
    fi
  done <<<"$recent_rows"
fi

emit_json

fail_count="$(awk -F'\t' '$1=="fail"{c++} END{print c+0}' "$CHECKS_FILE")"
if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
