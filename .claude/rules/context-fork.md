# Context Fork Rule

**When to use `context: fork`**

Use `context: fork` for heavy skills that would pollute the main conversation context with long instructions.

## Use When

- Skill has >50 lines of detailed instructions
- Skill runs multiple subprocesses or scripts
- Skill involves extensive file searches or glob operations
- Skill may run for extended periods
- Result should return to main conversation cleanly

## Do Not Use When

- Skill is lightweight (<20 lines)
- Skill is frequently invoked for quick operations
- Skill needs direct access to main conversation context
- Skill is a simple wrapper around a single tool
- Failure observability is critical (forked context may reduce visibility)

## Pilot Skills

These repo-local skills use `context: fork`:

| Skill | Reason |
|-------|--------|
| `customize` | Heavy workflow with multiple phases, feature tracking, file operations |
| `nanoclaw-orchestrator` | Complex pipeline with multiple subprocess calls |
| `nanoclaw-implementation` | Extensive touch-set discipline and verification scripts |

## Observability

When using `context: fork`:

1. Always capture explicit evidence before returning
2. Report exit codes and key outputs to main conversation
3. Log failures with full context before the subagent exits

## Format

```yaml
---
name: <skill-name>
description: <description>
context: fork
agent: general-purpose
---
```
