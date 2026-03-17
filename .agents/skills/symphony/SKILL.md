---
name: symphony
description: |
  Symphony workflow automation. Use for dispatch, reconcile, run management,
  registry/queue diagnostics, issue template creation, and e2e testing.
  Do NOT use linear-specific tools for Symphony orchestration.
---

# Symphony Workflow Automation

Symphony is the automated agent dispatch system that picks up Linear issues and executes them in git worktrees.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp__symphony__symphony_list_runs` | List runs for a project |
| `mcp__symphony__symphony_dispatch_once` | Manually dispatch an issue |
| `mcp__symphony__symphony_reconcile_once` | Trigger daemon reconcile loop |
| `mcp__symphony__symphony_get_runtime_state` | Get daemon health status |
| `mcp__symphony__symphony_get_run` | Get specific run details |
| `mcp__symphony__symphony_get_run_log` | Get run log output |
| `mcp__symphony__symphony_stop_run` | Stop a running agent |
| `mcp__symphony__symphony_mark_run_status` | Manually mark run status |
| `mcp__symphony__symphony_archive_runs` | Archive old runs |
| `mcp__symphony__linear_graphql` | Linear access (for issue reads/writes) |

## Quick Commands

### List runs

```
mcp__symphony__symphony_list_runs { "project_key": "nanoclaw", "limit": 10 }
```

### Dispatch issue manually

```
mcp__symphony__symphony_dispatch_once { "project_key": "nanoclaw", "issue_identifier": "NAN-33" }
```

### Trigger reconcile (daemon pickup)

```
mcp__symphony__symphony_reconcile_once { "auto_dispatch": true }
```

### Check daemon health

```
mcp__symphony__symphony_get_runtime_state {}
```

### Mark run done (if agent crashed)

```
mcp__symphony__symphony_mark_run_status { "run_id": "<RUN-ID>", "status": "done" }
```

---

## CLI Fallback (when MCP unavailable)

All `npm run symphony:*` commands now use `--env-file=.env` internally. If you need direct CLI access:

```bash
# Dashboard
node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts serve --port 4318

# MCP server
node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony-mcp.ts
```

| npm command | Direct equivalent |
|-------------|-------------------|
| `npm run symphony:setup` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts setup` |
| `npm run symphony:sync-registry` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts sync-registry` |
| `npm run symphony:status` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts status` |
| `npm run symphony:serve` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts serve --port 4318` |
| `npm run symphony:daemon -- --once` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts daemon --once` |
| `npm run symphony:mcp` | `node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony-mcp.ts` |

**Pre-start check**: Before starting serve or daemon, verify the script imports cleanly:

```bash
npx tsx scripts/workflow/symphony.ts --help 2>&1 | head -5
```

If this crashes with `SyntaxError` or missing export, run `npm run build` first.

---

## Registry & Queue Diagnostics

### Registry Problems

| Symptom | Check | Fix |
|---------|-------|-----|
| `show-projects` empty | `NOTION_PROJECT_REGISTRY_DATABASE_ID` set? | Run `npm run symphony:sync-registry` |
| Project missing from dashboard | Inspect `.nanoclaw/symphony/project-registry.cache.json` | Confirm `Symphony Enabled = true` in Notion |
| Registry sync fails | Check Notion token | Refresh `NOTION_TOKEN` in `.env` |

### Ready Queue Problems

| Symptom | Check | Fix |
|---------|-------|-----|
| Zero ready issues when Linear has work | Issue state is `Ready`? | Move issue to `Ready` in Linear |
| `dispatch-once` returns `no_ready_issue` | Issue body follows template? | Fix Symphony Routing section |
| Wrong backend selected | `Target Runtime` field correct? | Use `codex` or `Codex` (not `jarvis-worker`) |

Backend capability quick reference:

| Backend | MCP Access | Use For |
|---------|-----------|---------|
| `codex` | No MCP during run | Build/test/lint |
| `Codex` | Linear + Notion MCP | Agent posts results back to Linear |

Available `Codex` agents (`.Codex/agents/<name>.md`):

- `nanoclaw-test-runner` — runs Required Checks, posts pass/fail to Linear
- `nightly-improvement-researcher` — nightly scans only

### Dispatch Problems

| Symptom | Check | Fix |
|---------|-------|-----|
| `dispatch-once` fails before launch | Backend command env var set? | Set `NANOCLAW_SYMPHONY_CODEX_COMMAND` or `NANOCLAW_SYMPHONY_CLAUDE_CODE_COMMAND` |
| Run stays `failed`/`blocked` | Required issue sections present? | Ensure all 7 sections exist |
| `--agent` flag not passed | `Agent:` in Symphony Routing? | Add `Agent: <name>` field |
| Agent ignores protocol | Check command template | `grep NANOCLAW_SYMPHONY_CLAUDE_CODE_COMMAND .env` — must contain `{agent}` |

### Dashboard / Daemon Problems

| Symptom | Check | Fix |
|---------|-------|-----|
| Dashboard won't load | Pre-start check passes? | `npm run build` then retry |
| State stays stale | Inspect `.nanoclaw/symphony/state.json` | Run `npm run symphony:daemon -- --once` |
| Silent exit (no output) | Use CLI fallback above | `source .env && npx tsx scripts/workflow/symphony.ts serve` |
| Daemon uses old code after code fix | Daemon loaded code at start and won't hot-reload | `pkill -f 'symphony.ts daemon' && npm run symphony:daemon &` |

### MCP Tooling Problems

