# Nightly Improvement Researcher — End-to-End Testing & Troubleshooting Guide

## Purpose

Full walkthrough for testing, validating, and debugging the nightly improvement researcher workflow. An agent reading this guide can execute the complete test cycle autonomously.

## Architecture

```
Linear NAN-29 (Ready)
  → Symphony daemon picks up (reconcile loop)
  → Parses issue: finds "Agent: nightly-improvement-researcher" in Symphony Routing
  → Creates git worktree at /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-29
  → Injects .mcp.json (symphony only; notion + linear via OAuth plugins)
  → Launches: claude -p --agent nightly-improvement-researcher < PROMPT.md
  → Agent runs: scan → research → decide → Notion handoff → mark done
  → Linear issue returns to Ready (recurring)
```

## Key Observed Facts (from 2026-03-13 end-to-end test)

| Fact | Value |
|------|-------|
| Actual workspace path | `/Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-29` |
| Session JSONL path | `~/.claude/projects/-Users-gurusharan-Documents-remote-claude-SymphonyWorkspace-nanoclaw-NAN-29/*.jsonl` |
| run.log during run | Empty — Claude Code buffers internally; use session JSONL for live progress |
| Typical run duration | ~10 min |
| Process pattern | 2–3 procs: shell wrapper + claude child |
| Exit file on success | `{"code": 0, "finishedAt": "..."}` |
| Post-exit Symphony state | Still shows `running` until next reconcile tick |
| Worktree "already in use" warning | Non-fatal — dispatch continues successfully |

---

## Phase 1: Pre-flight Checks

Before testing, verify all dependencies are healthy.

### 1.1 Symphony Daemon

```bash
npm run symphony:status
```

Expected: `daemonHealthy: true`, `enabledProjectCount: 1`

If unhealthy:

```bash
npm run symphony:sync-registry
npm run symphony:daemon -- --once
```

### 1.2 Linear Connectivity

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts list-ready --project-key nanoclaw
```

Expected: returns list (may be empty). If errors: check `LINEAR_API_KEY` in `.env`.

### 1.3 Notion Connectivity

```bash
bash scripts/workflow/run-with-env.sh node scripts/workflow/nightly-improvement.js scan --output /tmp/test-scan.json && echo "scan ok"
```

Expected: exits 0, writes scan JSON.

### 1.4 Claude CLI Available

```bash
PATH=$HOME/.local/bin:$PATH claude --version
```

Expected: version string. If not found: check `CLAUDE_CODE_BIN` in `.env`.

### 1.5 Worktree Path Clean

```bash
git worktree list
ls /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/ 2>/dev/null
```

If stale NAN-XX worktree exists from a previous run:

```bash
git worktree remove --force /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX
```

---

## Phase 2: Create a Test Issue

Use this exact template when creating a test Linear issue. Every section is required for Symphony to accept it.

### 2.1 Linear Issue Template

**Title:** `Nightly Improvement Researcher`

**Description:**

```markdown
Run the NanoClaw nightly improvement evaluation. Scan for net-new upstream and tooling changes, research promising candidates, record decisions to Notion shared-context pages, and hand off to morning Codex triage.

## Problem Statement

NanoClaw needs nightly autonomous research: scan upstream + tooling changes, evaluate them with deep MCP research, record decisions, and hand off to morning Codex.

## Scope

Each run:
1. Run `scan` to detect net-new upstream/tooling changes since last run
2. For each pending candidate: deep research via DeepWiki, Context7, Exa
3. Record decisions (pilot/defer/reject) to Notion shared-context pages
4. For promising candidates: run experiment loop (create branch → measure → iterate → promote/defer)
5. Mark Symphony run done/blocked at end

## Acceptance Criteria

- At least one Notion shared-context page updated with decisions
- All pending candidates evaluated with evidence
- Run status marked done (success) or blocked (failure with reason)
- No direct edits to repo-tracked files, docs, or code

## Required Checks

- [ ] Scan ran without error
- [ ] At least one Notion context page updated (or noop documented)
- [ ] Run status set via `mcp__symphony__symphony_mark_run_status`

## Required Evidence

- Notion upstream or tooling shared-context page URL with decisions
- Experiment branch URL if any promoted

