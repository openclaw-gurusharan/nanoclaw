# Docs Landing

Curated landing page for the repository docs.

Use this file to find the right starting point quickly.
Use [`DOCS.md`](../DOCS.md) for the full inventory.

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
- Control-plane contracts: `docs/workflow/control-plane/`
- Session recall: `docs/workflow/runtime/session-recall.md`
- Cross-tool Claude/Codex execution: `docs/workflow/delivery/unified-codex-claude-loop.md`
- Research artifacts: `docs/research/README.md`

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