| Symptom | Check | Fix |
|---------|-------|-----|
| No Symphony tools | `.mcp.json` has symphony entry? | Add symphony server to `.mcp.json` |
| MCP tools missing at session start | symphony-mcp.ts crashed at init | `npm run symphony:mcp &` (wait 3s), then retry tool |
| Agent can't call `symphony_mark_run_status` | Check `.mcp.json` in worktree | Verify `injectMcpConfig` in `symphony-dispatch.ts` |

> **`symphony:serve` vs `symphony:mcp`**: These are separate processes. `symphony:serve --port 4318` is the HTTP dashboard only — it does NOT provide MCP tools. MCP tools come from `symphony:mcp` (`scripts/workflow/symphony-mcp.ts`), which `.mcp.json` auto-starts. If MCP tools are missing, restart `symphony:mcp`, not `symphony:serve`.

---

## Issue Templates

For issue creation and template requirements → load `/linear` skill, read `references/issue-template-work.md` or `references/issue-template-test.md`.

---

## Branch Actions Quick Reference

| Action | Steps |
|--------|-------|
| **Observe only** | `sync-registry` → `status` → `serve` → inspect dashboard |
| **Prepare one run** | Confirm issue body → `list-ready` → `dispatch-once --dry-run` |
| **Launch one run** | `sync-registry` → (optional `serve`) → `dispatch-once` → inspect run record → `daemon --once` to reconcile |
| **Continuous observation** | `serve` + `daemon` in separate shell + `mcp` when agent operability needed |

Safe handling: treat `dispatch-once --dry-run` as default first check. Do not route research/governance work through Symphony. Dashboard is not source of truth for issue state (Linear is).

---

## Common Failure Modes (Nightly / E2E)

| Failure | Cause | Fix |
|---------|-------|-----|
| Issue not picked up | Missing section, wrong work class, or not Ready | Dry-run shows exact validation error |
| Process dead but Symphony shows running | Reconcile hasn't ticked since exit | Check `RUN_EXIT.json`, then `reconcile_once` |
| Issue stays In Progress after run | Agent didn't call `symphony_mark_run_status` | Manually mark done, then move issue to Done |
| Worktree already exists | Stale worktree from previous run | `git worktree remove --force <path> && git worktree prune` |
| Worktree at wrong path | `NANOCLAW_SYMPHONY_WORKSPACE_BASE` wrong in `.env` | Fix `.env`, remove stale worktree, re-dispatch |
| Agent exceeds maxTurns | Too many candidates per run | Increase `maxTurns` in agent `.md` or add prioritization |
| Scan returns noop every run | Cursor state hasn't changed | `scan --force` to re-evaluate |
| MCP tools unavailable to agent | `.mcp.json` not injected in worktree | Check `injectMcpConfig` in `symphony-dispatch.ts` |
| `run.log` empty during run | Normal — Codex buffers internally | Use session JSONL for live progress |

### Monitoring a run

```bash
# Check process alive
ps aux | grep "<agent-name>" | grep -v grep | wc -l

# Session JSONL for live tool activity
ls -t ~/.Codex/projects/-Users-gurusharan-Documents-remote-Codex-SymphonyWorkspace-nanoclaw-<ISSUE-ID>/*.jsonl | head -1
```

---

## E2E Testing

For full end-to-end validation checklist, see `.Codex/skills/symphony/checklists/e2e-validation.md`.

Quick validation sequence:

1. **Pre-flight**: `npm run symphony:status` + verify Linear/Notion/CLI connectivity
2. **Create issue**: All 7 sections, `Execution Lane: symphony`, `Work Class: nanoclaw-core`
3. **Dispatch**: Dry-run first → daemon reconcile or manual dispatch
4. **Monitor**: Process alive + session JSONL shows tool activity
5. **Validate**: `RUN_EXIT.json` code 0, Symphony status done, Linear issue Done
6. **Cleanup**: Archive runs, remove worktree, cancel test issue

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Missing LINEAR_API_KEY` | Server started without `.env` | Use `--env-file=.env` flag when starting server/MCP (see Restart Symphony section) |
| `No runs found` | Project key wrong or no runs | Verify `project_key` matches config |
| `Dispatch rejected` | Issue missing required sections | Ensure issue has all 7 sections |
| `Worktree already in use` | Stale worktree exists | Run `git worktree remove --force <path>` |
| Run stuck in `running` | Agent crashed before marking done | Manually mark done with MCP |

### Debug Steps

1. **Check daemon health**:

   ```bash
   mcp__symphony__symphony_get_runtime_state {}
   ```

   Expected: `daemonHealthy: true`

2. **Verify Linear connectivity**:

   ```bash
   mcp__symphony__linear_graphql { "query": "query { viewer { name } }" }
   ```

3. **Check for stale worktrees**:

   ```bash
   git worktree list
   ls /Users/gurusharan/Documents/remote-Codex/SymphonyWorkspace/nanoclaw/
   ```

4. **View run log**:

   ```bash
   mcp__symphony__symphony_get_run_log { "run_id": "<RUN-ID>" }
   ```

### Restart Symphony

If MCP completely fails:

```bash
# Kill existing processes
pkill -f symphony

# Start MCP (uses --env-file for reliable env loading)
node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony-mcp.ts &

# Start dashboard (use --env-file for reliable env loading)
node --env-file=.env --import ./node_modules/tsx/dist/loader.mjs scripts/workflow/symphony.ts serve --port 4318 &
```

### Issue Requirements

Symphony validates all 7 sections before dispatching — a missing or placeholder section causes a silent skip with no error message.

Required sections: **Title** · **Description** · **Priority** · **Symphony Routing** (Agent name) · **Target Runtime** · **Work Class** · **Estimate**

> Work Class rules: `research` and `governance` are blocked by Symphony — use `nanoclaw-core` or `downstream-project`.

For the exact content each section needs, load the `/linear` skill and read `references/issue-template-work.md` or `references/issue-template-test.md`.
