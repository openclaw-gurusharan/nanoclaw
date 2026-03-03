# Session Recall Workflow

Reconstruct actionable session context quickly and reliably.

This workflow addresses two recurring new-session failures:

1. No explicit handoff (`what was done`, `what next`, `blockers`).
2. Stale session exports causing missed recall.

`qctx` solves both with a branch-aware handoff log plus stale-check sync before search.

## Quick Commands

```bash
# Session start (recommended)
qctx --bootstrap

# Session start with explicit issue
qctx --bootstrap --issue INC-123

# While working: targeted context lookup
qctx "worker connectivity dispatch"

# Force refresh if recall seems stale
qctx --force-sync "mcp startup failed qmd handshaking"

# Session end: write structured handoff
qctx --close \
  --issue INC-123 \
  --done "implemented watchdog guard" \
  --next "run verify-worker-connectivity and confirm review_requested" \
  --blocker "needs worker restart permission" \
  --commands "bash scripts/jarvis-ops.sh verify-worker-connectivity"
```

If `qctx` alias is not installed, run the same commands via:

```bash
bash scripts/qmd-context-recall.sh --bootstrap
```

## Recommended Workflow

1. Session start: run `qctx --bootstrap`.
2. During work: run `qctx "<topic>"` before major debug/fix loops.
3. If results look outdated: run `qctx --force-sync "<topic>"`.
4. Session end: run `qctx --close ...` with concrete `--next`.

## `qctx` Modes

### Bootstrap (`--bootstrap`)

- Reads latest handoff from `.claude/progress/session-handoff.jsonl`.
- Builds a query from current branch + issue + prior next step/blocker if query is omitted.
- Searches QMD sessions and prints a `Next Action` hint.
- Defaults in this mode: `--top 10`, `--fetch 3`.

### Standard Search (default)

- Uses explicit query, or current git branch if query omitted.
- Runs `qmd search ... -c sessions --files`.
- Expands top hits with `qmd get`.

### Close (`--close`)

- Writes a structured handoff JSONL entry:
  - `timestamp`, `branch`, `issue`, `state`
  - `done`, `next_step`, `blocker`
  - `commands_run`, `files_touched`
- Intended `state` values: `active`, `done`, `blocked`, `handoff`.

## Sync Behavior

When sync is enabled (`default`):

1. Detect latest source session timestamps (Claude + Codex JSONL).
2. Compare against exported Markdown sessions.
3. If stale (or `--force-sync`), run:
   - `claude-sessions export --today`
   - `claude-sessions codex-export --days 21 --output .../Obsidian/Claude-Sessions`
   - `qmd update`

Fast path options:

- `--no-sync`: skip stale check and sync.
- `--no-get`: skip `qmd get` expansion.
- `--top`, `--fetch`, `--lines`: tune output size.

## Optional `/recall` Usage

`/recall` remains useful for temporal browsing (`today`, `yesterday`, `last week`) and quick expansion via:

```bash
python3 ~/.claude/skills/recall/scripts/recall-day.py expand <session_id>
```

For active branch/issue execution, prefer `qctx` as the primary workflow.

## Manual Refresh (Fallback)

```bash
python3 ~/.claude/skills/recall/scripts/extract-sessions.py \
  --days 30 \
  --source ~/.claude/projects/-Users-gurusharan-Documents-remote-claude-Codex-jarvis-mac-nanoclaw \
  --output ~/Documents/remote-claude/Obsidian/Claude-Sessions

python3 ~/.claude/skills/recall/scripts/extract-codex-sessions.py \
  --days 30 \
  --output ~/Documents/remote-claude/Obsidian/Claude-Sessions

qmd update
# Optional for semantic workflows:
qmd embed
```

## Notes

- `qctx` is CLI-based (`qmd search` + `qmd get`) and does not depend on QMD MCP.
- Session recall searches the `sessions` collection, not source code.
- Graph-mode recall is not useful here because vault and project directories are separate.
- If branch-only lookup returns no hits, rerun with task keywords (symptom/component/command) instead of branch name alone.
