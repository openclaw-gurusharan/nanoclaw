# Symphony Workflow — End-to-End Testing Template

## Purpose

Reusable template for testing any Symphony-dispatched workflow end-to-end. Covers issue creation, dispatch, agent execution, Notion handoff, and downstream validation. Any agent reading this can execute a full test cycle autonomously.

Replace `<WORKFLOW>` with the specific workflow name (e.g. `nightly-improvement`, `platform-pickup`).

---

## Architecture (Any Workflow)

```
Linear issue (Ready)
  → Symphony daemon picks up
  → Parses Symphony Routing → resolves backend + agent
  → Creates worktree at SymphonyWorkspace/nanoclaw/<ISSUE-ID>
  → Injects .mcp.json (symphony only; notion + linear via OAuth plugins)
  → Launches: claude -p --agent <agent-name> < PROMPT.md
                OR: codex exec <workspace>
  → Agent executes workflow
  → Agent writes Notion handoff (deliberate, downstream-facing only)
  → Agent marks run done/blocked via symphony_mark_run_status
  → Linear issue → Done (recurring issues return to Ready automatically)
```

---

## Phase 1: Pre-flight Checks

```bash
# 1. Symphony daemon healthy
npm run symphony:status
# Expected: daemonHealthy: true, enabledProjectCount >= 1

# 2. Linear connected
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts list-ready --project-key nanoclaw
# Expected: returns without error (list may be empty)

# 3. Notion connected
bash scripts/workflow/run-with-env.sh node -e "
  const r = await fetch('https://api.notion.com/v1/users/me', {
    headers: { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28' }
  });
  console.log(r.status === 200 ? 'ok' : 'failed: ' + r.status);
" --input-type=module
# Expected: ok

# 4. Claude CLI available
PATH=$HOME/.local/bin:$PATH claude --version

# 5. No stale worktrees for this issue
git worktree list
```

---

## Phase 2: Create the Linear Issue

### 2.1 Issue Template

Copy this. Fill in every section. All 7 sections are required — Symphony rejects issues missing any of them.

```markdown
## Problem Statement

<One paragraph: what problem does this workflow solve, and what happens if it doesn't run.>

## Scope

Each run of this workflow:
- <step 1>
- <step 2>
- <step 3>
Explicitly out of scope: <what this workflow must NOT do>

## Acceptance Criteria

- <Observable outcome 1 — something another agent can verify>
- <Observable outcome 2>
- Run marked done/blocked at end via symphony_mark_run_status

## Required Checks

- [ ] <Primary output exists or was updated>
- [ ] Run status set (done or blocked)
- [ ] <Any test or lint that must pass>

## Required Evidence

- <What the agent must produce: file path, URL, branch name, etc.>
- Notion shared-context page URL (if agent writes one)

## Blocked If

- Required env vars missing (<LIST THEM>)
- <External dependency unavailable>
- <Any hard blocker condition>

## Symphony Routing

- Execution Lane: symphony
- Target Runtime: claude-code
- Work Class: nanoclaw-core
- Agent: <agent-name>
```

> **Work Class rules**: `research` and `governance` are blocked by Symphony — use `nanoclaw-core` or `downstream-project`.
> **Agent field**: only needed for `claude-code` runtime. Omit for `codex`.

### 2.2 Required Linear Team States

States `Ready`, `In Progress`, `Done`, `Blocked` must exist on the team.

```bash
bash scripts/workflow/run-with-env.sh bash -c '
  curl -s -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"query\":\"query { teams(first:1) { nodes { states { nodes { name } } } } }\"}" \
  | python3 -c "import json,sys; [print(s[\"name\"]) for s in json.load(sys.stdin)[\"data\"][\"teams\"][\"nodes\"][0][\"states\"][\"nodes\"]]"
'
```

### 2.3 Move to Ready

After creating the issue in Linear, set state to `Ready`. Then confirm:

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts list-ready --project-key nanoclaw
# Expected: your issue appears
```

---

## Phase 3: Dispatch

### 3.1 Dry Run — Validate Before Committing

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw \
  --issue-identifier <ISSUE-ID> \
  --dry-run
```

