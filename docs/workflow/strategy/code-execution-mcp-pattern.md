# Code Execution with MCP (Distilled)

**Source**: <https://www.anthropic.com/engineering/code-execution-with-mcp>
**Date**: 2026-03-09
**Score**: 9/12 — Adopt

## Control Owner

Owner for:
- `docs/workflow/strategy/code-execution-mcp-pattern.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## Verdict

**Rationale**: We already have the token-efficient MCP server implementing this pattern. The article validates why docs/runbooks teaching raw bash/grep is wrong and quantifies the cost at 98.7% token savings missed. One new pattern not yet implemented: progressive tool discovery via filesystem.

| Dimension | Score | Notes |
|-----------|-------|-------|
| Novelty | 1/3 | We have token-efficient MCP; progressive tool discovery pattern is new |
| Relevance | 3/3 | Directly matches our audit finding: docs teaching raw bash instead of MCP |
| Claim validity | 3/3 | 98.7% savings matches our own MCP metrics; Anthropic engineering source |
| Implementation cost | 2/3 | MCP exists; gap is enforcement in docs and Codex TOOLS-POLICY |
| **Total** | **9/12** | |

## Claims Analysis

| Claim | Agree? | Evidence | Notes |
|-------|--------|----------|-------|
| 98.7% token reduction (150k→2k) | Yes | Our execute_code shows 91% savings in session | Real, confirmed |
| Loading all tools upfront wastes context | Yes | Our docs teach `grep/tail` raw — same anti-pattern | We have this problem |
| Agents should filter data in execution env | Yes | process_logs/execute_code exist for this | Under-used |
| Progressive tool discovery via filesystem | Partial | Not implemented yet | New idea worth exploring |
| State persistence via filesystem | Yes | Our MCP already supports this | Already aligned |

## What to Take

1. **Enforcement rule**: agents MUST use `process_logs` for log files, `execute_code` for code/data — never load raw into context
2. **Codex TOOLS-POLICY**: add explicit mandate for token-efficient MCP tools (currently missing)
3. **Doc fix**: `DEBUG_CHECKLIST.md` and `nanoclaw-container-debugging.md` replace `grep/tail` commands with `process_logs` equivalents
4. **Progressive tool discovery**: explore exposing MCP tools as TypeScript files on filesystem so agents load only what they need — reduces tool definition token overhead

## What to Modify / Watch Out For

- Progressive discovery requires MCP server changes — not a drop-in
- `process_logs` fails on large structured markdown files (not true logs) — use `Grep` for those
- `execute_code` appropriate for bash/python/node, not for file search (use `Glob`/`Grep` instead)

## Correct Tool Selection (from this article + our experience)

| Task | Wrong | Right |
|------|-------|-------|
| Read `logs/nanoclaw.log` | `grep ... \| tail` | `process_logs` |
| Run Python/Node analysis | `Bash python3` | `execute_code` |
| Search markdown/code files | `execute_code grep` | `Grep` |
| Find files | `execute_code find` | `Glob` |
| Process CSV data | `Bash awk/pandas` | `process_csv` |

## Integration Notes

**Tier**: 1 (Reference)
**Sessions Used**: 1
**Promotion Status**: Pending validation — enforce in 2+ sessions before promoting to Tier 2
**Debate**: No — score ≥ 8, clear adopt
**Next action**: Add token-efficient mandate to `~/.codex/rules/TOOLS-POLICY.md` and fix `DEBUG_CHECKLIST.md`
