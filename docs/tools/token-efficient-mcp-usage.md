# Token-Efficient MCP Usage

## Purpose

Provide the canonical routing guide for when and how to use the token-efficient MCP server to preserve Codex context.

## Doc Type

`map`

## Canonical Owner

This doc owns token-efficient MCP usage guidance for Codex work in this repo. It must not duplicate general skill-routing policy from `docs/workflow/docs-discipline/skill-routing-preflight.md` or the strategy rationale in `docs/workflow/strategy/code-execution-mcp-pattern.md`.

## Use When

- Choosing between token-efficient MCP, raw shell output, or other built-in tools.
- Handling logs, CSV data, or scripts that would otherwise emit large stdout into chat context.
- Teaching or reviewing Codex workflows where context preservation matters.

## Do Not Use When

- Defining general MCP routing policy. Use `docs/workflow/docs-discipline/skill-routing-preflight.md`.
- Recording why the code-execution MCP pattern is strategically valid. Use `docs/workflow/strategy/code-execution-mcp-pattern.md`.
- Describing core product/runtime architecture. Use `docs/ARCHITECTURE.md` or `docs/reference/SPEC.md`.

## Verification

- Live MCP interface checks in Codex:
  - `mcp__token-efficient__execute_code`
  - `mcp__token-efficient__process_csv`
  - `mcp__token-efficient__process_logs`
- Server regression suite:
  - `cd /Users/gurusharan/Documents/remote-claude/mcp-servers/token-efficient-mcp && npm test`
- Docs hygiene:
  - `bash scripts/check-workflow-contracts.sh`
  - `bash scripts/check-claude-codex-mirror.sh`
  - `bash scripts/check-tooling-governance.sh`
  - `bash scripts/check-docs-hygiene.sh`

## Related Docs

- `docs/workflow/docs-discipline/skill-routing-preflight.md`
- `docs/workflow/strategy/code-execution-mcp-pattern.md`
- `docs/operations/skills-vs-docs-map.md`

## Linear API Reads

Use `mcp__symphony__linear_graphql` for all Linear reads and writes. It is the single canonical Linear access path — no REST API calls, no OAuth plugin.

**Rule: request only the fields you need. Never fetch full payloads for scanning.**

| Task | Query shape |
|------|-------------|
| Triage: list Ready issues | `identifier title state { name }` — omit description |
| Check Symphony Routing section | `identifier description` for that one issue only |
| Get full issue body | `identifier title description` for one issue |
| Count issues by state | `filter` + `pageInfo { totalCount }` |
| Post comment | `commentCreate` mutation |
| Update issue state | `issueUpdate` mutation |

### Narrow read example

```
mcp__symphony__linear_graphql(
  query: "query { issues(filter: { project: { id: { eq: $project } } state: { name: { eq: \"Ready\" } } } first: 50) { nodes { identifier title state { name } } } }",
  variables: "{\"project\": \"dbf032a2-8437-41df-87cf-bcdaadff7149\"}"
)
```

Request only the fields you will actually read. Each extra field on 50 issues compounds cost.

## Decision Table

| Task shape | Default tool | Why | Do not do this first |
|-----------|--------------|-----|----------------------|
| Search or summarize a real log file | `process_logs` | Filters in the server and returns only matches, counts, and small previews | `tail`, `grep`, `cat`, or loading full logs into chat |
| Analyze CSV/TSV/semicolon-delimited data | `process_csv` | Returns schema, filtered rows, aggregates, and previews without loading the whole file | `python`, `awk`, `pandas`, or printing raw rows to chat |
| Run code or shell that may emit lots of stdout | `execute_code` | Runs inside the MCP server and enforces output caps, redaction, and spill-to-file | raw `exec_command` with verbose stdout |
| Need only a count, summary, or top matches | token-efficient MCP in `tiny` or `summary` mode | Minimizes response size and keeps context clean | `response_format: "full"` |
| Need the full result only for local follow-up | token-efficient MCP with `spill_to_file: true` | Keeps full output on disk and returns a small pointer | printing the full payload into chat |
| Search code or markdown files by filename/content | `rg`, `Glob`, or repo-native search tools | File search is not a data-reduction problem | `execute_code` running `find` or `grep` |
| Read small config or source files | targeted file reads | Small direct reads are cheaper and clearer | wrapping tiny reads in MCP for no reason |