Verify in dry-run output:

- `backend: claude-code` or `codex` (matches Target Runtime)
- `agentName: <agent-name>` (present if Agent field was set)
- `workspacePath` is under `SymphonyWorkspace/nanoclaw/<ISSUE-ID>`
- `PROMPT.md` content looks correct

If dry-run errors: read the error message — it will name exactly which validation failed.

### 3.2 Method A: Daemon Auto-Pickup (preferred for true end-to-end test)

Triggers Symphony to pick up from Linear exactly as it would in production:

```bash
# Via MCP tool
mcp__symphony__symphony_reconcile_once  { "auto_dispatch": true }
```

Expected: `readyCounts: { nanoclaw: 1 }`, then `npm run symphony:status` shows `activeRunIds` populated.

### 3.3 Method B: Manual Dispatch

```bash
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw \
  --issue-identifier <ISSUE-ID>
```

Expected: `action: dispatched`, `pid: <number>`

Note: `fatal: '<branch>' is already used by worktree` warning may appear — non-fatal, dispatch continues.

Check Linear: issue should move to `In Progress` within seconds.

---

## Phase 4: Monitor Execution

### 4.1 Key Facts About Agent Output

- **`run.log` is empty during the entire run** — Claude Code buffers all output internally and flushes only at exit. Do not rely on it for live progress.
- **Worktree must be at** `SymphonyWorkspace/nanoclaw/<ISSUE-ID>` — any other path is a bug.
- **Process spawns 2–3 procs**: shell wrapper + claude child. Use agent name grep, not pid.

### 4.2 Confirm Process Running

```bash
ps aux | grep "nightly-improvement-researcher" | grep -v grep | wc -l
# Expected: 2 or 3
```

### 4.3 Live Tool Activity (Session JSONL)

The session JSONL is the only way to see what the agent is doing mid-run:

```bash
# Find the active session file (path encodes the workspace)
ls -t ~/.claude/projects/-Users-gurusharan-Documents-remote-claude-SymphonyWorkspace-nanoclaw-<ISSUE-ID>/*.jsonl | head -1

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

### 4.4 Set Up a Monitor Loop (Haiku subagent — recommended)

For hands-off monitoring, schedule a recurring Haiku subagent via `CronCreate`:

```text
Interval: */2 * * * *  (every 2 minutes)
Prompt:
  Use Agent tool (subagent_type=general-purpose, model=haiku).
  Run in parallel:
    1. ps aux | grep "<agent-name>" | grep -v grep | wc -l
    2. mcp__symphony__symphony_list_runs (project_key=nanoclaw, limit=1)
    3. tail session JSONL → extract last tool_use name + input[:60]
  Report compact table: Symphony status | Process alive/dead | Last tool | Run ID
  If status in [done,blocked,failed,canceled] or process=dead:
    Call CronList to find this job's ID, then call CronDelete to self-terminate.
