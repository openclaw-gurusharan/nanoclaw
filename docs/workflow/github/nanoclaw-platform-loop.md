# NanoClaw Platform Claude Loop

## Purpose

Canonical workflow for the dedicated Claude Code `/loop` lane that autonomously picks scoped `NanoClaw Platform` work, implements it, and hands it to Codex review.

## Doc Type

`workflow-loop`

## Canonical Owner

This document owns the NanoClaw Platform `/loop` execution flow.
It does not replace:

- `docs/workflow/github/github-agent-collaboration-loop.md` for day-to-day GitHub surface usage
- `docs/workflow/github/nanoclaw-github-control-plane.md` for GitHub-hosted review/governance policy
- `docs/workflow/strategy/workflow-optimization-loop.md` for changelog research, pilot gating, and adoption decisions

## Use When

- changing the `NanoClaw Platform` autonomous Claude lane
- editing `.claude/commands/platform-pickup.md`
- editing the launch/bootstrap scripts for the dedicated platform loop session
- changing platform-board field/state rules used by the loop

## Do Not Use When

- working on `Andy/Jarvis Delivery`
- changing only GitHub Actions/rulesets/review policy
- deciding whether a changelog idea should become committed work

## Verification

- `node scripts/workflow/platform-loop.js next`
- `node scripts/workflow/platform-loop.js cleanup-candidates`
- `node scripts/workflow/platform-loop.js ids --issue 1 --title "example"`
- `npm test -- src/platform-loop.test.ts src/github-project-sync.test.ts`
- `bash scripts/check-workflow-contracts.sh`
- `bash scripts/check-claude-codex-mirror.sh`
- `bash scripts/check-tooling-governance.sh`

## Related Docs

- `docs/workflow/github/github-agent-collaboration-loop.md`
- `docs/workflow/github/nanoclaw-github-control-plane.md`
- `docs/workflow/strategy/workflow-optimization-loop.md`
- `groups/andy-developer/docs/github-workflow-admin.md`

## Precedence

1. Discussions decide whether platform automation candidates should be piloted.
2. This doc governs the recurring Claude implementation lane after a platform Issue is already `Ready`.
3. Codex review, merge policy, and required checks remain governed by the normal GitHub control-plane docs.

## Phases

### 1. Candidate Formation

1. Start in `SDK / Tooling Opportunities`.
2. Require Claude and Codex decision comments: `accept`, `pilot`, `defer`, or `reject`.
3. Promote to one `NanoClaw Platform` Issue only when the discussion decision is unanimous enough to commit work.
4. Promotion alone does not make the Issue `Ready`.
5. Before the item can enter `Ready`, Codex must write or normalize the execution contract on the Issue:
   - `Problem Statement`
   - `Execution Board`
   - `Scope`
   - `Acceptance Criteria`
   - `Expected Productivity Gain`
   - `Base Branch`
   - `Required Checks`
   - `Required Evidence`
   - `Blocked If`
   - `Ready Checklist`
6. Scope the first change as a pilot when it affects workflow, autonomy, or operator load.

### 2. Dispatch Readiness

The Issue is eligible for the loop only when all are true:

1. local GitHub auth is confirmed as `ingpoc` before any platform-board read or write
2. `Status=Ready`
3. no other Claude-owned item is already `In Progress`
4. no Claude-owned item is already in `Review`
5. Codex has explicitly authored or validated the execution contract on the Issue before setting `Ready`
6. the Issue body includes:
   - `Problem Statement`
   - `Execution Board`
   - `Scope`
   - `Acceptance Criteria`
   - `Expected Productivity Gain`
   - `Base Branch`
   - `Required Checks`
   - `Required Evidence`
   - `Blocked If`
   - `Ready Checklist` fully checked
7. the Issue is not label-blocked

### 3. Claude Pickup

1. The dedicated Claude session runs `/loop 1h /platform-pickup`.
2. `/platform-pickup` must begin by confirming the active GitHub account is `ingpoc`.
3. `/platform-pickup` first runs `node scripts/workflow/platform-loop.js cleanup-candidates`.
4. For each returned cleanup item, Claude runs `bash scripts/workflow/platform-loop-worktree.sh cleanup --issue ... --branch ...`.
5. Cleanup is local-only:
   - remove the clean per-issue execution worktree
   - delete the matching local issue branch
   - prune stale worktree metadata
   - never touch the control worktree
