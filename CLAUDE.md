# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/reference/REQUIREMENTS.md](docs/reference/REQUIREMENTS.md) for architecture decisions.

## Instruction Sync Contract

- `CLAUDE.md` is the canonical instruction source for this repository.
- `AGENTS.md` is a mirror/bridge for Codex and must remain fully aligned with this file.
- `docs/README.md` is the landing page for curated start points; `DOCS.md` is the full inventory.
- Codex task preflight: read this file first, then load only the docs referenced by relevant `Docs Index` trigger lines.
- Any policy/process change here must be reflected in `AGENTS.md` in the same change.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

NanoClaw baseline is the default. Jarvis docs apply only when working on the `jarvis-worker-*` execution tier.

## Mission-Aligned Engineering Contract (Mirror)

- Ground every task in `docs/MISSION.md` and make alignment explicit in reasoning and decisions.
- Think from first principles: requirements, constraints, invariants, and tradeoffs before implementation choice.
- Operate as an expert with a clear technical opinion on the correct mission-aligned path.
- Prioritize reliability, optimization, and efficiency as core defaults.
- Use the most relevant internal skills/tools first and verify outcomes with concrete evidence.
- After task-start routing/preflight, state the selected route briefly (`intent -> skill/doc/MCP`) before deeper execution.
- If a better mission-aligned approach exists, surface it proactively and reason with the user before execution.
- Do not rely on assumptions when facts are retrievable; gather repo facts from code/docs and use DeepWiki for repository documentation when more context is required.
- When creating or modifying scripts, default to the minimum model-facing output needed for the task; verbose logs, large JSON payloads, and full artifacts must be opt-in or file-backed.
- Any issue discovered during work must be logged/updated in `.claude/progress/incident.json` via the incident workflow before closure.
- Any new feature request not already mapped must be feature-tracked and linked to authoritative execution state before implementation (`Linear` by default; local work-items only for legacy migration support).
- For GitHub CLI or remote git operations that depend on auth, branch mutation, or networked GitHub state (`gh auth`, `gh pr *`, `gh repo *`, `gh api`, `git fetch`, `git pull`, `git push`, `git merge` against remotes), request escalated execution directly instead of spending a first attempt inside the sandbox.
- For this repository, treat `origin` (`https://github.com/ingpoc/nanoclaw.git`) as the only push/PR remote. Treat `upstream` (`https://github.com/qwibitai/nanoclaw.git`) as fetch-only and never try to push there.

## Docs Index