```

Why Haiku: ~68K tokens per tick, ~5s, ~20x cheaper than Sonnet. 3 parallel tool calls per check.

**Stop conditions** (in priority order):

| Condition | Action |
|-----------|--------|
| Symphony status = done/blocked/failed/canceled | Monitor calls CronDelete on itself |
| Process count = 0 | Monitor calls CronDelete on itself |
| Manual stop | `CronDelete <job-id>` |
| Hard limit | 3-day auto-expire |

Cancel manually: `CronDelete <job-id>` (job ID returned by CronCreate).

---

## Phase 5: Validate Output

Run these after `RUN_EXIT.json` appears in the workspace.

### 5.1 Exit Code

```bash
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/RUN_EXIT.json
# Expected: { "code": 0, "finishedAt": "..." }
# Non-zero = agent crashed — read run.log
```

### 5.2 Symphony Run Status

```bash
npm run symphony:status
# Expected: lastRunStatus: done (or blocked)
```

If still `running` after exit file appeared, tick reconcile manually:

```bash
mcp__symphony__symphony_reconcile_once  {}
```

### 5.3 Linear Issue State

Issue should be `Done`. If still `In Progress`: agent didn't call `symphony_mark_run_status`. See failure modes.

### 5.4 Workspace Contents

```bash
ls /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/
```

Every workspace should have:

| File | Required | Purpose |
|------|----------|---------|
| `PROMPT.md` | Yes | Symphony-generated prompt |
| `RUN.json` | Yes | Run manifest |
| `RUN_EXIT.json` | Yes (after run) | Exit code |
| `run.log` | Yes | Full agent output |
| `.mcp.json` | Yes | Symphony MCP config |

Workflow-specific outputs (defined by the issue's Required Evidence) should also be present.

---

## Phase 6: Notion Handoff Validation

### 6.1 What Belongs in Notion

The agent should write to Notion **only** information that downstream agents need to continue the work. Not logs, not progress dumps — only decisions and context that would otherwise be lost.

**Write to Notion when:**

| Signal | What to write |
|--------|--------------|
| A decision was made that affects future runs | Decision + evidence + rationale |
| An experiment produced a result | Branch URL + metrics + recommendation |
| A blocker was hit | Blocker description + what was tried + suggested next step |
| A candidate was deferred | Why deferred + what to check next time |

**Do NOT write to Notion:**

- Step-by-step execution logs (that's what `run.log` is for)
- Interim progress ("step 2 of 5 complete")
- Information already in Linear or GitHub
- Anything not relevant to the agent doing the next run

### 6.2 Validate Notion Page Was Written

Search Notion for the page the agent was expected to create or update:

```bash
# Agent should have output the page URL in run.log
grep -i "notion\|https://www.notion.so" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/run.log
```

Open the page. Verify it contains:

- [ ] Handoff metadata: `Agent:`, `Run:`, `Date:`, `Status: done|blocked`
- [ ] Decisions made (with evidence, not just conclusions)
- [ ] What to pick up next (explicit `Next:` or `To:` field)
- [ ] Any output artifacts (branch URLs, file paths, PR links)
- [ ] Blocker description if run was blocked

### 6.3 Validate Handoff Quality

Read the Notion page as if you are the downstream agent. Ask:

- Can I continue the work from this page alone, without reading the full run log?
- Are the decisions traceable (is there evidence for each conclusion)?
- Is there anything in this page that only makes sense to the agent that wrote it?

If the answer to the last question is yes → page has noise. The agent over-wrote.

---

## Phase 7: Protocol Compliance

Inspect `run.log` to verify the agent followed its own CLAUDE.md protocol.

### 7.1 Scope Compliance

```bash
# Agent should not have opened PRs, created issues, or edited tracked files
grep -E "createIssue|openPR|issueCreate|git push main|git commit" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/run.log
# Expected: empty (unless the workflow explicitly allows these)
```

### 7.2 Run Completion

```bash
grep -E "symphony_mark_run_status|mark_run_status" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/run.log
# Expected: present, with status "done" or "blocked"
```

### 7.3 MCP Tool Usage

```bash
# Verify agent used the right tools for the task (not just Bash for everything)
grep -E "mcp__|Tool:" \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/run.log | sort | uniq -c | sort -rn
```

---

## Phase 8: Cleanup

```bash
# Archive run records
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts archive-runs --project-key nanoclaw

# Remove worktree
git worktree remove --force \
  /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>
git worktree prune

# Cancel test issue in Linear (prevents re-dispatch)
# Set state to Cancelled in Linear UI
```

---

## Common Failure Modes

### Issue Not Picked Up by Symphony

**Cause**: Missing section, wrong work class, or not in Ready state.

```bash
# Dry-run will show exact error
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts dispatch-once \
  --project-key nanoclaw --issue-identifier <ISSUE-ID> --dry-run 2>&1