## Blocked If

- Scan fails or errors
- Notion token missing or expired
- `NANOCLAW_SYMPHONY_ISSUE_IDENTIFIER` env var not set

## Symphony Routing

- Execution Lane: symphony
- Target Runtime: claude-code
- Work Class: nanoclaw-core
- Agent: nightly-improvement-researcher
```

### 2.2 Required Linear Team States

The team must have these states: `Backlog`, `Ready`, `In Progress`, `Done`, `Blocked`.

Check:

```bash
bash scripts/workflow/run-with-env.sh bash -c 'curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"query { teams(first:1) { nodes { states { nodes { name type } } } } }\"}" \
  | python3 -c "import json,sys; [print(s[\"name\"]) for s in json.load(sys.stdin)[\"data\"][\"teams\"][\"nodes\"][0][\"states\"][\"nodes\"]]"'
```

### 2.3 Move Issue to Ready

After creating the issue in Linear, move it to `Ready` state. Symphony only dispatches `Ready` issues.

Verify it appears:

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts list-ready --project-key nanoclaw
```

Expected: your issue appears in the list.

---

## Phase 3: Trigger Dispatch

Two methods: daemon reconcile (preferred for true end-to-end test) or manual dispatch-once.

### 3.1 Dry Run First

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw \
  --issue-identifier NAN-XX \
  --dry-run
```

Inspect the output. Verify:

- `backend: claude-code`
- `agentName: nightly-improvement-researcher` (present in plan)
- `workspacePath` points to `SymphonyWorkspace/nanoclaw/NAN-XX`
- `PROMPT.md` content is the issue body

Note: `fatal: 'symphony-nan-XX' is already used by worktree` warning may appear — this is non-fatal, dispatch continues.

### 3.2 Method A: Daemon Auto-Pickup (preferred)

Triggers Symphony to pick up the issue from Linear exactly as it would in production:

```bash
# Via MCP tool (preferred)
mcp__symphony__symphony_reconcile_once  { "auto_dispatch": true }

# Or via CLI
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts daemon --once --auto-dispatch
```

Expected: `readyCounts: { nanoclaw: 1 }`, `autoDispatch: true` — then verify status shows `activeRunIds`.

### 3.3 Method B: Manual Dispatch (bypass daemon)

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw \
  --issue-identifier NAN-XX
```

Expected output: `action: dispatched`, `pid: <number>`

### 3.4 Verify Linear State Changed

Check Linear — issue should now be `In Progress`.

---

## Phase 4: Monitor the Run

### 4.1 Check Run Record

```bash
npm run symphony:status
# or
cat .nanoclaw/symphony/runs/symphony-nan-XX-*.json | python3 -m json.tool
```

Expected fields: `status: running`, `pid: <n>`, `workspacePath`.

### 4.2 Check Process is Alive

```bash
# Check by agent name (more reliable than pid — dispatch spawns shell wrapper + claude child)
ps aux | grep "nightly-improvement-researcher" | grep -v grep | wc -l
# Expected: 2 or 3 (shell + claude process)
```

### 4.3 Confirm Agent is Making Progress

**run.log will be empty during the entire run** — Claude Code buffers all output internally and flushes at exit. Do not rely on it for live progress.

Use the session JSONL for live tool activity:

```bash
# Find the active session file
ls -t ~/.claude/projects/-Users-gurusharan-Documents-remote-claude-SymphonyWorkspace-nanoclaw-NAN-29/*.jsonl | head -1

# Tail last tool called
tail -15 <session-file> | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        if d.get('type') == 'assistant':
            for b in d.get('message', {}).get('content', []):
                if b.get('type') == 'tool_use':
                    print(b['name'], str(b.get('input', {}))[:80])
    except: pass
" | tail -3
```

### 4.4 Efficient Monitoring Loop (Haiku subagent)

For hands-off monitoring, schedule a Haiku subagent via CronCreate:

```
CronCreate every 2 minutes:
  Agent (model=haiku): run ps count + symphony_list_runs + session JSONL tail in parallel
  Report: Symphony status | Process alive/dead | Last tool
  Self-terminate (CronDelete) when status is done/blocked/failed/canceled or process=dead
```

