#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/jarvis-ops.sh <command> [args]

Commands:
  preflight       Run runtime/auth/db baseline health checks
  reliability     Run reliability triage checks
  status          Show lane health and root-cause summaries from worker_runs
  watch           Follow categorized runtime logs
  trace           Build end-to-end timeline for lane/chat/run
  message-timeline
                  Build exact per-message timeline (anchor latest/user text/message-id)
  hi-timeline     Alias for message-timeline
  verify-worker-connectivity
                  Validate worker lane connectivity gate using probe + DB checks
  happiness-gate  Run user-facing happiness gate (status + andy user e2e probe)
  dispatch-lint   Validate worker dispatch payload against current rules
  db-doctor       Diagnose database schema/index/readiness drift (read-only)
  incident        Manage incident registry (list/show/resolve/reopen/note)
  probe           Dispatch worker-lane probes and wait for terminal statuses
  hotspots        Show recurring reliability hotspots over time window
  incident-bundle Collect a timestamped diagnostics bundle for an incident
  recover         Run runtime/builder recovery and service restart
  smoke           Rebuild worker image and run worker e2e smoke
  help            Show this help
USAGE
}

command_name="${1:-help}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$command_name" in
  preflight)
    exec "$SCRIPT_DIR/jarvis-preflight.sh" "$@"
    ;;
  reliability)
    exec "$SCRIPT_DIR/jarvis-reliability.sh" "$@"
    ;;
  status)
    exec "$SCRIPT_DIR/jarvis-status.sh" "$@"
    ;;
  watch)
    exec "$SCRIPT_DIR/jarvis-watch.sh" "$@"
    ;;
  trace)
    exec "$SCRIPT_DIR/jarvis-trace.sh" "$@"
    ;;
  message-timeline|hi-timeline)
    exec "$SCRIPT_DIR/jarvis-message-timeline.sh" "$@"
    ;;
  verify-worker-connectivity)
    exec "$SCRIPT_DIR/jarvis-verify-worker-connectivity.sh" "$@"
    ;;
  happiness-gate)
    exec "$SCRIPT_DIR/jarvis-happiness-gate.sh" "$@"
    ;;
  dispatch-lint)
    exec "$SCRIPT_DIR/jarvis-dispatch-lint.sh" "$@"
    ;;
  db-doctor)
    exec "$SCRIPT_DIR/jarvis-db-doctor.sh" "$@"
    ;;
  incident)
    exec "$SCRIPT_DIR/jarvis-incident.sh" "$@"
    ;;
  probe)
    exec "$SCRIPT_DIR/jarvis-worker-probe.sh" "$@"
    ;;
  hotspots)
    exec "$SCRIPT_DIR/jarvis-hotspots.sh" "$@"
    ;;
  incident-bundle)
    exec "$SCRIPT_DIR/jarvis-incident-bundle.sh" "$@"
    ;;
  recover)
    exec "$SCRIPT_DIR/jarvis-recover.sh" "$@"
    ;;
  smoke)
    exec "$SCRIPT_DIR/jarvis-smoke.sh" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $command_name"
    usage
    exit 1
    ;;
esac
