---
name: push
description: Push current branch changes to origin and create or update the corresponding pull request. Runs pre-push validation including format autofix. Use when user says "push", "publish", "create PR", or needs to send branch to remote.
---

# Push

## Prerequisites

- `gh` CLI is installed and available in `PATH`.
- `gh auth status` succeeds for GitHub operations in this repo.
- In Codex/harness sessions, request escalated execution directly for `gh` commands and remote git operations before first use.

## Goals

- Push current branch changes to `origin` safely.
- Create a PR if none exists for the branch, otherwise update the existing PR.
- Keep branch history clean when remote has moved.
- For this repo, never push to `upstream`; `origin` is the only allowed push/PR target.
- **ALWAYS use `--repo ingpoc/nanoclaw`** when creating or editing PRs - never use `--repo qwibitai/nanoclaw` or leave repo unspecified.

## Pre-Push Autofix

Before running validation, always run format check first. If it fails, auto-fix:

```bash
# Run format check first - prevents ~30% of CI failures
if ! npm run format:check 2>/dev/null; then
  npm run format
  git add -A
  git commit -m "style: auto-fix formatting"
  echo "Format fixed and committed"
fi
```

**Why**: Most CI format failures are preventable by fixing locally before push. This saves ~2-5 min per failure.

## Haiku Subagent Parallel Pre-Push Checks

**When to use:**

- Large PR with many files → spawn for parallel speedup
- Small/quick changes → skip, run sequential (faster for trivial cases)
- Time-sensitive push → skip, run sequential
- Regular push → default: spawn for thoroughness

**When NOT to use:**

- Single file changes
- Documentation-only changes
- Already verified changes (re-push after fix)
- When any failure should immediately stop

**Smart spawning logic:**

```bash
# Check if Haiku parallel checks are worthwhile
file_count=$(git diff --name-only HEAD~1 | wc -l)
if [ "$file_count" -gt 5 ]; then
  # Spawn parallel Haiku checks
else
  # Run sequential checks (faster for small changes)
fi
```

**When to kill:**

- Any check fails → kill other running checks immediately
- All checks pass → let them complete
- User cancels → kill all

For faster validation, spawn Haiku subagents in PARALLEL to run checks concurrently:

### 1. Typecheck Haiku

```
agent:Haiku
description: Run TypeScript type check
prompt: |
  Run: npm run typecheck
  If errors: report specific error messages.
  If pass: report "typecheck: PASS"
model: haiku
run_in_background: true
```

### 2. Tests Haiku

```
agent:Haiku
description: Run unit tests
prompt: |
  Run: npm test 2>&1 | tail -20
  If failures: report which tests failed.
  If pass: report "tests: PASS"
model: haiku
run_in_background: true
```

### 3. Workflow Contracts Haiku

```
agent:Haiku
description: Check workflow contracts
prompt: |
  Run: bash scripts/check-workflow-contracts.sh
  If fail: report specific contract failures.
  If pass: report "contracts: PASS"
model: haiku
run_in_background: true
```

### 4. Tooling Governance Haiku

```
agent:Haiku
description: Check tooling governance
prompt: |
  Run: bash scripts/check-tooling-governance.sh
  If fail: report specific governance issues.
  If pass: report "governance: PASS"
model: haiku
run_in_background: true
```

**Pattern**: Spawn all 4 Haiku agents in parallel before push. Wait for all to complete.

- If any fail: report failures, let user decide whether to proceed
- If all pass: proceed with push

This speeds up validation by running checks concurrently instead of sequentially.

## Related Skills

- `pull`: use this when push is rejected or sync is not clean (non-fast-forward,
  merge conflict risk, or stale branch).

## Steps

1. Identify current branch and confirm remote state.
   - In Codex/harness sessions, do this with escalated execution rather than attempting sandboxed `gh` or remote git first.
2. Run local validation before pushing.
   - Preferred full gate: `bash scripts/workflow/finalize-pr.sh`
   - If the full acceptance-gate path is intentionally out of scope for the current change, run the scoped minimum:
     - `npm run typecheck`
     - `npm test`
     - `bash scripts/check-workflow-contracts.sh`
     - `bash scripts/check-claude-codex-mirror.sh`
     - `bash scripts/check-tooling-governance.sh`
     - `git diff --check`
