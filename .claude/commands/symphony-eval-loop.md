---
description: Symphony Review Evaluator — alternating nanoclaw ↔ nanoclaw-test loop with Linear journal logging.
allowed-tools: mcp__symphony__linear_graphql,mcp__symphony__symphony_list_runs,mcp__symphony__symphony_get_run_log,mcp__symphony__symphony_list_ready_issues,mcp__symphony__symphony_reconcile_once,mcp__symphony__symphony_mark_run_status,mcp__token-efficient__process_logs,Read,Write,Bash
---

Symphony Review Evaluator — alternating nanoclaw ↔ nanoclaw-test loop.

## PRE-FLIGHT — MCP Availability

Verify `mcp__symphony__linear_graphql` is callable. If not available:

1. Check if `symphony:mcp` is running: `ps aux | grep symphony-mcp | grep -v grep`
   - Not running → start: `cd /Users/gurusharan/Documents/remote-claude/Codex/jarvis-mac/nanoclaw && npm run symphony:mcp &` then wait 3s
   - Running but tools missing → MCP crashed; kill and restart: `pkill -f symphony-mcp && npm run symphony:mcp &`
   - Start fails → diagnose root cause (missing `.env`, build error) before retrying

> **MCP tools require session restart to reconnect** — if `mcp__symphony__*` is missing from the tool list entirely, bash restarts won't help. Tell the user to restart the Claude Code session.
> **`symphony:serve` ≠ `symphony:mcp`** — serve is the HTTP dashboard only, not MCP tools.

## Constants

- nanoclaw journal issue ID: c6297367-f6b6-4fcd-b954-5651473002d0 (NAN-52)
- nanoclaw-test journal issue ID: a23ad3da-ba84-43b9-aaa8-48a2842e84d1 (NAN-53)
- Team ID: cc0d4b1e-7e26-4769-9a83-019d8b67c07c
- In Review stateId: e77514cb-e499-483a-91ea-93b52c298447
- Ready stateId: 7b626c01-8a33-483e-b117-d36df22a6e29
- Done stateId: 0d071400-33d8-4728-bcb5-f5a9685e1d2d

## State File

Path: `/Users/gurusharan/Documents/remote-claude/Codex/jarvis-mac/nanoclaw/.nanoclaw/symphony/eval-loop-state.json`
Initialize if missing: `{"lastActivated":"nanoclaw-test","turn":0,"updatedAt":null}`

---

## STEP 1 — Read State

Read state file.

- EVALUATE = `lastActivated`
- ACTIVATE = the other project (nanoclaw ↔ nanoclaw-test)

## STEP 2 — Evaluate EVALUATE project

Query Linear for issues in "In Review" state for EVALUATE project (limit 3, orderBy updatedAt).

- **No "In Review" issue** → runVerdict = "skipped", skip to STEP 3.
- **Duplicate guard**: if identifier matches `lastEvaluated` in state file → skip (already evaluated), runVerdict = "skipped".
- **Found**: fetch full issue, then `symphony_list_runs {project_key, limit:5}` — pick the most recent run matching the identifier (highest `startedAt`). If no run found → runVerdict = "no_run".

Evaluate against Acceptance Criteria in the issue description:

- `symphony_get_run_log` → `process_logs` with pattern `"PASS|FAIL|ERROR|exit|check|done|completed"`
- Per criterion: ✓ / ✗ / ?
- runVerdict = PASS (all ✓) / PARTIAL (mix) / FAIL (any ✗ on Required Checks)

Post comment on the evaluated issue:

```
## Symphony Evaluation — Turn <N>
**Run**: <PASS|PARTIAL|FAIL|no_run> | **Exit**: <0/non-0>

### Acceptance Criteria
- [✓/✗/?] <criterion>

### Evidence
- Run: <runId> | Key output: <2-3 lines>

**Confidence**: High/Medium/Low
```

Move issue to Done stateId if runVerdict = PASS.

**Triage Blocked issues** (query separately, limit 3):

- For each: fetch most recent run, check error field.
- If error is a one-time process crash: post comment + move back to Ready.
- If same issue has been Blocked 2+ times: leave for human review, post comment noting repeated failure.

NEVER call `symphony_dispatch_once` or use `dry_run`. Only move issues to Ready state to trigger Symphony.

## STEP 3 — Activate ACTIVATE project

Check if ACTIVATE project already has an issue "In Progress" or "In Review": query Linear for those states. If yes → skip activation (something is already running or awaiting eval).

If no active issue: `symphony_list_ready_issues {project_key: ACTIVATE}`.

- ≥1 ready → skip (already queued).
- 0 ready → find next Todo/Backlog (first: 3, orderBy: updatedAt, filter priority: { neq: 0 }; retry without priority filter if empty). Skip issues titled with "[Eval Loop]".

**Before moving to Ready**: verify all 7 Symphony sections present and non-placeholder — Symphony silently skips malformed issues, wasting a dispatch cycle.

- nanoclaw work issues → `.claude/skills/linear/references/issue-template-work.md`
- NanoClaw Test issues → `.claude/skills/linear/references/issue-template-test.md`

Move to Ready, then call `symphony_reconcile_once {auto_dispatch: false}`.

## STEP 4 — Update State File

```json
{"lastActivated":"<ACTIVATE>","lastEvaluated":"<identifier|null>","runVerdict":"<verdict>","turn":<N+1>,"updatedAt":"<ISO>"}
```

## STEP 5 — Journal Post

Post to journal issue for EVALUATE project (NAN-52 for nanoclaw, NAN-53 for nanoclaw-test):

```
## Turn <N> | <ISO timestamp>
**Evaluated**: <identifier> — <title> | Run: <PASS|PARTIAL|FAIL|skipped>
**Activated**: <identifier> — <title> (ACTIVATE) | already active: <yes/no>
**Blocked triaged**: <count or "none">
```

Also post the activation line to the ACTIVATE project's journal so each journal is self-contained.

## Token Rules

- `process_logs` with pattern — never load raw log
- Linear: narrow queries only (request only fields you need)
- Target: under 8K tokens per run
