#!/usr/bin/env bash
# gh-collab-sweep.sh
# Session-start GitHub collaboration sweep for Claude and Codex.
# Usage: bash scripts/workflow/gh-collab-sweep.sh --agent claude|codex [--fail-on-action-items]
# Outputs: terse summary of what needs attention.

set -euo pipefail

AGENT=""
OWNER="ingpoc"
REPO="nanoclaw"
PROJECT_NUMBER=1
STALE_HOURS=24
FAIL_ON_ACTION_ITEMS=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent) AGENT="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --fail-on-action-items) FAIL_ON_ACTION_ITEMS=1; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$AGENT" ]]; then
  echo "Usage: $0 --agent claude|codex"
  exit 1
fi

if [[ "$AGENT" != "claude" && "$AGENT" != "codex" ]]; then
  echo "Error: --agent must be 'claude' or 'codex'"
  exit 1
fi

OTHER_AGENT="codex"
[[ "$AGENT" == "codex" ]] && OTHER_AGENT="claude"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

count_entries() {
  local input="$1"
  if [[ -z "${input//[[:space:]]/}" ]]; then
    echo 0
    return 0
  fi
  printf '%s\n' "$input" | awk 'NF { count++ } END { print count + 0 }'
}

require_cmd gh
require_cmd jq

echo ""
echo "=== GitHub Collaboration Sweep (${AGENT}) ==="
echo "repo: ${OWNER}/${REPO}  |  $(date -u '+%Y-%m-%d %H:%M UTC')"
echo ""

# ── 1. My Issues (Agent=me, not Done) ────────────────────────────────────────
echo "── MY ISSUES ──"
PROJECT_ITEMS_JSON="$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json)"
MY_ISSUES="$(printf '%s\n' "$PROJECT_ITEMS_JSON" | jq -r --arg agent "$AGENT" '
  .items[]
  | select(.agent == $agent and .status != "Done")
  | "  #\(.content.number // "?")  [\(.status // "?")]  \(.title // .content.title // "?")"
')"

if [[ -z "$MY_ISSUES" ]]; then
  echo "  (none)"
else
  echo "$MY_ISSUES"
fi
echo ""

# ── 2. Needs my review (Review Lane=me, status=Review) ───────────────────────
echo "── NEEDS MY REVIEW ──"
REVIEW_ITEMS="$(printf '%s\n' "$PROJECT_ITEMS_JSON" | jq -r --arg agent "$AGENT" '
  .items[]
  | select(.["review Lane"] == $agent and .status == "Review")
  | "  #\(.content.number // "?")  \(.title // .content.title // "?")"
')"

if [[ -z "$REVIEW_ITEMS" ]]; then
  echo "  (none)"
else
  echo "$REVIEW_ITEMS"
fi
echo ""
REVIEW_COUNT="$(count_entries "$REVIEW_ITEMS")"

# ── 3. Stale discussions (0 comments, in my affinity categories, >STALE_HOURS) ─
echo "── STALE DISCUSSIONS (needs response) ──"

# Agent affinity: Claude owns process/coordination; Codex owns feature/tooling/sync
if [[ "$AGENT" == "claude" ]]; then
  AFFINITY_SLUGS=("workflow-operating-model" "claude-codex-collaboration")
else
  AFFINITY_SLUGS=("feature-ideas" "sdk-tooling-opportunities" "upstream-nanoclaw-sync")
fi

STALE_CUTOFF=$(date -u -v-"${STALE_HOURS}"H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u --date="${STALE_HOURS} hours ago" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || echo "")

DISCUSSIONS="$(gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 30, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        body
        createdAt
        updatedAt
        category { slug }
        comments(first: 20) {
          totalCount
          nodes {
            body
            createdAt
          }
        }
      }
    }
  }
}' -f owner="$OWNER" -f repo="$REPO" --jq '.data.repository.discussions.nodes')"