The subagent uses 3 parallel tool calls and ~68K tokens per tick at ~5s. Cancel with `CronDelete <job_id>`.

---

## Phase 5: Validate the Output

Once the run completes (`RUN_EXIT.json` appears with `code: 0`):

### 5.1 Check Exit Status

```bash
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/RUN_EXIT.json
```

Expected: `{ "code": 0, "finishedAt": "..." }`

Non-zero exit = agent crashed. Check full log.

### 5.2 Check Symphony Run Status

```bash
npm run symphony:status
```

Expected: `lastRunStatus: done` (or `blocked` if agent hit a blocker).

If still `running` after exit file appeared: Symphony reconcile loop hasn't ticked yet. Run manually:

```bash
mcp__symphony__symphony_reconcile_once  {}
# or
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts daemon --once
```

### 5.3 Check Linear Issue State

Issue should be `Done` if agent marked it correctly via `symphony_mark_run_status`.

If still `In Progress`: agent either crashed before marking done, or `mcp__symphony__symphony_mark_run_status` failed. Check the run log for errors.

### 5.4 Validate Notion Pages Updated

Search Notion for the upstream and tooling shared-context pages:

- `[Nightly] NanoClaw Upstream Sync`
- `[Nightly] SDK and Tooling Opportunities`

Each page should have a new decision block with:

- `<!-- nightly-improvement:upstream -->` or `<!-- nightly-improvement:tooling -->` marker
- `Agent Label: Claude Code`
- `Decision: pilot|defer|reject`
- `To: Codex`
- `Status: needs-input`
- `Next: morning Codex triage`

If pages not updated: either scan returned noop (no changes detected) or agent failed before writing. Check:

```bash
cat /tmp/nightly-improvement-scan.json 2>/dev/null || \
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/.nanoclaw/nightly-improvement/state.json 2>/dev/null
```

### 5.5 Validate Worktree

```bash
ls /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/
```

Expected files:

| File | Purpose |
|------|---------|
| `PROMPT.md` | Symphony-generated prompt from issue body |
| `RUN.json` | Run manifest (issue, backend, env) |
| `RUN_EXIT.json` | Exit code + timestamp |
| `run.log` | Full agent output |
| `.mcp.json` | Symphony MCP injected by dispatch |
| `CLAUDE.md` | Symlinked or copied from repo root |

### 5.6 Validate Experiment State (if agent ran experiments)

```bash
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/.nanoclaw/nightly-improvement/experiments.json 2>/dev/null | python3 -m json.tool
```

Check each experiment has:

- `status: promoted | deferred | rejected` (not stuck at `created` or `measured`)
- `metrics.containerStartup.value` is not `-1` (measurement succeeded)
- Promoted experiments have `branchUrl` set

For promoted experiments, verify branch exists on remote:

```bash
git fetch origin
git branch -r | grep nightly/eval-
```

---

## Phase 6: Protocol Compliance Checks

Verify the agent followed the research protocol correctly.

### 6.1 Research Protocol

Read the run log and verify each step was executed:

```bash
grep -E "scan|research|DeepWiki|Context7|exa|pilot|defer|reject|upsert-context|append-decision" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/run.log
```

Expected pattern:

1. `scan` command ran
2. For each pending candidate: MCP research tools used (deepwiki, context7, or exa)
3. Local verification ran (grep/read for existing patterns)
4. `upsert-context` called with body containing structured update
5. `append-decision` called with `pilot|defer|reject` + evidence

### 6.2 Invariants Check

```bash
grep -E "issueCreate|createIssue|openPR|git push|git commit" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/run.log
```

Expected: empty (or only `git push` for promoted experiment branches). Agent must NOT have:

- Created Linear issues directly
- Opened PRs
- Edited repo-tracked files outside experiment branches

### 6.3 Handoff Quality Check

Fetch the Notion upstream page and verify it contains:

- Exact evaluated range or version delta (not vague summaries)
- Source links actually used in research
- What is net-new vs already known
- NanoClaw subsystem fit assessment
- `P1`, `P2`, or `P3` priority marker
- One of these markers: `<!-- ADOPT -->`, `<!-- PILOT -->`, `<!-- DEFER -->`, `<!-- REJECT -->`