## Ownership

| Surface | Canonical owner |
|--------|------------------|
| Tool behavior and limits | `/Users/gurusharan/Documents/remote-claude/mcp-servers/token-efficient-mcp` |
| Repo routing policy | `docs/workflow/docs-discipline/skill-routing-preflight.md` |
| Strategic rationale for MCP-first code execution | `docs/workflow/strategy/code-execution-mcp-pattern.md` |
| Codex tool-budget governance | `docs/operations/tooling-governance-budget.json` |

## Update Surfaces

- Update this doc when the token-efficient MCP tool set, defaults, or best-practice routing changes.
- Update `docs/workflow/strategy/code-execution-mcp-pattern.md` only when the strategic recommendation changes.
- Update `docs/workflow/docs-discipline/skill-routing-preflight.md` only when global routing policy changes.
- Update `docs/operations/tooling-governance-budget.json` only when required MCP coverage changes.

## Default Usage Rules

1. Treat token-efficient MCP as the default for noisy logs, CSV/data reduction, and scripts with potentially large stdout.
2. Prefer `response_format: "tiny"` first, then `summary`, and use `full` only when the smaller modes are insufficient.
3. Keep `include_metrics` off unless validating savings or debugging the MCP server itself.
4. Turn on `spill_to_file` when a result may exceed a small preview or when you only need a summary plus a saved artifact path.
5. Narrow the input before widening the output: use `pattern`, `filter_expr`, `columns`, `offset`, `limit`, and `context_lines` aggressively.
6. Use raw shell only when the task is inherently shell-native and the expected output is already tiny.

## Use Cases

- Large application logs where only `ERROR`, `WARN`, or a narrow regex matters.
- CSV exports where only a few columns, rows, groups, or summary statistics are needed.
- Diagnostic scripts that would normally print installation logs, retries, tracebacks, or intermediate progress.
- Repeated analysis loops where the model needs a verdict, counts, or a few sample rows rather than the full raw artifact.
- Context-sensitive sessions where preserving space matters more than having every intermediate line in chat history.

## Anti-Patterns

- Running `cat`, `tail -n 500`, or broad `grep` on large logs and pasting the result into the transcript.
- Using `execute_code` to do general repo search when `rg` or `Glob` is the right primitive.
- Asking for `full` output by default.
- Enabling `include_metrics` on every call.
- Using token-efficient MCP for tiny one-line commands where direct shell output is already smaller than the MCP envelope.
- Pasting raw `/context` command output into the transcript when a short audit summary or saved artifact path would answer the question.

## Best-Practice Call Shapes

### Logs

- Start with:
  - `process_logs(file_path, pattern, response_format="tiny", limit=20, context_lines=0)`
- Widen only if needed:
  - raise `limit`
  - add `context_lines`
  - use `spill_to_file=true` before switching to `full`

### CSV

- Start with:
  - `process_csv(file_path, response_format="summary", limit=20)`
- Widen only if needed:
  - add `columns`
  - add `filter_expr`
  - add `aggregate_by` and `agg_func`
  - use `spill_to_file=true` before requesting large `full` pages

### Code Execution

- Start with:
  - `execute_code(code, language, response_format="tiny", max_output_chars=1200)`
- Widen only if needed:
  - increase `max_output_chars`
  - add `working_dir`
  - use `spill_to_file=true` for verbose runs

## Exit Criteria

- The chosen tool returns only the minimum result the model needs.
- Raw logs, large tables, and verbose stdout stay out of chat history unless explicitly required.
- If a full artifact is needed, the result is saved to disk and referenced instead of pasted into context.