3. Push branch to `origin` with upstream tracking if needed, using whatever
   remote URL is already configured.
   - Do not retarget the push to `upstream` (`qwibitai/nanoclaw`).
4. If push is not clean/rejected:
   - If the failure is a non-fast-forward or sync problem, run the `pull`
     skill to merge `origin/main`, resolve conflicts, and rerun validation.
   - Push again; use `--force-with-lease` only when history was rewritten.
   - If the failure is due to auth, permissions, or workflow restrictions on
     the configured remote, stop and surface the exact error instead of
     rewriting remotes or switching protocols as a workaround.

5. Ensure a PR exists for the branch:
   - If no PR exists, create one.
   - If a PR exists and is open, update it.
   - If branch is tied to a closed/merged PR, create a new branch + PR.
   - Write a proper PR title that clearly describes the change outcome
   - For branch updates, explicitly reconsider whether current PR title still
     matches the latest scope; update it if it no longer does.
6. Write/update PR body explicitly using `.github/pull_request_template.md`:
   - Fill every section with concrete content for this change.
   - Replace all placeholder comments (`<!-- ... -->`).
   - Keep bullets/checkboxes where template expects them.
   - If PR already exists, refresh body content so it reflects the total PR
     scope (all intended work on the branch), not just the newest commits,
     including newly added work, removed work, or changed approach.
   - Do not reuse stale description text from earlier iterations.
7. Validate PR body manually against `.github/pull_request_template.md`:
   - fill every section with concrete content
   - remove all placeholder comments
   - ensure checked boxes match the actual scope and evidence
8. Reply with the PR URL from `gh pr view`.

## Commands

```sh
# Identify branch
branch=$(git branch --show-current)

# Preferred full validation gate
bash scripts/workflow/finalize-pr.sh

# If the full gate is intentionally out of scope for the change, run the
# scoped minimum instead:
npm run typecheck
npm test
bash scripts/check-workflow-contracts.sh
bash scripts/check-claude-codex-mirror.sh
bash scripts/check-tooling-governance.sh
git diff --check

# Initial push: respect the current origin remote.
git push -u origin HEAD

# If that failed because the remote moved, use the pull skill. After
# pull-skill resolution and re-validation, retry the normal push:
git push -u origin HEAD

# If the configured remote rejects the push for auth, permissions, or workflow
# restrictions, stop and surface the exact error.

# Only if history was rewritten locally:
git push --force-with-lease origin HEAD

# Ensure a PR exists (create only if missing)
pr_state=$(gh pr view --json state -q .state 2>/dev/null || true)
if [ "$pr_state" = "MERGED" ] || [ "$pr_state" = "CLOSED" ]; then
  echo "Current branch is tied to a closed PR; create a new branch + PR." >&2
  exit 1
fi

# Write a clear, human-friendly title that summarizes the shipped change.
pr_title="<clear PR title written for this change>"
if [ -z "$pr_state" ]; then
  # ALWAYS use --repo ingpoc/nanoclaw - never create PRs on qwibitai/nanoclaw
  gh pr create --repo ingpoc/nanoclaw --title "$pr_title"
else
  # Reconsider title on every branch update; edit if scope shifted.
  gh pr edit --repo ingpoc/nanoclaw --title "$pr_title"
fi

# Write/edit PR body to match .github/pull_request_template.md before validation.
# Example workflow:
# 1) open the template and draft body content for this PR
# 2) gh pr edit --repo ingpoc/nanoclaw --body-file /tmp/pr_body.md
# 3) for branch updates, re-check that title/body still match current diff
# 4) confirm all template sections are filled and no placeholder comments remain

# Show PR URL for the reply
gh pr view --repo ingpoc/nanoclaw --json url -q .url
```

## Notes

- Do not use `--force`; only use `--force-with-lease` as the last resort.
- Distinguish sync problems from remote auth/permission problems:
  - Use the `pull` skill for non-fast-forward or stale-branch issues.
  - Surface auth, permissions, or workflow restrictions directly instead of
    changing remotes or protocols.
