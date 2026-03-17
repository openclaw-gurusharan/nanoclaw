# NanoClaw Documentation Map

Canonical classification for repository docs.

## Root Docs

- `README.md`: product overview, setup, philosophy
- `CLAUDE.md`: compressed trigger index for agent runtime behavior
- `DOCS.md`: top-level documentation classification (this file)
- `docs/README.md`: curated landing page for `docs/`
- `docs/ARCHITECTURE.md`: hard core-vs-extension boundary contract for agents and maintainers
- `docs/MISSION.md`: mission statement and operating profile intent
- `docs/CHANGELOG.md`: active changelog for current documentation era

## `docs/architecture/`

- `docs/architecture/nanoclaw-system-architecture.md`: canonical system architecture and runtime tiers
- `docs/architecture/nanoclaw-jarvis.md`: Jarvis-on-NanoClaw architecture, delegation model, lifecycle
- `docs/architecture/harness-engineering-alignment.md`: harness-engineering principles mapped to this repo
- `docs/architecture/nanoclaw-architecture-optimization-plan.md`: prioritized Apple-Container-first optimization backlog (`P0`/`P1`/`P2`) with expected benefits
- `docs/architecture/architecture-audit.md`: architecture audit findings and recommendations
- `docs/architecture/mission-runtime-profiles.md`: mission-core vs ops-extended runtime profiles and feature-gate boundaries

## `docs/workflow/`

Workflow docs are physically grouped by operational concern.

### `docs/workflow/control-plane/`

- `docs/workflow/control-plane/collaboration-surface-contract.md`: canonical Linear/Notion/GitHub/repo separation-of-concern contract
- `docs/workflow/control-plane/custom-symphony-orchestration-contract.md`: custom Symphony registry, backend routing, and project enablement contract
- `docs/workflow/control-plane/execution-lane-routing-contract.md`: canonical NanoClaw-vs-downstream lane routing and Symphony scope contract
- `docs/workflow/control-plane/project-bootstrap-and-secret-contract.md`: canonical project onboarding and universal secret-scope contract
- `docs/workflow/control-plane/session-work-sweep.md`: session-start Linear sweep protocol and morning handoff contract
- `docs/workflow/control-plane/symphony-operations-runbook.md`: operator runbook for Symphony registry sync, queue inspection, dispatch, daemon, and dashboard handling

### `docs/workflow/delivery/`

- `docs/workflow/delivery/nanoclaw-development-loop.md`: default feature/bug/reliability delivery loop
- `docs/workflow/delivery/unified-codex-claude-loop.md`: cross-tool anti-slop execution loop shared by Claude and Codex
- `docs/workflow/delivery/nanoclaw-jarvis-acceptance-checklist.md`: acceptance and smoke validation gates
- `docs/workflow/delivery/nanoclaw-andy-user-happiness-gate.md`: user-facing reliability sign-off protocol
- `docs/workflow/delivery/claude-cli-resume-consult-lane.md`: scoped Claude CLI consult lane guidance
- `docs/workflow/delivery/platform-claude-pickup-lane.md`: Linear-driven NanoClaw platform pickup automation lane

### `docs/workflow/runtime/`

- `docs/workflow/runtime/nanoclaw-jarvis-dispatch-contract.md`: strict dispatch/completion contract
- `docs/workflow/runtime/jarvis-dispatch-contract-discipline.md`: edit protocol and verification for dispatch contract changes
- `docs/workflow/runtime/nanoclaw-jarvis-worker-runtime.md`: worker runtime, mounts, model fallback, role bundles
- `docs/workflow/runtime/nanoclaw-jarvis-debug-loop.md`: primary Jarvis runtime and incident debug loop
- `docs/workflow/runtime/nanoclaw-container-debugging.md`: container/auth/session debug workflow
- `docs/workflow/runtime/session-recall.md`: session reconstruction and handoff workflow

### `docs/workflow/github/`

- `docs/workflow/github/github-delivery-governance.md`: GitHub-only delivery governance for PRs, reviews, CI, and branch protection
- `docs/workflow/github/github-offload-boundary-loop.md`: GitHub-vs-local workflow placement policy

