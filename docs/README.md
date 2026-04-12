# Docs Landing

Curated landing page for the repository docs.

Use this file to find the right starting point quickly.
Use [`DOCS.md`](../DOCS.md) for the full inventory.

## Control Owner

Owner for:
- `docs/README.md` guidance, decisions, and maintenance in this document

Should not contain:
- policy, workflow detail, or implementation behavior that belongs in a more specific owner doc, skill, or enforcement surface

## Folder Layout

```text
docs/
  architecture/     # system architecture and design rationale
  workflow/
    control-plane/  # Linear sweep, collaboration-surface, lane-routing, Symphony contracts
    delivery/       # delivery loops, gates, and cross-tool execution
    runtime/        # runtime contracts, incident/debug loops, recall
    github/         # GitHub delivery governance and offload boundaries
    strategy/       # optimization cadence and research distillations
  operations/       # role authority and change-management matrix
  tools/            # tool-specific usage maps and best-practice routing
  reference/        # baseline requirements/spec/security documents
  troubleshooting/  # debug playbooks and platform-specific fixes
  research/         # workflow research intake and weekly optimization evidence
```

## Start Here

- Mission and operating intent: `docs/MISSION.md`
- Core-vs-extension ownership contract: `docs/ARCHITECTURE.md`
- Core architecture: `docs/architecture/nanoclaw-system-architecture.md`
- Jarvis architecture and delegation model: `docs/architecture/nanoclaw-jarvis.md`
- Docs governance: `.claude/rules/docs-governance.md` (auto-loaded rule)
- Token-efficient MCP usage: `docs/tools/token-efficient-mcp-usage.md`
- Default delivery workflow: `docs/workflow/delivery/nanoclaw-development-loop.md`
- WhatsApp-first system proving plan: `docs/workflow/strategy/launchdeck-proving-program.md`
- Runtime and incident debugging: `docs/workflow/runtime/nanoclaw-jarvis-debug-loop.md`
- Worker contract and runtime: `docs/workflow/runtime/nanoclaw-jarvis-dispatch-contract.md` + `docs/workflow/runtime/nanoclaw-jarvis-worker-runtime.md`
- GitHub delivery governance: `docs/workflow/github/github-delivery-governance.md`
- Control-plane contracts: `docs/workflow/control-plane/collaboration-surface-contract.md` + `docs/workflow/control-plane/execution-lane-routing-contract.md`
- Session recall: `docs/workflow/runtime/session-recall.md`
- Cross-tool Claude/Codex execution: `docs/workflow/delivery/unified-codex-claude-loop.md`
- Research artifacts: `docs/research/research-index.md`

## Deep References

- Architecture deep dives: `docs/architecture/agent-compression.md`, `docs/architecture/architecture-audit.md`, `docs/architecture/harness-engineering-alignment.md`, `docs/architecture/mission-runtime-profiles.md`, `docs/architecture/nanoclaw-architecture-optimization-plan.md`
- Session and delivery operators: `docs/workflow/control-plane/session-work-sweep.md`, `docs/workflow/delivery/claude-cli-resume-consult-lane.md`, `docs/workflow/runtime/jarvis-dispatch-contract-discipline.md`, `docs/workflow/runtime/nanoclaw-start-runbook.md`
- Troubleshooting references: `docs/troubleshooting/AUTONOMOUS-LOOP-CRITERIA.md`, `docs/troubleshooting/SYMPHONY-NIGHTLY-FLOW.md`, `docs/troubleshooting/SYMPHONY-WORKFLOW-TESTING-TEMPLATE.md`

## Common Entrypoints

```bash
bash scripts/workflow/session-start.sh --agent codex
bash scripts/qmd-context-recall.sh --bootstrap
bash scripts/workflow/preflight.sh
bash scripts/jarvis-ops.sh acceptance-gate
bash scripts/check-workflow-contracts.sh
```

## Authority

- `CLAUDE.md` is the compressed trigger index used by runtime agents.
- `docs/README.md` is the curated landing page.
- `DOCS.md` is the full documentation inventory.
