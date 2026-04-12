#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-service-node.sh <command> [args...]" >&2
  exit 1
fi

SERVICE_NODE="${SERVICE_NODE:-$(launchctl print gui/$(id -u)/com.nanoclaw 2>/dev/null | awk '/program = /{print $3; exit}')}"

if [ -z "$SERVICE_NODE" ]; then
  echo "error: could not resolve the com.nanoclaw launch agent Node binary" >&2
  exit 1
fi

if [ ! -x "$SERVICE_NODE" ]; then
  echo "error: launch agent Node is not executable: $SERVICE_NODE" >&2
  exit 1
fi

export PATH="$(dirname "$SERVICE_NODE"):$PATH"
exec "$@"
