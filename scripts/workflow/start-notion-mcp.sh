#!/usr/bin/env bash
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node \
  --env-file="$REPO_ROOT/.env" \
  --import "$REPO_ROOT/node_modules/tsx/dist/loader.mjs" \
  "$REPO_ROOT/scripts/workflow/notion-mcp.ts"