```

Common mistakes:

| Mistake | Fix |
|---------|-----|
| `Work Class: research` | Change to `nanoclaw-core` |
| `Work Class: governance` | Change to `nanoclaw-core` |
| Missing `Blocked If` section | Add it |
| Issue in wrong project | Move to nanoclaw project in Linear |

### Wrong Agent Invoked (or No Agent)

**Symptom**: Agent runs but ignores workflow protocol.

```bash
grep NANOCLAW_SYMPHONY_CLAUDE_CODE_COMMAND .env
# Must contain {agent} placeholder
```

Verify `Agent:` field is in the issue's `Symphony Routing` section.

### MCP Tools Unavailable

**Symptom**: Agent can't call `symphony_mark_run_status` or Notion tools.

```bash
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/.mcp.json
# Must have symphony server
```

Notion and Linear are OAuth plugins — they don't appear in `.mcp.json` but are available automatically.

### Process Dead but Symphony Still Shows Running

**Cause**: Symphony reconcile hasn't ticked since process exited. The exit file tells the truth.

```bash
# Check exit file
cat /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>/RUN_EXIT.json
# {"code": 0, ...} = success; non-zero = crashed

# Sync Symphony state
mcp__symphony__symphony_reconcile_once  {}
```

### Worktree Created at Wrong Path

**This is a bug.** Worktree must always be under `SymphonyWorkspace/nanoclaw/<ISSUE-ID>`.

```bash
grep SYMPHONY_WORKSPACE_BASE .env
# Must be: NANOCLAW_SYMPHONY_WORKSPACE_BASE=/Users/gurusharan/Documents/remote-claude/SymphonyWorkspace
```

Fix: correct `.env`, remove stale worktree, re-dispatch.

### Issue Stays In Progress After Run

**Cause**: Agent didn't call `symphony_mark_run_status` before exiting.

```bash
# Manual fix
bash scripts/workflow/run-with-env.sh npx tsx scripts/workflow/symphony.ts mark-run-status \
  --run-id symphony-<ISSUE-ID>-YYYY --status done
# Then manually set issue to Done in Linear
```

### Worktree Already Exists

```bash
git worktree list
git worktree remove --force /Users/gurusharan/Documents/remote-claude/SymphonyWorkspace/nanoclaw/<ISSUE-ID>
git worktree prune
```

### Agent Exceeds maxTurns

Check `maxTurns` in the agent's `.claude/agents/<agent-name>.md`. Increase if workflow is legitimately long, or add prioritization to reduce work per run.

---

## Full Checklist

```
PRE-FLIGHT
- [ ] Symphony daemon healthy
- [ ] Linear connectivity works
- [ ] Notion connectivity works
- [ ] Claude CLI in PATH
- [ ] No stale worktree for this issue

ISSUE
- [ ] All 7 required sections present
- [ ] Execution Lane: symphony
- [ ] Work Class: nanoclaw-core or downstream-project
- [ ] Agent: <name> (if claude-code)
- [ ] Issue in Ready state
- [ ] Issue appears in list-ready

DISPATCH
- [ ] Dry-run shows correct backend + agent
- [ ] Daemon reconcile (auto_dispatch=true) or manual dispatch returns pid
- [ ] Linear moves to In Progress

MONITORING
- [ ] Process alive (ps aux | grep <agent-name> | wc -l > 0)
- [ ] Worktree at SymphonyWorkspace/nanoclaw/<ISSUE-ID> — wrong path = bug
- [ ] Session JSONL shows tool activity (run.log empty during run is normal)
- [ ] Haiku monitor loop running (CronCreate every 2m, self-terminates on completion)

OUTPUT
- [ ] RUN_EXIT.json: code 0
- [ ] Symphony status: done
- [ ] Linear: Done
- [ ] Required Evidence items present in workspace

NOTION HANDOFF
- [ ] Page created/updated (URL in run.log)
- [ ] Contains decisions with evidence (not just conclusions)
- [ ] Contains explicit Next/To field for downstream agent
- [ ] Contains artifact URLs (branches, PRs, files)
- [ ] Does NOT contain execution logs or interim progress
- [ ] A downstream agent could continue from this page alone

PROTOCOL
- [ ] No out-of-scope mutations (PRs, issues, tracked file edits)
- [ ] symphony_mark_run_status called at end
- [ ] Correct MCP tools used (not raw bash for everything)

CLEANUP
- [ ] Run archived
- [ ] Worktree removed
- [ ] Test issue cancelled
```
