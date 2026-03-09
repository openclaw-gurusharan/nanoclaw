---
description: Pick one Ready NanoClaw Platform issue, clean merged execution worktrees, implement from the latest approved base, and hand it to Codex review.
allowed-tools: Read,Grep,Glob,Edit,Write,Bash(node scripts/workflow/platform-loop.js:*),Bash(bash scripts/workflow/platform-loop-worktree.sh:*),Bash(gh auth:*),Bash(gh api:*),Bash(gh issue:*),Bash(gh pr:*),Bash(git status),Bash(git add:*),Bash(git commit:*),Bash(git push:*),Bash(npm run build),Bash(npm test)
---

Run the NanoClaw Platform autonomous pickup flow.

Requirements:

1. Never pick work outside the `NanoClaw Platform` board.
2. Never pick work unless the helper reports exactly one eligible item.
3. Never continue if another Claude-owned item is already `In Progress` or `Review`.
4. Never guess missing scope. Move the issue to `Blocked` instead.
5. Never merge. Hand off to Codex review.
6. Always honor the issue `Base Branch` and prepare the execution worktree from the latest `origin/<Base Branch>`.

Execution flow:

1. Confirm the active GitHub account for the NanoClaw platform board:
   - run `gh api user -q .login`
   - if the result is not `ingpoc`, run `gh auth switch --user ingpoc`
   - rerun `gh api user -q .login` and stop if it is still not `ingpoc`
2. Run `node scripts/workflow/platform-loop.js cleanup-candidates`.
3. For every returned item, run:
   - `bash scripts/workflow/platform-loop-worktree.sh cleanup --issue <issue-number> --branch "<issue-branch>"`
   - summarize any `skipped` cleanup result in one sentence and continue
4. Run `node scripts/workflow/platform-loop.js next`.
5. If the result is `{ "action": "noop" }`, summarize the reason in one sentence and stop.
6. Read the selected GitHub Issue fully and obey its scope boundary, `Base Branch`, required checks, required evidence, and blocked conditions.
7. Run `bash scripts/workflow/platform-loop-worktree.sh prepare --issue <issue-number> --branch "<issue-branch>" --base "<base-branch>"`.
8. If worktree preparation fails:
   - move the item to `Blocked`
   - set `Next Decision` to the exact base-branch or worktree fix needed
   - leave an issue comment with the failure context
   - stop
9. Run `node scripts/workflow/platform-loop.js ids --issue <issue-number> --title "<issue-title>"` and capture `requestId`, `runId`, and `branch`.
10. Move the board item to `In Progress` and set `Agent=claude`:
   - `node scripts/workflow/platform-loop.js set-status --issue <issue-number> --status "In Progress" --agent claude --review-lane codex --request-id "<requestId>" --run-id "<runId>" --next-decision "Claude to open PR with evidence for Codex review"`
11. Immediately leave an issue comment proving Claude claimed the work:
   - include `request_id`, `run_id`, branch name, current board status, and the next visible step
   - if the board is missing the text fields, the comment becomes the authoritative visibility record until the board schema is fixed
12. Work only inside the prepared per-issue execution worktree from the prepare step.
13. Implement only the scoped change.
14. Run all checks required by the Issue. If the Issue is incomplete or the checks fail:
   - move the item to `Blocked`
   - leave an issue comment with the shortest truthful blocked reason, the failed check if any, and the exact `Next Decision`
   - set a concrete `Next Decision`
   - stop
15. Open or update a PR linked to the issue.
16. Ensure the PR body includes:
   - linked work item
   - summary
   - verification evidence
   - risks and rollback
17. Move the board item to `Review`:
   - `node scripts/workflow/platform-loop.js set-status --issue <issue-number> --status "Review" --agent claude --review-lane codex --request-id "<requestId>" --run-id "<runId>" --next-decision "Codex to review, patch if needed, and confirm merge readiness"`
18. Leave an issue comment for the review handoff:
   - include branch, PR URL, `request_id`, `run_id`, checks run, and any known risks
19. End with a concise review handoff for Codex, including issue number, branch, PR URL, checks run, and any known risks.

Blocked-state rule:

- If any required issue section is missing, or you cannot complete the requested checks, immediately move the item to `Blocked`, comment the issue with the failure context, and stop.
