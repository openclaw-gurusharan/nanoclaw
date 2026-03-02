# AGENTS.md

## Instruction Source
- Read and follow `CLAUDE.md` as the single source of truth for repository instructions, including upstream sync policy.
- At the start of every task, load `CLAUDE.md` first, then follow its `Docs Index` trigger lines for progressive disclosure.
- Run the task-start skill/MCP routing preflight defined by `CLAUDE.md` before ad-hoc implementation/debugging.
- If `AGENTS.md` and `CLAUDE.md` ever conflict, `CLAUDE.md` wins.

## Skill Routing Mirror
- Runtime/auth/container failures route to `/debug`.
- Incident triage, recurring issue investigation, and incident lifecycle tracking route to `/incident-debugger`.
- Incident lifecycle state is tracked in `.claude/progress/incident.json` (open/resolved + notes).
- Reliability validation can use `scripts/jarvis-ops.sh verify-worker-connectivity` after `preflight`/`trace`.
- Andy user-facing reliability sign-off should follow `docs/workflow/nanoclaw-andy-user-happiness-gate.md` and run `bash scripts/jarvis-ops.sh happiness-gate`.
