# GitHub Multi-Agent Collaboration Loop

Reusable operating workflow for projects where multiple agents contribute to the same codebase.

Use this to eliminate siloed execution by making GitHub the shared planning, ownership, and governance layer.

Mission anchor: `docs/MISSION.md`.

## Objective

Coordinate many agents with high throughput and low operator overhead by:

1. Centralizing work state in GitHub Issues/Projects.
2. Enforcing deterministic merge and security invariants in GitHub.
3. Keeping context-heavy runtime/debug tasks in local agent lanes.

## Applicability

Use when any of these are true:

1. More than one agent contributes in parallel.
2. Work items are frequently blocked by hidden cross-agent dependencies.
3. PR review quality is inconsistent because ownership is unclear.
4. Operators spend time manually reconciling status across tools.

## Core Principle

GitHub is the system of record for work coordination.
Agent memory is transient; Issue/Project state is durable.

## Capability Model

### Coordination Plane

1. Issues + sub-issues + dependencies.
2. Projects (v2) with required fields and status flow.
3. Discussions for non-actionable exploration and RFC-style debates.

### Governance Plane

1. Rulesets / branch protection.
2. Required checks and merge policy.
3. CODEOWNERS and review ownership.
4. Security checks (dependency review, code scanning, secret scanning, Dependabot).

### Execution Plane

1. Agents implement from Issue context and link PRs back to Issues.
2. Auto-correct lanes (metadata drift, generated artifacts) run as bot PRs.
3. Runtime/stateful recovery and incident loops stay in local lanes.

## Standard Workflow

### Phase 1: Intake

1. Create Issue using an issue form (problem, scope, acceptance, risks).
2. Add labels: `lane:*`, `priority:*`, `risk:*`, optional `agent:*`.
3. If large, create sub-issues and link dependencies (`blocked-by`).

### Phase 2: Planning

1. Add each Issue to Project v2.
2. Set required fields:
   - `Status`: Backlog/Ready/In Progress/Review/Blocked/Done
   - `Agent`
   - `Lane`
   - `Priority`
   - `Target`
3. Keep only one active owner per Issue.

### Phase 3: Execution

1. Agent claims Issue (`Agent` field + assignee + `In Progress`).
2. Agent opens PR linked to one primary Issue (`Fixes #<id>`).
3. PR template requires:
   - linked Issue
   - scope summary
   - test evidence
   - risk notes

### Phase 4: Governance and Merge

1. Rulesets require PR + required checks + conversation resolution.
2. CODEOWNERS required for critical paths.
3. Use auto-merge for compliant PRs.
4. Use merge queue when parallel PR pressure rises.

### Phase 5: Closeout

1. PR merge auto-closes linked Issue.
2. Project item moves to `Done` automatically.
3. If follow-up discovered, open new Issue (do not hide in PR comments).

## Auto-Correct-First Policy

Keep operator load low with this split:

### Hard blocking

1. Build/type/test failures.
2. Policy/ruleset violations.
3. High-severity security findings.
4. Missing required review ownership.

### Auto-correct (non-blocking)

1. Version metadata updates.
2. Token/badge/doc generated artifact drift.
3. Routine dependency update PRs.
4. Mechanical template/schema drift.

### Advisory only

1. Performance trend warnings.
2. Low-severity hygiene findings.
3. Non-critical optimization recommendations.

## Required Repository Baseline

1. `main` protected by ruleset or branch protection.
2. Required status checks configured.
3. Auto-merge enabled.
4. Squash merge enabled (recommended for linear history).
5. Issue templates and PR template present.
6. CODEOWNERS present for critical paths.

## Portability Checklist (For Other Projects)

Copy this workflow by applying:

1. New Project board with standard fields/statuses.
2. Shared label taxonomy (`lane:*`, `priority:*`, `risk:*`, `agent:*`).
3. Ruleset baseline with minimal required checks.
4. Security baseline workflows (dependency review, code scanning, secret scanning, Dependabot).
5. Reusable workflow modules (`workflow_call`) for common checks.
6. CLAUDE/AGENTS trigger line to this workflow doc in each target repo.

## Implementation Assets (This Repository)

Use these assets as the standard starter pack for this and future repositories:

1. `.github/ISSUE_TEMPLATE/agent-work-item.yml`
2. `.github/ISSUE_TEMPLATE/incident-report.yml`
3. `.github/PULL_REQUEST_TEMPLATE.md` (issue-link contract)
4. `.github/labels.json` (portable label taxonomy)
5. `.github/workflows/multi-agent-governance.yml` (auto-label + issue-link enforcement)
6. `.github/workflows/project-intake-sync.yml` (auto-add Issues/PRs to Project board when PAT is configured)
7. `scripts/workflow/sync-github-labels.sh` (safe label upsert, non-destructive)
8. `scripts/workflow/apply-branch-protection-baseline.sh` (low-friction branch protection baseline)

Bootstrap sequence:

```bash
bash scripts/workflow/sync-github-labels.sh <owner/repo>
bash scripts/workflow/apply-branch-protection-baseline.sh <owner/repo> [branch]
```

Project automation prerequisite:

1. Add repository secret `ADD_TO_PROJECT_PAT` with `project` + repository scopes.
2. Set `project-url` in `.github/workflows/project-intake-sync.yml` to the target board.

## Suggested Metrics

Track weekly:

1. `issue_cycle_time_days` (open -> done).
2. `blocked_issue_ratio`.
3. `pr_first_pass_rate` (merged without rework cycles).
4. `required-check-failure-rate`.
5. `security-alert-open-count`.
6. `automation-vs-manual-fix ratio`.

Adopt workflow changes only when reliability holds and operator burden stays flat or improves.

## Anti-Patterns

1. Agents working without Issue IDs.
2. Multiple active PRs for one Issue without explicit split.
3. Long-lived “In Progress” items with no status heartbeat.
4. Treating Discussions as execution tracking.
5. Adding blocking checks without latency/noise evidence.
