#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${DB_PATH:-$ROOT_DIR/store/messages.db}"
LOG_PATH="${LOG_PATH:-$ROOT_DIR/logs/nanoclaw.log}"
WINDOW_HOURS="${WINDOW_HOURS:-72}"
TOP_N="${TOP_N:-10}"
LOG_LINES="${LOG_LINES:-4000}"
JSON_MODE=0
JSON_OUT=""

usage() {
  cat <<'USAGE'
Usage: scripts/jarvis-hotspots.sh [options]

Options:
  --window-hours <n>    Lookback window in hours (default: 72)
  --top <n>             Number of hotspots to print (default: 10)
  --log-lines <n>       Log tail lines for WA/container hotspot counters (default: 4000)
  --db <path>           SQLite DB path (default: store/messages.db)
  --log <path>          Log path (default: logs/nanoclaw.log)
  --json                Emit JSON summary to stdout
  --json-out <path>     Write JSON summary to file
  -h, --help            Show help
USAGE
}

is_pos_int() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

sanitize_counter() {
  local raw="$1"
  if [[ "$raw" =~ ^[0-9]+$ ]]; then
    echo "$raw"
  else
    echo 0
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --window-hours) WINDOW_HOURS="$2"; shift 2 ;;
    --top) TOP_N="$2"; shift 2 ;;
    --log-lines) LOG_LINES="$2"; shift 2 ;;
    --db) DB_PATH="$2"; shift 2 ;;
    --log) LOG_PATH="$2"; shift 2 ;;
    --json) JSON_MODE=1; shift ;;
    --json-out) JSON_OUT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

for n in "$WINDOW_HOURS" "$TOP_N" "$LOG_LINES"; do
  if ! is_pos_int "$n"; then
    echo "Expected positive integer, got: $n"
    exit 1
  fi
done

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required"
  exit 1
fi
if [ ! -f "$DB_PATH" ]; then
  echo "DB not found: $DB_PATH"
  exit 1
fi

echo "== Jarvis Hotspots =="
echo "window: ${WINDOW_HOURS}h"

top_reasons="$(sqlite3 -separator '|' "$DB_PATH" "
WITH window_runs AS (
  SELECT *
  FROM worker_runs
  WHERE julianday(started_at) >= julianday('now', '-${WINDOW_HOURS} hours')
),
failed_runs AS (
  SELECT * FROM window_runs WHERE status IN ('failed_runtime','failed_timeout','failed_contract')
)
SELECT
  COALESCE(
    CASE WHEN json_valid(error_details) THEN
      COALESCE(NULLIF(json_extract(error_details, '$.reason'), ''), NULLIF(json_extract(error_details, '$.missing[0]'), ''))
    ELSE NULL END,
    NULLIF(result_summary, ''),
    'unknown'
  ) AS reason,
  COUNT(*) AS cnt
FROM failed_runs
GROUP BY reason
ORDER BY cnt DESC, reason
LIMIT ${TOP_N};
")"

top_lanes="$(sqlite3 -separator '|' "$DB_PATH" "
WITH window_runs AS (
  SELECT *
  FROM worker_runs
  WHERE julianday(started_at) >= julianday('now', '-${WINDOW_HOURS} hours')
)
SELECT
  group_folder,
  SUM(CASE WHEN status IN ('failed_runtime','failed_timeout','failed_contract') THEN 1 ELSE 0 END) AS fail_count,
  SUM(CASE WHEN status IN ('review_requested','done') THEN 1 ELSE 0 END) AS pass_count,
  COUNT(*) AS total
FROM window_runs
WHERE group_folder LIKE 'jarvis-worker-%'
GROUP BY group_folder
ORDER BY fail_count DESC, total DESC
LIMIT ${TOP_N};
")"

daily_trend="$(sqlite3 -separator '|' "$DB_PATH" "
SELECT
  substr(started_at, 1, 10) AS day,
  SUM(CASE WHEN status IN ('failed_runtime','failed_timeout','failed_contract') THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status IN ('review_requested','done') THEN 1 ELSE 0 END) AS passed,
  COUNT(*) AS total
FROM worker_runs
WHERE julianday(started_at) >= julianday('now', '-${WINDOW_HOURS} hours')
GROUP BY day
ORDER BY day DESC
LIMIT 14;
")"