6. `/platform-pickup` then runs `node scripts/workflow/platform-loop.js next`.
7. If the helper returns `noop`, Claude stops immediately with no work picked.
8. If the helper returns a candidate, Claude must prepare the issue execution worktree from the issue `Base Branch`:
   - run `bash scripts/workflow/platform-loop-worktree.sh prepare --issue ... --branch ... --base <Base Branch>`
   - fetch `origin/<Base Branch>` first
   - block instead of guessing if the remote base branch or worktree state is invalid
9. After preparation succeeds, Claude generates a `request_id`, `run_id`, and branch via `node scripts/workflow/platform-loop.js ids ...`.
10. Claude moves the board item to `In Progress` and sets `Agent=claude` using `node scripts/workflow/platform-loop.js set-status ...`.
11. Claude immediately leaves an issue comment proving claim ownership:
   - `request_id`
   - `run_id`
   - branch
   - current board status
   - next visible step
12. If the board is missing the optional text fields (`Request ID`, `Run ID`, `Next Decision`), the issue comment is the temporary source of truth until the board schema is repaired.

### 4. Bounded Implementation

1. Claude creates or reuses the dedicated issue branch only after the execution worktree is prepared from the latest `origin/<Base Branch>`.
2. Claude works only within the scoped touch set.
3. Claude runs the required checks from the Issue.
4. On ambiguity, missing scope, failed required checks, or base/worktree preparation failure, Claude sets `Status=Blocked`, writes the next decision, comments on the issue with the exact blocker, and stops.

### 5. PR and Review Handoff

1. Claude opens or updates a PR linked to the Issue.
2. The PR must include:
   - summary
   - verification evidence
   - risks
   - rollback notes
3. Claude moves the item to `Review`.
4. Claude leaves an issue comment with:
   - PR URL
   - branch
   - `request_id`
   - `run_id`
   - checks run
   - known risks
5. `Next Decision` must be a Codex review action, not a vague note.

### 6. Loop Runtime

1. The loop is session-scoped inside Claude Code.
2. The repo tracks the command and bootstrap surfaces:
   - `.claude/commands/platform-pickup.md`
   - `scripts/workflow/run-platform-claude-session.sh`
   - `scripts/workflow/start-platform-loop.sh`
   - `scripts/workflow/trigger-platform-pickup-now.sh`
   - `scripts/workflow/platform-loop-worktree.sh`
   - `scripts/workflow/check-platform-loop.sh`
   - `launchd/com.nanoclaw-platform-loop.plist`
3. The dedicated session is re-armed locally by the health/bootstrap scripts.
4. The dedicated git worktree is the isolation boundary for the unattended loop. It prevents the platform lane from mutating the maintainer working tree, but it does not solve Claude permission prompts by itself.
5. `scripts/workflow/run-platform-claude-session.sh` launches Claude inside that worktree using `--permission-mode bypassPermissions` by default and loads `CLAUDE_CODE_OAUTH_TOKEN` from the repo `.env` when present.
6. `scripts/workflow/start-platform-loop.sh` syncs the loop command/helper scripts into the dedicated control worktree before launching Claude.
7. `scripts/workflow/trigger-platform-pickup-now.sh` is the manual one-shot test trigger for the same pickup flow.
8. The persistent control worktree is not the implementation workspace for picked issues; issue code changes happen in `.worktrees/platform-<issue>`.
9. The loop never merges PRs and never bypasses required checks.
10. Use interactive Claude Code for the `/loop` lane. Do not try to run `/platform-pickup` through `claude -p`:
   - the official headless/programmatic CLI flow is `claude -p`
   - interactive slash commands are not available in `-p` mode
   - use headless mode only for non-interactive follow-up automation that does not depend on slash commands

## Exit Criteria

This workflow is operating correctly when all are true:

1. only one platform item can be active in the Claude lane at a time
2. the loop never starts from an incomplete Issue
3. every automation PR arrives in `Review` with evidence
4. every active Claude-owned item has a visible claim comment on the linked issue
5. blocked states include a concrete next decision and a matching issue comment
6. Codex review remains explicit and human merge remains mandatory

## Anti-Patterns

1. letting `/loop` decide strategy from a vague issue
2. using the board as long-form planning storage
3. running multiple platform pilots in parallel
4. letting the loop continue while another Claude-owned item is already in `Review`
5. treating `/loop` as durable without a local rebootstrap path