### 6.4 Run Completion Check

```bash
grep -E "symphony_mark_run_status|mark_run_status|status.*done|status.*blocked" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/run.log
```

Expected: `symphony_mark_run_status` called with `done` or `blocked`.

---

## Phase 7: Cleanup After Test

### 7.1 Archive the Test Run

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts archive-runs --project-key nanoclaw
```

### 7.2 Remove Worktree

```bash
git worktree remove --force \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX
git worktree prune
```

### 7.3 Clean Experiment State

```bash
rm -f .nanoclaw/nightly-improvement/experiments.json
```

### 7.4 Delete Test Issue in Linear

Move the test issue to `Cancelled` in Linear to avoid it being re-dispatched.

---

## Common Failure Modes

### Issue Not Picked Up

**Symptom**: `list-ready` returns 0 issues despite issue being Ready.

**Checks**:

- Issue has all 7 required sections
- `Execution Lane: symphony` (not `claude-code`)
- `Work Class: nanoclaw-core` (not `research` or `governance` — those are blocked by Symphony)
- Issue is in correct Linear project (nanoclaw)

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw --issue-identifier NAN-XX --dry-run 2>&1
```

The dry-run error message will tell you exactly which validation failed.

### `--agent` Flag Not Passed

**Symptom**: Agent runs but doesn't follow nightly researcher protocol (no scan, generic responses).

**Check**: Verify `Agent:` field in issue Symphony Routing section and command template:

```bash
grep NANOCLAW_SYMPHONY_CLAUDE_CODE_COMMAND .env
# Should contain {agent}
```

Expected: `claude -p {agent} --dangerously-skip-permissions ...`

### MCP Tools Not Available to Agent

**Symptom**: Agent can't call `symphony_mark_run_status` or Notion tools.

**Check**: Verify `.mcp.json` in worktree:

```bash
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/.mcp.json
```

Expected: `symphony` server present. Notion and Linear come via OAuth plugins (not in `.mcp.json`).

If symphony MCP missing: `injectMcpConfig` in `symphony-dispatch.ts` may have regressed.

### Worktree Already Exists

**Symptom**: `fatal: 'symphony-nan-XX' is already used by worktree`

```bash
git worktree list
git worktree remove --force /path/to/stale/worktree
git worktree prune
```

### Scan Returns Noop Every Run

**Symptom**: Agent runs but always exits with "no upstream/tooling changes".

**Check cursor state**:

```bash
cat .nanoclaw/nightly-improvement/state.json | python3 -m json.tool
# Look at last_upstream_sha and tool_versions
```

**Force re-evaluation**:

```bash
node scripts/workflow/nightly-improvement.js scan --force --output /tmp/scan.json
cat /tmp/scan.json
```

### Agent Exceeds maxTurns

**Symptom**: Log ends with "max turns reached" before completing.

Current limit: `maxTurns: 24`. If scan returns many candidates, agent may exhaust turns before finishing.

**Fix**: Either increase `maxTurns` in `.claude/agents/nightly-improvement-researcher.md`, or add a prioritization step to the agent protocol (research top 2 candidates max).

### Notion Handoff Not Created

**Symptom**: Notion pages not updated despite agent completing.

**Check**: Log for Notion API calls:

```bash
grep -E "notion|upsert-context|notion-fetch|notion-create" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX/run.log
```

**Common cause**: Agent hit token limit before reaching Notion write step, or `NOTION_TOKEN` expired.

### Process Dead but Symphony Still Shows Running

**Symptom**: `ps aux | grep nightly-improvement-researcher` returns 0, but `symphony_list_runs` shows `status: running`.

**Cause**: Symphony reconcile hasn't ticked since the process exited. The exit file tells the truth.

**Fix**:

```bash
# 1. Check exit file first
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-29/RUN_EXIT.json
# { "code": 0, "finishedAt": "..." } = success

# 2. Trigger reconcile to sync state
mcp__symphony__symphony_reconcile_once  {}
```

If exit code was non-zero: check full run.log (it will have content at this point — Claude flushes on exit).

### Worktree Created at Wrong Path

**Symptom**: Worktree appears anywhere other than `/Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/NAN-XX`.

