# Symphony Test Issue Template (nanoclaw-test project)

Use this template when creating or updating test-type issues in the **NanoClaw Test** project.
Symphony will NOT pick up an issue missing any required section.

> Linear template ID: `759a9bad-5b08-44e3-8b73-e4e9fb8afebc` ("TEMPLATE: Test Issue — [Feature/Component Name]")

## Required Sections (ALL must be present and non-placeholder)

```markdown
## Problem Statement

[What is being tested and why it matters. One paragraph. Be specific about the feature or
 integration under test.]

## Scope

- In scope: [list what this test covers]
- Out of scope: [list what this test does NOT cover — live services, external APIs, etc.]

## Acceptance Criteria

- `[command]` exits 0
- [describe expected output or side effect]
- [repeat for each criterion]

## Required Checks

[command 1]
[command 2]
[command 3]

<!-- One command per line. Commands run sequentially. All must exit 0 for PASS. -->

## Required Evidence

- [What output proves the check passed — e.g. "Test summary: X passed, 0 failed"]
- [Paste failing test names and errors if any command fails]

## Blocked If

- [Condition that makes this issue untestable — e.g. "GITHUB_TOKEN not set", "repo not accessible"]
- [Missing tool or env var]

## Symphony Routing

- Execution Lane: symphony
- Target Runtime: claude-code
- Agent: nanoclaw-test-runner
- Work Class: nanoclaw-core
- Target Repo: https://github.com/ingpoc/nanoclaw.git
- Base Branch: main
```

## Field Rules

| Field | Rule |
|-------|------|
| `Agent` | Always `nanoclaw-test-runner` for nanoclaw-test issues |
| `Target Runtime` | Always `claude-code` — agent needs Linear MCP to post pass/fail results |
| `Work Class` | `nanoclaw-core` for NanoClaw tests; `downstream-project` for Jarvis worker tests |
| `Target Repo` | `https://github.com/ingpoc/nanoclaw.git` (or downstream repo URL) |
| `Execution Lane` | Always `symphony` |
| Priority | Must be set (1–4) — `0` (No Priority) causes issues to be skipped by activation logic |

## Common Mistakes That Prevent Pickup

- Missing any of the 7 sections entirely
- `Agent:` field omitted — `nanoclaw-test-runner` is required for the test project
- Placeholder text remaining (`[...]`) in Required Checks
- `Work Class: research` or `Work Class: governance` — blocked by Symphony
- Commands in Required Checks that reference live external services (will fail in worktree)
- Priority = 0 — activation logic filters these out with `priority: { neq: 0 }`

## Example (NAN-29 — Nightly Improvement Researcher)

```markdown
## Problem Statement
NanoClaw needs an autonomous overnight improvement lane that evaluates net-new upstream and
tooling changes and hands off decisions to morning Codex triage via Notion.

## Scope
- In scope: scan upstream changes, run experiments, update Notion, record cursor state
- Out of scope: editing repo-tracked files directly, creating Linear issues, opening PRs

## Acceptance Criteria
- Scan returns pending candidates or noop
- Notion shared-context page updated with decisions and evidence
- Run status set (done or blocked)

## Required Checks
node scripts/workflow/nightly-improvement.js scan --output /tmp/scan.json
cat /tmp/scan.json | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0)"

## Required Evidence
- Notion shared-context page URL in run.log
- .nanoclaw/nightly-improvement/state.json updated with new evaluated_keys

## Blocked If
- NOTION_TOKEN, LINEAR_API_KEY, or GITHUB_TOKEN missing
- Upstream remote unreachable

## Symphony Routing
- Execution Lane: symphony
- Target Runtime: claude-code
- Work Class: nanoclaw-core
- Agent: nightly-improvement-researcher
- Target Repo: https://github.com/ingpoc/nanoclaw.git
- Base Branch: main
```
