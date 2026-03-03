#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${DB_PATH:-$ROOT_DIR/store/messages.db}"
WINDOW_MINUTES="${WINDOW_MINUTES:-60}"
STALE_QUEUED_MINUTES="${STALE_QUEUED_MINUTES:-20}"
STALE_RUNNING_MINUTES="${STALE_RUNNING_MINUTES:-60}"
SKIP_PRECHECKS=0
SKIP_PROBE=0

usage() {
  cat <<'USAGE'
Usage: scripts/jarvis-verify-worker-connectivity.sh [options]

Options:
  --db <path>                    SQLite DB path (default: store/messages.db)
  --window-minutes <n>           Probe-result freshness window (default: 60)
  --stale-queued-minutes <n>     Stale queued threshold (default: 20)
  --stale-running-minutes <n>    Stale running threshold (default: 60)
  --skip-prechecks               Skip preflight command
  --skip-probe                   Skip worker probe command
  -h, --help                     Show help
USAGE
}

is_pos_int() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --db) DB_PATH="$2"; shift 2 ;;
    --window-minutes) WINDOW_MINUTES="$2"; shift 2 ;;
    --stale-queued-minutes) STALE_QUEUED_MINUTES="$2"; shift 2 ;;
    --stale-running-minutes) STALE_RUNNING_MINUTES="$2"; shift 2 ;;
    --skip-prechecks) SKIP_PRECHECKS=1; shift ;;
    --skip-probe) SKIP_PROBE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

for n in "$WINDOW_MINUTES" "$STALE_QUEUED_MINUTES" "$STALE_RUNNING_MINUTES"; do
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

echo "== Jarvis Verify Worker Connectivity =="
echo "db: $DB_PATH"
echo "window: ${WINDOW_MINUTES}m"

overall_fail=0
preflight_fail=0
probe_fail=0
lane_fail=0
stale_fail=0

if [ "$SKIP_PRECHECKS" -eq 0 ]; then
  preflight_ok=0
  for attempt in 1 2; do
    if bash scripts/jarvis-ops.sh preflight >/tmp/jarvis-verify-preflight.out 2>&1; then
      preflight_ok=1
      break
    fi
    if [ "$attempt" -lt 2 ]; then
      sleep 2
    fi
  done

  if [ "$preflight_ok" -eq 1 ]; then
    echo "[PASS] preflight"
  else
    overall_fail=1
    preflight_fail=1
    echo "[FAIL] preflight"
    echo "  detail: $(tr '\n' ' ' </tmp/jarvis-verify-preflight.out | sed 's/[[:space:]]\+/ /g')"
  fi
fi

if [ "$SKIP_PROBE" -eq 0 ]; then
  probe_ok=0
  for attempt in 1 2; do
    if bash scripts/jarvis-ops.sh probe >/tmp/jarvis-verify-probe.out 2>&1; then
      probe_ok=1
      break
    fi
    if [ "$attempt" -lt 2 ]; then
      sleep 2
    fi
  done

  if [ "$probe_ok" -eq 1 ]; then
    echo "[PASS] probe dispatch"
  else
    overall_fail=1
    probe_fail=1
    echo "[FAIL] probe dispatch"
    echo "  detail: $(tr '\n' ' ' </tmp/jarvis-verify-probe.out | sed 's/[[:space:]]\+/ /g')"
  fi
fi

mapfile -t lanes < <(sqlite3 "$DB_PATH" "SELECT folder FROM registered_groups WHERE folder LIKE 'jarvis-worker-%' ORDER BY folder;")
if [ "${#lanes[@]}" -eq 0 ]; then
  echo "[FAIL] no registered jarvis-worker lanes found"
  exit 1
fi

echo
echo "Lane probe evidence:"
for lane in "${lanes[@]}"; do
  row="$(sqlite3 -separator '|' "$DB_PATH" "
SELECT run_id, status, started_at, COALESCE(completed_at, '')
FROM worker_runs
WHERE group_folder='${lane}'
  AND run_id LIKE 'probe-${lane}-%'
  AND julianday(started_at) >= julianday('now', '-${WINDOW_MINUTES} minutes')
ORDER BY started_at DESC
LIMIT 1;
")"
  if [ -z "$row" ]; then
    overall_fail=1
    lane_fail=1
    echo "[FAIL] $lane has no recent probe run in last ${WINDOW_MINUTES}m"
    continue
  fi

  IFS='|' read -r run_id status started_at completed_at <<<"$row"
  if [ "$status" = "review_requested" ] || [ "$status" = "done" ]; then
    echo "[PASS] $lane -> $status ($run_id @ $started_at)"
  else
    overall_fail=1
    lane_fail=1
    echo "[FAIL] $lane -> $status ($run_id @ $started_at)"
  fi
done

stale_queued="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM worker_runs WHERE status='queued' AND julianday(started_at) < julianday('now', '-${STALE_QUEUED_MINUTES} minutes');")"
stale_running="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM worker_runs WHERE status='running' AND julianday(started_at) < julianday('now', '-${STALE_RUNNING_MINUTES} minutes');")"

echo
echo "Stale-state gate:"
if [ "$stale_queued" -eq 0 ]; then
  echo "[PASS] stale queued ($STALE_QUEUED_MINUTES m): 0"
else
  overall_fail=1
  stale_fail=1
  echo "[FAIL] stale queued ($STALE_QUEUED_MINUTES m): $stale_queued"
fi

if [ "$stale_running" -eq 0 ]; then
  echo "[PASS] stale running ($STALE_RUNNING_MINUTES m): 0"
else
  overall_fail=1
  stale_fail=1
  echo "[FAIL] stale running ($STALE_RUNNING_MINUTES m): $stale_running"
fi

# If only preflight failed, re-check once at the end to absorb transient
# restart windows while still failing on true probe/lane/stale regressions.
if [ "$overall_fail" -ne 0 ] \
  && [ "$preflight_fail" -eq 1 ] \
  && [ "$probe_fail" -eq 0 ] \
  && [ "$lane_fail" -eq 0 ] \
  && [ "$stale_fail" -eq 0 ]; then
  if bash scripts/jarvis-ops.sh preflight >/tmp/jarvis-verify-preflight-post.out 2>&1; then
    overall_fail=0
    preflight_fail=0
    echo "[WARN] preflight recovered on post-check (transient restart window)"
  fi
fi

if [ "$overall_fail" -ne 0 ]; then
  echo
  echo "Result: FAIL"
  exit 1
fi

echo
echo "Result: PASS"
exit 0
