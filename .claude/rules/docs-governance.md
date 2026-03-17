# Docs Governance

Compressed from 5 docs-discipline files + 2 routing maps. This is the single authority for doc/trigger/skill hygiene.

## CLAUDE.md Compression Gate

Only keep content inline when ALL are true:

1. Needed in ≥80% of sessions
2. Silent failure without it
3. Fits in ≤3 lines

Everything else → `docs/` with one trigger line. Same rule applies to `groups/*/CLAUDE.md`.

## Doc Creation Gate

Before creating a new doc:

1. What gap exists that current docs don't cover?
2. Which existing doc is closest — can it absorb this?
3. What single boundary does the new doc own?
4. What breaks without it?

If answers 2 or 4 are weak, extend existing doc instead.

## Doc Types

| Type | Purpose |
|------|---------|
| `contract` | Requirements, invariants, validation, exit criteria |
| `workflow-loop` | End-to-end execution flow for recurring tasks |
| `runbook` | Debug/ops for a specific symptom family |

## Pruning

- One canonical doc per topic. Delete superseded/duplicate docs.
- When docs change: update `DOCS.md`, update CLAUDE.md triggers, remove stale references.

## Skill vs Doc Routing

- **Skills** = execution workflows (how to perform repeatable tasks)
- **Docs** = source-of-truth contracts (what must remain true)
- Load required docs first (invariants), then execute via matching skill.
- Skills reference scripts, don't duplicate them.
- Use MCP tools first when a built-in route already matches the task before adding bespoke shell or script paths.
- Built-in MCP defaults that must stay routable in docs and prompts: `token-efficient` for large logs/data reduction, `chrome-devtools` for browser validation, `context7` for library docs, and `deepwiki` for repository architecture/Q&A.

## Trigger Line Rules

- One trigger = one action
- No narrative in Docs Index
- A new doc adds at most one trigger line
- Group related triggers (all worker changes → single trigger pointing to `docs/workflow/runtime/`)

## Lane Governance Sync

When editing `groups/*/` governance files (`.claude/rules/`, `.claude/skills/`, CLAUDE.md):

- **Workers must stay symmetric**: any rule/skill added to worker-1 must be copied to worker-2 in the same change
- **No `container/rules/`**: this path is not auto-loaded by OpenCode. Use `.claude/rules/` instead
- **No `/home/node/.claude/rules/` triggers**: rules in `.claude/rules/` are auto-loaded, triggers are redundant and point to wrong path
- **Validate**: run `bash scripts/check-lane-governance.sh` after lane governance changes

## Container Governance Path Hierarchy

Inside a container, OpenCode auto-loads from these paths (no triggers needed):

| Path (in container) | Host source | Auto-loaded? |
|---------------------|-------------|--------------|
| `/workspace/group/CLAUDE.md` | `groups/<folder>/CLAUDE.md` | Yes |
| `/workspace/group/.claude/rules/*.md` | `groups/<folder>/.claude/rules/` | Yes |
| `/workspace/group/.claude/skills/*/SKILL.md` | `groups/<folder>/.claude/skills/` | Yes |
| `/workspace/group/docs/` | `groups/<folder>/docs/` | No — via Docs Index triggers |
| `/home/node/.claude/skills/` | `container/skills/` (synced at startup) | Yes |
| `/workspace/global/CLAUDE.md` | `groups/global/CLAUDE.md` | Yes (via env var) |

**Dead paths** (do NOT use): `container/rules/`, `/home/node/.claude/rules/`

**Git tracking**: `.gitignore` tracks `CLAUDE.md`, `docs/`, `.claude/rules/`, `.claude/skills/` per group. Runtime artifacts (hooks, progress, reports, scripts, settings) are gitignored.

## CI Sync Rule

CI scripts (`scripts/check-workflow-contracts.sh`, `scripts/check-claude-codex-mirror.sh`) validate doc existence and trigger references. When these checks go stale:

- **Fix the CI script**, not the content it checks. Never add content back just to pass a stale check.
- When compressing CLAUDE.md: remove the corresponding trigger check from the CI script in the same change.
- When deleting a doc moved to a skill: remove the file existence check from the CI script in the same change.
