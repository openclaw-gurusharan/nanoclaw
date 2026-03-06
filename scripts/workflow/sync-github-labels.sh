#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

REPO="${1:-}"
LABELS_FILE="${2:-.github/labels.json}"

usage() {
  cat <<'USAGE'
Usage: scripts/workflow/sync-github-labels.sh [repo] [labels-file]

Upserts label taxonomy from a JSON file into a GitHub repository.
Does not delete existing labels.

Arguments:
  repo         Target repository in owner/name format (default: current gh repo)
  labels-file  JSON array with name/color/description fields (default: .github/labels.json)
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [ ! -f "$LABELS_FILE" ]; then
  echo "Labels file not found: $LABELS_FILE" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

if ! jq -e 'type == "array"' "$LABELS_FILE" >/dev/null; then
  echo "Expected JSON array in $LABELS_FILE" >&2
  exit 1
fi

echo "Syncing labels to $REPO from $LABELS_FILE"

jq -c '.[]' "$LABELS_FILE" | while IFS= read -r row; do
  name="$(jq -r '.name' <<<"$row")"
  color="$(jq -r '.color' <<<"$row")"
  description="$(jq -r '.description // ""' <<<"$row")"

  if [ -z "$name" ] || [ "$name" = "null" ]; then
    echo "Skipping label with missing name: $row"
    continue
  fi

  encoded_name="$(printf '%s' "$name" | jq -sRr @uri)"

  if gh api "repos/$REPO/labels/$encoded_name" >/dev/null 2>&1; then
    gh api --method PATCH "repos/$REPO/labels/$encoded_name" \
      -f new_name="$name" \
      -f color="$color" \
      -f description="$description" >/dev/null
    echo "updated: $name"
  else
    gh api --method POST "repos/$REPO/labels" \
      -f name="$name" \
      -f color="$color" \
      -f description="$description" >/dev/null
    echo "created: $name"
  fi
done

echo "Label sync complete."
