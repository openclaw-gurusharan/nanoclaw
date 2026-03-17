---
name: nightly-improvement
description: |
  Nightly upstream/tooling evaluation workflow. Use when changing overnight
  research cadence, scan scope, or morning Codex handoff.
  Do NOT use for daytime implementation work.
---

# Nightly Improvement

Token-efficient overnight research lane for upstream NanoClaw changes and tool changelog changes.

## Scope

Nightly v1 covers:

1. Upstream NanoClaw changes from `qwibitai/nanoclaw`
2. Codex release/tag changes
3. Codex Agent SDK release/tag changes
4. OpenCode release/tag changes

This lane does NOT implement code, approve `Ready`, move execution state, or open PRs.

## Scan Commands

```bash
# Run scan
node scripts/workflow/nightly-improvement.js scan --output /tmp/nightly-scan.json

# Force scan (ignores cursor)
node scripts/workflow/nightly-improvement.js scan --force --output /tmp/nightly-scan.json

# Record processed cursors
node scripts/workflow/nightly-improvement.js record --scan-file /tmp/nightly-scan.json
```

## Research MCP Tools

| Tool | Use For |
|------|---------|
| `deepwiki` | Repository architecture/Q&A |
| `context7` | Library/framework usage docs |
| `exa` | Web search with live crawl |
| token-efficient MCP | Large changelog/log reduction |

## State Contract

Runtime-local state: `.nanoclaw/nightly-improvement/state.json`

| Field | Purpose |
|-------|---------|
| `last_run_at` | Timestamp of last run |
| `last_upstream_sha` | Deduplication cursor for upstream |
| `tool_versions` | Deduplication cursor for tools |
| `evaluated_keys` | Repeat-research guard |

## Nightly Flow

1. `launchd` invokes `scripts/workflow/start-nightly-improvement.sh`
2. Launcher syncs dedicated nightly worktree
3. Runs scan → if noop, stops without invoking Codex
4. If evaluation needed: `Codex -p --agent nightly-improvement-researcher --model sonnet`
5. Agent reads scan, updates shared-context pages for pending source families
6. Agent records processed cursor keys with `record`
7. Launcher writes run log under `.nanoclaw/nightly-improvement/runs/`

## Research Quality Gate

Each source family update must prove:

1. **Net-new check**: What changed since last cursor
2. **Prior-art check**: Already researched or exists locally?
3. **Doc coverage**: Read usage/implementation docs before recommending
4. **MCP/tool coverage**: Use deepwiki/context7 when they improve evidence quality
5. **NanoClaw fit**: Subsystem fit assessment

## Shared Context Template

```markdown
## Nightly Update

Source Family: <upstream|tooling>
Net-New: <commit range or version delta>

### Evidence Used
- Changelog: <link>
- Implementation docs: <link>
- MCP support: <deepwiki|context7|none>

### NanoClaw Fit
- Subsystem: <codex|Codex|andy-developer|jarvis-worker-*|shared>
- Candidate: <adopt|pilot|defer|reject>
- Priority: <P1|P2|P3>

### Morning Codex Ask
- Next question or bounded execution candidate
```

Decision updates: `Agent Label: Codex`, `Decision: pilot|defer|reject`, `To: Codex`, `Status: needs-input`.

## Morning Codex Contract

`work-sweep.sh --agent codex` surfaces `NIGHTLY CONTEXT HANDOFFS`.

Codex should:

1. Review surfaced nightly context pages during morning triage
2. Decide: `promote`, `ready`, `defer`, or `reject`
3. Promote only when next action is concrete enough for execution Issue

Promote only when: concrete next action, not already tracked, specific NanoClaw benefit, bounded acceptance target.

## Verification

```bash
node scripts/workflow/nightly-improvement.js scan --output /tmp/nightly-scan.json
bash scripts/workflow/start-nightly-improvement.sh --dry-run
bash scripts/workflow/start-morning-codex-prep.sh --dry-run
```

## Anti-Patterns

- Re-researching unchanged source every night
- Creating many context pages for one source family
- Using nightly lane to create execution issues directly
- Letting morning sweep auto-promote or auto-close findings
