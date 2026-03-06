#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-}"
BRANCH="${2:-main}"

usage() {
  cat <<'USAGE'
Usage: scripts/workflow/apply-branch-protection-baseline.sh <owner/repo> [branch]

Applies a low-friction branch protection baseline:
  - Pull-request based merges required
  - Linear history required
  - Conversation resolution required
  - No force-pushes or deletions
  - No mandatory approvals by default

Status checks are intentionally not set by this script. Add them separately once
stable required-check contexts are confirmed for the repository.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [ -z "$REPO" ]; then
  usage
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

echo "Applying branch protection baseline to $REPO:$BRANCH"

gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

echo "Baseline applied."