### Docs Governance

Consolidated into `.claude/rules/docs-governance.md` (auto-loaded rule).

### `docs/workflow/strategy/`

- `docs/workflow/strategy/workflow-optimization-loop.md`: research-to-pilot workflow optimization process and decision gates
- `docs/workflow/strategy/code-execution-mcp-pattern.md`: distilled code-execution-with-MCP research and tool selection guide
- `docs/workflow/strategy/launchdeck-proving-program.md`: LaunchDeck dogfooding plan for proving WhatsApp-first product delivery quality and trust
- `docs/workflow/strategy/launchdeck-ld01-execution-pack.md`: dispatch/review/scorecard pack for the first LaunchDeck proving slice

## `docs/operations/`

- `docs/operations/roles-classification.md`: role authority and handoff model for user shaping, Andy coordination, NanoClaw execution lanes, and downstream workers
- `docs/operations/update-requirements-matrix.md`: required doc/code update surfaces by change type
- `docs/operations/agreement-sync-protocol.md`: agreement-driven sync protocol for docs/code
- Skill-vs-docs routing: consolidated into `.claude/rules/docs-governance.md`
- `docs/operations/claude-codex-adapter-matrix.md`: mapping of workflow intents to Claude/Codex internal controls
- `docs/operations/subagent-catalog.md`: canonical subagent purpose/scope/output contracts
- `docs/operations/tooling-governance-budget.json`: deterministic budget and required coverage for hooks, subagents, and built-in tooling gates
- `docs/operations/upstream-sync-policy.md`: upstream sync operating policy
- `docs/operations/runtime-vs-prebaked-boundary.md`: runtime-local vs prebaked placement policy
- Workflow responsibility ownership: derivable from code structure and git blame

## `docs/tools/`

- `docs/tools/token-efficient-mcp-usage.md`: canonical usage map for when to default to token-efficient MCP and how to keep results small

## `docs/reference/`

- `docs/reference/REQUIREMENTS.md`: core constraints and product philosophy
- `docs/reference/SPEC.md`: baseline behavior/specification
- `docs/reference/SECURITY.md`: security model and trust boundaries

## `docs/troubleshooting/`

- `docs/troubleshooting/DEBUG_CHECKLIST.md`: debug flow for runtime/container/session failures
- `docs/troubleshooting/APPLE-CONTAINER-NETWORKING.md`: Apple container networking/build diagnostics

## `docs/research/`

- `docs/research/README.md`: index for workflow optimization research intake and weekly evidence artifacts
- `docs/research/EXPERT-WORKFLOW-RESEARCH-YYYY-MM-DD.md`: external high-signal workflow research intake
- `docs/research/WORKFLOW-ANALYSIS-YYYY-MM-DD.md`: NanoClaw-specific workflow translation and gap analysis
- `docs/research/WEEKLY-SLOP-OPTIMIZATION-YYYY-MM-DD.md`: deterministic weekly slop findings, actions, and ratchet queue

## Worker-Local Workflow Docs

- `groups/jarvis-worker-*/docs/workflow/execution-loop.md`
- `groups/jarvis-worker-*/docs/workflow/worker-skill-policy.md`
- `groups/jarvis-worker-*/docs/workflow/git-pr-workflow.md`
- `groups/jarvis-worker-*/docs/workflow/github-account-isolation.md`

## Runtime Rules

- `container/rules/andy-bot-operating-rule.md`
- `container/rules/andy-developer-operating-rule.md`
- `container/rules/jarvis-worker-operating-rule.md`
- `.claude/rules/nanoclaw-jarvis-debug-loop.md`
- `.claude/rules/jarvis-dispatch-contract-discipline.md`
- `.claude/rules/docs-governance.md`

## Maintenance Rule

When docs are added, moved, or removed:

1. Update `DOCS.md`.
2. Update `docs/README.md`.
3. Update root trigger links in `CLAUDE.md` if any trigger paths changed.
4. Keep `README.md` pointer to `DOCS.md` intact.

`docs/README.md` should stay curated.
Exhaustive inventories belong in `DOCS.md`, not in the landing page.