**This is a bug.** Check `NANOCLAW_SYMPHONY_WORKSPACE_BASE` in `.env`:

```bash
grep SYMPHONY_WORKSPACE_BASE .env
# Must be: NANOCLAW_SYMPHONY_WORKSPACE_BASE=/Users/gurusharan/Documents/remote-claude/SymphonyWorkspace
```

If wrong: fix `.env`, then remove the stale worktree and re-dispatch.

### Linear Issue Stays In Progress

**Symptom**: Issue is `In Progress` after run completed.

**Cause**: Agent didn't call `symphony_mark_run_status`. Symphony marks it done only if the agent calls this tool.

**Manual fix**:

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts mark-run-status \
  --run-id symphony-nan-XX-YYYY --status done
```

Then move the Linear issue to `Done` manually.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run symphony:status` | Daemon health + active runs |
| `npm run symphony:sync-registry` | Sync Notion project registry |
| `npm run symphony:serve` | Open dashboard at <http://127.0.0.1:4318/> |
| `npx tsx scripts/workflow/symphony.ts list-ready --project-key nanoclaw` | Check ready queue |
| `npx tsx scripts/workflow/symphony.ts dispatch-once --project-key nanoclaw --dry-run` | Validate before real dispatch |
| `npx tsx scripts/workflow/symphony.ts dispatch-once --project-key nanoclaw` | Manual real dispatch |
| `mcp__symphony__symphony_reconcile_once { "auto_dispatch": true }` | Daemon auto-pickup from Linear (preferred) |
| `ps aux \| grep nightly-improvement-researcher \| grep -v grep \| wc -l` | Check agent process count |
| `node scripts/workflow/nightly-improvement.js scan --output /tmp/s.json` | Manual scan |
| `node scripts/workflow/nightly-improvement.js scan --force --output /tmp/s.json` | Force scan (ignores cursor) |
| `git worktree list` | List all worktrees |
| `git worktree remove --force <path>` | Remove stale worktree |

## Full Validation Checklist

```
PRE-FLIGHT
- [ ] Symphony daemon healthy (npm run symphony:status)
- [ ] Linear connectivity works (list-ready returns without error)
- [ ] Notion connectivity works (scan exits 0)
- [ ] Claude CLI found in PATH
- [ ] No stale worktrees for this issue

ISSUE CREATION
- [ ] All 7 required sections present
- [ ] Execution Lane: symphony
- [ ] Target Runtime: claude-code
- [ ] Work Class: nanoclaw-core
- [ ] Agent: nightly-improvement-researcher
- [ ] Issue moved to Ready in Linear

DISPATCH
- [ ] Dry-run shows correct backend + agentName
- [ ] Real dispatch returns pid
- [ ] Linear issue moves to In Progress

MONITORING
- [ ] Process alive (ps aux | grep nightly-improvement-researcher | wc -l > 0)
- [ ] Worktree at correct path (SymphonyWorkspace/nanoclaw/NAN-XX) — wrong path = bug
- [ ] Session JSONL shows tool activity (run.log will be empty during run — this is normal)
- [ ] Monitor loop running (Haiku subagent CronCreate every 2m)

OUTPUT VALIDATION
- [ ] RUN_EXIT.json code: 0
- [ ] Symphony run status: done
- [ ] Linear issue: Done
- [ ] Notion upstream page updated with decision + markers
- [ ] Notion tooling page updated with decision + markers (if tooling changed)

PROTOCOL COMPLIANCE
- [ ] Scan ran before any research
- [ ] MCP tools used for each candidate (not surface-level)
- [ ] Local verification ran before each decision
- [ ] No Linear issues created directly
- [ ] No PRs opened (except promoted experiment branches)
- [ ] No edits to repo-tracked files
- [ ] symphony_mark_run_status called at end

EXPERIMENT VALIDATION (if applicable)
- [ ] experiments.json shows final status (not stuck at created/measured)
- [ ] Metrics have real values (not -1)
- [ ] Promoted branches exist on remote
- [ ] Notion handoff page created for promoted experiments

CLEANUP
- [ ] Run archived
- [ ] Worktree removed
- [ ] Test issue cancelled in Linear
```
