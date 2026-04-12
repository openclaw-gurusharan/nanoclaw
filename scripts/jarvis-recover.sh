#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_PATH="${NANOCLAW_DB_PATH:-$ROOT_DIR/store/messages.db}"
RUNTIME_READY_TIMEOUT_SEC="${NANOCLAW_RECOVER_READY_TIMEOUT_SEC:-45}"
RESTART_NANOCLAW=1
RUN_PREFLIGHT=1
RUN_MAIN_LANE_SMOKE=1
error_count=0

usage() {
  cat <<'EOF'
Usage: scripts/jarvis-recover.sh [options]

Options:
  --no-restart-nanoclaw  Do not restart com.nanoclaw service.
  --no-preflight         Skip final preflight validation.
  --no-main-lane-smoke   Skip the main lane response smoke after restart.
  -h, --help             Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-restart-nanoclaw)
      RESTART_NANOCLAW=0
      shift
      ;;
    --no-preflight)
      RUN_PREFLIGHT=0
      shift
      ;;
    --no-main-lane-smoke)
      RUN_MAIN_LANE_SMOKE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

step() {
  local label="$1"
  shift
  echo "[STEP] $label"
  if "$@"; then
    echo "[PASS] $label"
  else
    echo "[WARN] $label"
    error_count=$((error_count + 1))
  fi
}

wait_for_nanoclaw_ready() {
  local restart_started_at="$1"

  if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "[WARN] sqlite3 not available; skipping runtime readiness wait"
    return 0
  fi

  if [ ! -f "$DB_PATH" ]; then
    echo "[WARN] sqlite DB missing; skipping runtime readiness wait ($DB_PATH)"
    return 0
  fi

  local deadline=$((SECONDS + RUNTIME_READY_TIMEOUT_SEC))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local owner_row
    owner_row="$(sqlite3 -separator '|' "$DB_PATH" \
      "SELECT pid, heartbeat_at FROM runtime_owners WHERE owner_name = 'host' AND heartbeat_at >= '$restart_started_at' LIMIT 1;" \
      2>/dev/null || true)"
    local loop_ready_at
    loop_ready_at="$(sqlite3 "$DB_PATH" \
      "SELECT value FROM router_state WHERE key = 'host_message_loop_ready_at' AND value >= '$restart_started_at' LIMIT 1;" \
      2>/dev/null || true)"
    if [ -n "$owner_row" ]; then
      local runtime_pid runtime_heartbeat
      IFS='|' read -r runtime_pid runtime_heartbeat <<<"$owner_row"
      if [[ "$runtime_pid" =~ ^[0-9]+$ ]] && kill -0 "$runtime_pid" 2>/dev/null && [ -n "$loop_ready_at" ]; then
        echo "[PASS] runtime ready (pid=$runtime_pid heartbeat=$runtime_heartbeat loop_ready=$loop_ready_at)"
        return 0
      fi
    fi
    sleep 1
  done

  echo "[WARN] runtime readiness wait timed out after ${RUNTIME_READY_TIMEOUT_SEC}s"
  return 1
}

echo "== Jarvis Recovery =="

if command -v launchctl >/dev/null 2>&1; then
  UID_VALUE="$(id -u)"
  step "kickstart buildkit launchd service" launchctl kickstart -k "gui/$UID_VALUE/com.apple.container.container-runtime-linux.buildkit"
  step "kickstart apiserver launchd service" launchctl kickstart -k "gui/$UID_VALUE/com.apple.container.apiserver"
else
  echo "[WARN] launchctl not available; skipping launchd kickstart"
  error_count=$((error_count + 1))
fi

if command -v container >/dev/null 2>&1; then
  step "container system start" container system start
  step "container builder start" container builder start
  step "container system status" container system status
  step "container builder status" container builder status
else
  echo "[WARN] container CLI not available; skipping runtime recovery"
  error_count=$((error_count + 1))
fi

if [ "$RESTART_NANOCLAW" -eq 1 ]; then
  if command -v launchctl >/dev/null 2>&1; then
    UID_VALUE="$(id -u)"
    restart_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    step "restart com.nanoclaw service" launchctl kickstart -k "gui/$UID_VALUE/com.nanoclaw"
    step "wait for com.nanoclaw runtime readiness" wait_for_nanoclaw_ready "$restart_started_at"
  else
    echo "[WARN] launchctl not available; cannot restart com.nanoclaw"
    error_count=$((error_count + 1))
  fi
fi

if [ "$RUN_PREFLIGHT" -eq 1 ]; then
  echo "[STEP] run preflight checks"
  if "$ROOT_DIR/scripts/jarvis-preflight.sh"; then
    echo "[PASS] run preflight checks"
  else
    echo "[FAIL] run preflight checks"
    exit 1
  fi
else
  echo "[INFO] preflight skipped"
  if [ "$error_count" -gt 0 ]; then
    exit 1
  fi
fi

if [ "$RESTART_NANOCLAW" -eq 1 ] && [ "$RUN_MAIN_LANE_SMOKE" -eq 1 ]; then
  echo "[STEP] run main lane response smoke"
  if bash "$ROOT_DIR/scripts/with-service-node.sh" npx tsx \
    "$ROOT_DIR/scripts/test-main-lane-status-e2e.ts"; then
    echo "[PASS] run main lane response smoke"
  else
    echo "[FAIL] run main lane response smoke"
    exit 1
  fi
else
  echo "[INFO] main lane response smoke skipped"
fi
