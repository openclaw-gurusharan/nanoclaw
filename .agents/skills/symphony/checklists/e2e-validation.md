# Symphony E2E Validation Checklist

Reusable checklist for testing any Symphony-dispatched workflow end-to-end.

Replace `<WORKFLOW>` with the workflow name and `<ISSUE-ID>` with the Linear issue identifier.

## Pre-Flight

- [ ] Symphony daemon healthy (`npm run symphony:status` → `daemonHealthy: true`)
- [ ] Linear connectivity works (`symphony_list_runs` returns without error)
- [ ] Notion connectivity works (scan exits 0 or Notion API returns 200)
- [ ] Claude CLI in PATH (`claude --version`)
- [ ] No stale worktree for this issue (`git worktree list`)

## Issue Creation

- [ ] All 7 required sections present
- [ ] `Execution Lane: symphony`
- [ ] `Target Runtime: codex` or `claude-code`
- [ ] `Work Class: nanoclaw-core` or `downstream-project` (NOT `research`/`governance`)
- [ ] `Agent: <name>` (if `claude-code` runtime)
- [ ] Issue in `Ready` state
- [ ] Issue appears in `list-ready` output

## Dispatch

- [ ] Dry-run shows correct backend + agent name
- [ ] Daemon reconcile (`auto_dispatch: true`) or manual dispatch returns pid
- [ ] Linear issue moves to `In Progress`

## Monitoring

- [ ] Process alive (`ps aux | grep <agent-name> | wc -l` > 0)
- [ ] Worktree at `SymphonyWorkspace/nanoclaw/<ISSUE-ID>` (wrong path = bug)
- [ ] Session JSONL shows tool activity (`run.log` empty during run is normal)

## Output Validation

- [ ] `RUN_EXIT.json`: code 0
- [ ] Symphony status: `done` (or `blocked`)
- [ ] Linear issue: `Done`
- [ ] Required Evidence items present in workspace

## Notion Handoff (if applicable)

- [ ] Page created/updated (URL in run.log)
- [ ] Contains decisions with evidence (not just conclusions)
- [ ] Contains explicit `Next:`/`To:` field for downstream agent
- [ ] Contains artifact URLs (branches, PRs, files)
- [ ] Does NOT contain execution logs or interim progress
- [ ] A downstream agent could continue from this page alone

## Protocol Compliance

- [ ] No out-of-scope mutations (PRs, issues, tracked file edits unless workflow allows)
- [ ] `symphony_mark_run_status` called at end
- [ ] Correct MCP tools used (not raw bash for everything)

## Experiment Validation (if applicable)

- [ ] `experiments.json` shows final status (not stuck at `created`/`measured`)
- [ ] Metrics have real values (not `-1`)
- [ ] Promoted branches exist on remote
- [ ] Notion handoff page created for promoted experiments

## Cleanup

- [ ] Run archived (`symphony_archive_runs`)
- [ ] Worktree removed (`git worktree remove --force <path>`)
- [ ] Test issue cancelled in Linear