```text
AT SESSION START → run bash scripts/workflow/session-start.sh --agent <claude|codex>
AT SESSION START, session handoff, or when changing recall/sync/export behavior → read docs/workflow/runtime/session-recall.md
DURING SESSION RECALL at end of session → evaluate friction points against docs/troubleshooting/AUTONOMOUS-LOOP-CRITERIA.md and log candidates scoring ≥15
AT TASK START after routing/preflight → state the selected route briefly (intent + first workflow/skill + MCP if relevant)
BEFORE using the collaboration sweep, changing sweep protocol, or updating agent-category affinity → load /setup skill
WHEN session start is blocked by required Linear review or triage actions from the sweep → load /setup skill
BEFORE editing root CLAUDE.md → read docs/workflow/docs-discipline/nanoclaw-root-claude-compression.md
BEFORE creating a new docs file or adding a new CLAUDE trigger → read docs/workflow/docs-discipline/doc-creation-contract.md
BEFORE adding/removing/renaming docs → read docs/workflow/docs-discipline/docs-pruning-loop.md
BEFORE task-start routing for implementation/debug/setup/update work → read docs/workflow/docs-discipline/skill-routing-preflight.md
BEFORE handling logs, CSV data, or potentially verbose script output → read docs/tools/token-efficient-mcp-usage.md
BEFORE bulk-reading Linear issues (list, triage, or scan >3 issues) → read docs/tools/token-efficient-mcp-usage.md#linear-api-reads
BEFORE single-lane feature, bug-fix, or reliability delivery → load /nanoclaw-orchestrator skill
BEFORE workflow optimization from external research → read docs/workflow/strategy/workflow-optimization-loop.md
BEFORE changing nighttime improvement evaluation, overnight research cadence, or token-budgeted upstream/tooling scanning → load /nightly-improvement skill
BEFORE weekly slop cleanup or tooling-governance review → load /weekly-cleanup skill
BEFORE running simplify/refactor work on fork customizations → load /weekly-cleanup skill (see docs/ARCHITECTURE.md for fork design)
BEFORE pushing branch to origin or creating PR → use push skill (runs validation, pre-push format autofix, creates/updates PR)
BEFORE merging PR or landing branch to main → use land skill (monitors CI, auto-fixes common failures, squash-merges)
BEFORE reviewing hooks/subagents or built-in routing budgets → read docs/operations/tooling-governance-budget.json
BEFORE split-lane Claude/Codex worktrees or review fanout → load /nanoclaw-orchestrator skill
BEFORE defining subagent fanout for plan/review/verification → read docs/operations/subagent-catalog.md and docs/operations/subagent-routing.md
BEFORE deciding Claude-vs-Codex execution adapter behavior → read docs/operations/claude-codex-adapter-matrix.md
BEFORE changing core orchestrator/channel/IPC/scheduler behavior → read docs/reference/REQUIREMENTS.md, docs/reference/SPEC.md, docs/reference/SECURITY.md
BEFORE changing core-vs-extension ownership or adding Jarvis-specific logic to shared runtime files → read docs/ARCHITECTURE.md
BEFORE changing high-level orchestration methodology → read docs/architecture/harness-engineering-alignment.md
BEFORE changing Jarvis architecture/state machine → read docs/architecture/nanoclaw-jarvis.md
BEFORE finalizing Jarvis workflow/contract changes → load /nanoclaw-testing skill
BEFORE changing worker contract code/docs → read docs/workflow/runtime/jarvis-dispatch-contract-discipline.md
BEFORE changing worker dispatch validation/contracts → read docs/workflow/runtime/nanoclaw-jarvis-dispatch-contract.md
BEFORE changing worker container runtime/mounts/model config → read docs/workflow/runtime/nanoclaw-jarvis-worker-runtime.md
BEFORE changing GitHub Actions/review governance for Andy/Jarvis lanes → read docs/workflow/github/github-delivery-governance.md
BEFORE finalizing Andy user-facing reliability fixes → load /nanoclaw-testing skill
BEFORE deciding workflow setup, responsibility ownership, or where updates belong → read docs/operations/workflow-setup-responsibility-map.md
BEFORE deciding whether to run a skill workflow or docs-first workflow → read docs/operations/skills-vs-docs-map.md
BEFORE deciding what to offload to GitHub Actions/rulesets vs keep in local lanes → read docs/workflow/github/github-offload-boundary-loop.md
BEFORE changing the Linear/Notion/GitHub control-plane split → read docs/workflow/control-plane/collaboration-surface-contract.md
BEFORE changing execution-lane routing or Symphony scope → read docs/workflow/control-plane/execution-lane-routing-contract.md
BEFORE changing custom Symphony backend routing or project registry → read docs/workflow/control-plane/custom-symphony-orchestration-contract.md
BEFORE writing or updating Symphony-routed Linear issues (Target Runtime, Agent field, Work Class) → read docs/workflow/control-plane/custom-symphony-orchestration-contract.md#backend-selection-guide
BEFORE operating Symphony dispatch, daemon, or dashboard workflows → load /symphony skill
BEFORE debugging Symphony nightly improvement dispatch or agent execution issues → load /symphony skill
BEFORE testing any Symphony workflow end-to-end → load /symphony skill
BEFORE running the scheduled platform pickup workflow → load /nanoclaw-orchestrator skill
BEFORE reviewing NanoClaw architecture optimization proposals → read docs/strategy/nanoclaw-architecture-optimization-plan.md
BEFORE using MCP execute_code or process_* tools for code/log/CSV operations → read docs/tools/code-execution-mcp-pattern.md
BEFORE onboarding a new project into Linear/Notion/Symphony or changing the universal secret model → read docs/workflow/control-plane/project-bootstrap-and-secret-contract.md
BEFORE consulting Claude Code CLI via resumed/forked sessions for parallel reasoning/review → read docs/workflow/delivery/claude-cli-resume-consult-lane.md
BEFORE pulling/fetching upstream main or resolving upstream sync conflicts → read docs/operations/upstream-sync-policy.md
BEFORE finalizing any Andy/Jarvis operating agreement change → read docs/operations/agreement-sync-protocol.md
BEFORE deciding runtime-local vs prebaked container placement → read docs/operations/runtime-vs-prebaked-boundary.md
BEFORE editing Andy's groups/main/CLAUDE.md → read docs/workflow/docs-discipline/andy-compression-loop.md
BEFORE debugging Andy/Jarvis worker flow, container issues, or service start/stop → load /debug skill
AFTER task completion or BEFORE ending session, if a workflow caused avoidable friction, retries, or mid-task correction → load /session-introspection skill
```

## Key Files

- `docs/ARCHITECTURE.md`: hard core-vs-extension ownership contract
- `src/index.ts`: orchestrator state, message loop, agent invocation
- `src/ipc.ts`: dispatch authorization and task processing
- `src/container-runner.ts`: worker runtime staging, mounts, lifecycle
- `src/router.ts`: outbound routing and formatting
- `groups/{name}/CLAUDE.md`: per-group isolated memory and routing
- `container/skills/agent-browser/SKILL.md`: browser automation capability available to agents

## Quick Commands

```bash
bash scripts/workflow/session-start.sh --agent codex
bash scripts/qmd-context-recall.sh --bootstrap
bash scripts/workflow/preflight.sh
npm run build
npm test
bash scripts/jarvis-ops.sh acceptance-gate
```

For expanded commands, workflow helpers, and entrypoints, start with [`docs/README.md`](docs/README.md) and use [`DOCS.md`](DOCS.md) for the full inventory.