dispatch_blocks=0
if [ -d "$ROOT_DIR/data/ipc/errors" ]; then
  dispatch_blocks="$(find "$ROOT_DIR/data/ipc/errors" -type f -name 'dispatch-block-*.json' | wc -l | tr -d ' ')"
fi
dispatch_blocks="$(sanitize_counter "${dispatch_blocks:-0}")"

wa_conflicts=0
container_errors=0
if [ -f "$LOG_PATH" ]; then
  log_tail="$(tail -n "$LOG_LINES" "$LOG_PATH" 2>/dev/null || true)"
  wa_conflicts="$(printf '%s' "$log_tail" | rg -c 'Stream Errored \(conflict\)|"tag": "conflict"|type": "replaced"' || true)"
  container_errors="$(printf '%s' "$log_tail" | rg -c 'Container exited with error|Container agent error' || true)"
fi
wa_conflicts="$(sanitize_counter "${wa_conflicts:-0}")"
container_errors="$(sanitize_counter "${container_errors:-0}")"

echo
echo "Top failure reasons:"
if [ -z "$top_reasons" ]; then
  echo "  (none)"
else
  while IFS='|' read -r reason cnt; do
    [ -n "$reason" ] && echo "  - $reason: $cnt"
  done <<<"$top_reasons"
fi

echo
echo "Lane hotspot ranking:"
if [ -z "$top_lanes" ]; then
  echo "  (none)"
else
  while IFS='|' read -r lane fail pass total; do
    [ -n "$lane" ] && echo "  - $lane: fail=$fail pass=$pass total=$total"
  done <<<"$top_lanes"
fi

echo
echo "Daily trend (recent):"
if [ -z "$daily_trend" ]; then
  echo "  (none)"
else
  while IFS='|' read -r day failed passed total; do
    [ -n "$day" ] && echo "  - $day: failed=$failed passed=$passed total=$total"
  done <<<"$daily_trend"
fi

echo
echo "Additional counters:"
echo "  - dispatch_block artifacts: $dispatch_blocks"
echo "  - wa conflicts in last ${LOG_LINES} log lines: $wa_conflicts"
echo "  - container errors in last ${LOG_LINES} log lines: $container_errors"

json_payload="$(python3 - "$WINDOW_HOURS" "$dispatch_blocks" "$wa_conflicts" "$container_errors" <<'PY'
import json
import sys
from datetime import datetime, timezone

window_h, blocks, wa, c_err = sys.argv[1:5]
print(json.dumps({
  "script": "jarvis-hotspots",
  "timestamp": datetime.now(timezone.utc).isoformat(),
  "window_hours": int(window_h),
  "metrics": {
    "dispatch_block_artifacts": int(blocks),
    "wa_conflicts_in_tail": int(wa),
    "container_errors_in_tail": int(c_err)
  }
}, ensure_ascii=True))
PY
)"

if [ "$JSON_MODE" -eq 1 ] || [ -n "$JSON_OUT" ]; then
  final_json="$(python3 - "$json_payload" "$top_reasons" "$top_lanes" "$daily_trend" <<'PY'
import json
import sys

base = json.loads(sys.argv[1])

reasons = []
for line in sys.argv[2].splitlines():
    if not line.strip():
        continue
    reason, cnt = line.split('|', 1)
    reasons.append({"reason": reason, "count": int(cnt)})

lanes = []
for line in sys.argv[3].splitlines():
    if not line.strip():
        continue
    lane, fail, pas, total = line.split('|', 3)
    lanes.append({"lane": lane, "fail": int(fail), "pass": int(pas), "total": int(total)})

trend = []
for line in sys.argv[4].splitlines():
    if not line.strip():
        continue
    day, failed, passed, total = line.split('|', 3)
    trend.append({"day": day, "failed": int(failed), "passed": int(passed), "total": int(total)})

base["top_failure_reasons"] = reasons
base["lane_hotspots"] = lanes
base["daily_trend"] = trend
base["recommendations"] = [
  "bash scripts/jarvis-ops.sh status",
  "bash scripts/jarvis-ops.sh trace --lane andy-developer",
  "bash scripts/jarvis-ops.sh incident-bundle --window-minutes 180"
]
print(json.dumps(base, ensure_ascii=True, indent=2))
PY
)"

  if [ "$JSON_MODE" -eq 1 ]; then
    echo
    echo "$final_json"
  fi

  if [ -n "$JSON_OUT" ]; then
    printf '%s\n' "$final_json" >"$JSON_OUT"
  fi
fi