FOUND_STALE=0
for slug in "${AFFINITY_SLUGS[@]}"; do
  STALE=$(echo "$DISCUSSIONS" | jq -r --arg slug "$slug" --arg cutoff "${STALE_CUTOFF:-1970-01-01T00:00:00Z}" '
    .[]
    | select(.category.slug == $slug and .comments.totalCount == 0 and .createdAt < now and .createdAt <= $cutoff)
    | "  #\(.number)  \(.title)  (0 comments, category: \(.category.slug))"
  ')
  if [[ -n "$STALE" ]]; then
    echo "$STALE"
    FOUND_STALE=1
  fi
done

# Also show any 0-comment discussions in affinity categories regardless of age
ALL_ZERO=$(echo "$DISCUSSIONS" | jq -r --argjson slugs "$(printf '%s\n' "${AFFINITY_SLUGS[@]}" | jq -R . | jq -s .)" '
  .[]
  | select((.category.slug as $s | $slugs | index($s) != null) and .comments.totalCount == 0)
  | "  #\(.number)  \(.title)  (0 comments)"
')

if [[ -n "$ALL_ZERO" ]]; then
  echo "$ALL_ZERO"
  FOUND_STALE=1
fi

[[ "$FOUND_STALE" -eq 0 ]] && echo "  (none)"
echo ""
STALE_COUNT="$FOUND_STALE"

# ── 4. Nightly improvement findings ──────────────────────────────────────────
echo "── NIGHTLY IMPROVEMENT FINDINGS ──"
if [[ "$AGENT" != "codex" ]]; then
  echo "  (codex morning triage only)"
else
  NIGHTLY_CUTOFF=$(date -u -v-7d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u --date='7 days ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || echo "")

  NIGHTLY="$(echo "$DISCUSSIONS" | jq -r --arg cutoff "${NIGHTLY_CUTOFF:-1970-01-01T00:00:00Z}" '
    def latest_decision_ts($label):
      ([.comments.nodes[]
        | select(
            ((.body // "") | test("nightly-improvement-decision"; "i"))
            and ((.body // "") | test("Agent Label:\\s*" + $label; "i"))
          )
        | .createdAt] | sort | last // "");

    .[]
    | select(
        (.updatedAt >= $cutoff)
        and ((.body // "") | test("nightly-improvement:(upstream|tooling)"))
        and (
          ([.comments.nodes[].body // ""] | any(test("Promoted to #[0-9]+"; "i")))
          | not
        )
        and (
          (latest_decision_ts("Claude Code")) != ""
        )
        and (
          (latest_decision_ts("Codex")) == ""
          or (latest_decision_ts("Codex") < latest_decision_ts("Claude Code"))
        )
      )
    | "  #\(.number)  [\(.category.slug)]  \(.title)  (updated \(.updatedAt), codex_decision=" +
      (
        if ((latest_decision_ts("Codex")) != "")
        then "yes"
        else "no"
        end
      ) + ", handoff=pending)"
  ')"

  if [[ -z "$NIGHTLY" ]]; then
    echo "  (none)"
  else
    echo "$NIGHTLY"
  fi
fi
echo ""

# ── 5. Handoff comments from other agent ─────────────────────────────────────
echo "── HANDOFFS FROM ${OTHER_AGENT^^} ──"
# Look for recent Issue comments containing the handoff marker
HANDOFFS="$(gh api "repos/${OWNER}/${REPO}/issues/comments?per_page=30&sort=created&direction=desc" \
  | jq -r --arg other "$OTHER_AGENT" '
    .[]
    | select(.body | test("agent-handoff") and test($other; "i"))
    | "  Issue #\(.issue_url | split("/") | last)  \(.body | split("\n") | map(select(test("^(To:|Next:|Status:)"))) | join(" | "))"
  ')"

if [[ -z "$HANDOFFS" ]]; then
  echo "  (none)"
else
  echo "$HANDOFFS"
fi
echo ""
HANDOFF_COUNT="$(count_entries "$HANDOFFS")"

# ── 6. Blocked items (any agent) ─────────────────────────────────────────────
echo "── BLOCKED ITEMS ──"
BLOCKED="$(printf '%s\n' "$PROJECT_ITEMS_JSON" | jq -r '
  .items[]
  | select(.status == "Blocked")
  | "  #\(.content.number // "?")  [\(.agent // "?")]  \(.title // .content.title // "?")"
')"

if [[ -z "$BLOCKED" ]]; then
  echo "  (none)"
else
  echo "$BLOCKED"
fi
echo ""

echo "=== End Sweep ==="
echo ""
echo "Handoff format (use when leaving work for ${OTHER_AGENT}):"
echo "  <!-- agent-handoff -->"
echo "  From: ${AGENT}"
echo "  To: ${OTHER_AGENT}"
echo "  Status: [completed|blocked|needs-review|needs-input]"
echo "  Next: <specific next action>"
echo "  Context: <brief context>"
echo ""

if [[ "$FAIL_ON_ACTION_ITEMS" -eq 1 ]]; then
  ACTION_ITEMS=()

  if [[ "$REVIEW_COUNT" -gt 0 ]]; then
    ACTION_ITEMS+=("REVIEW REQUIRED: ${REVIEW_COUNT} item(s) in Needs My Review.")
  fi

  if [[ "$STALE_COUNT" -gt 0 ]]; then
    ACTION_ITEMS+=("DISCUSSION RESPONSE REQUIRED: zero-comment affinity discussions need a response.")
  fi

  if [[ "$HANDOFF_COUNT" -gt 0 ]]; then
    ACTION_ITEMS+=("HANDOFF ACKNOWLEDGMENT REQUIRED: ${HANDOFF_COUNT} recent handoff comment(s) from ${OTHER_AGENT}.")
  fi

  if [[ "${#ACTION_ITEMS[@]}" -gt 0 ]]; then
    echo "ACTION REQUIRED:"
    for item in "${ACTION_ITEMS[@]}"; do
      echo "  - $item"
    done
    echo "Startup blocked until these items are handled or explicitly acknowledged."
    exit 3
  fi

  echo "No blocking sweep action items."
fi
